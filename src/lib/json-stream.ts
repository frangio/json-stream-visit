// The tokens identified by the scanner are a generalization of JSON tokens that
// includes atom-looking sequences such as `1.2.3`, `foo`, and `"\xZZ"`. Tokens
// other than atoms are recognized exactly. This approximation is sufficient
// because we're interested in detecting token boundaries and assume the atoms
// will be processed by a full JSON parser that recognizes lexical errors.

// Optional whitespace followed by a token prefix (possibly empty). An empty
// group is used to capture the index where the token starts.
const JSON_TOKEN_PREFIX = /[ \t\n\r]*()(?:[{}\[\]:,]|"(?:[^\\"]|\\(?:.|$))*"?|[^ \t\n\r{}\[\]:,"]*)/dy;

const JSON_STRING_CONT = /(?:[^\\"]|\\(?:.|$))*"?/y;
const JSON_NS_ATOM_CONT = /[^ \t\n\r{}\[\]:,"]*/y; // non-string atom

export type JsonTokenType =
  | 'begin-object'
  | 'end-object'
  | 'begin-array'
  | 'end-array'
  | 'value-separator'
  | 'name-separator'
  | 'atom'; // strings, numbers, booleans, null

export interface JsonToken {
  type: JsonTokenType;
  startChunk: number;
  startIndex: number;
  endChunk: number;
  endIndex: number;
}

const JSON_TOKEN_TYPE_MAP: Record<string, JsonTokenType> = {
  '{': 'begin-object',
  '}': 'end-object',
  '[': 'begin-array',
  ']': 'end-array',
  ',': 'value-separator',
  ':': 'name-separator',
};

// Instantiates a streaming JSON tokenizer: a stateful function that processes
// a chunk of JSON at a time and returns an array of the new tokens it's
// recognized in the stream from the chunk. Some tokens may span multiple
// chunks and will only be recognized and returned once they've been seen
// whole. As explained above, tokens are not exactly JSON tokens and must be
// processed by a JSON parser to recognize lexical errors. Invoking the
// tokenizer without a chunk signals the end of the stream.
export function scanner(): (chunk?: string) => JsonToken[] {
  // Will track the position of each chunk in the stream counting from 0.
  let chunkIndex = -1;

  // Will hold a token whose end boundary hasn't been seen yet, the regex that
  // must be used to match its continuation, and the number of characters that
  // must be skipped (used for escapes in strings).
  let pendingToken: JsonToken | undefined;
  let pendingSkip = 0;
  let pendingCont = JSON_STRING_CONT;

  return function (chunk?: string): JsonToken[] {
    chunkIndex += 1;

    let tokens: JsonToken[] = [];

    if (chunk === undefined) {
      if (pendingToken !== undefined) {
        tokens.push(pendingToken);
        pendingToken = undefined;
      }
      return tokens;
    }

    JSON_TOKEN_PREFIX.lastIndex = 0;

    if (pendingToken !== undefined) {
      if (pendingSkip >= chunk.length) {
        pendingSkip -= chunk.length;
        return tokens;
      }

      pendingCont.lastIndex = pendingSkip;

      pendingCont.exec(chunk);

      let endIndex = pendingCont.lastIndex;
      let lastSymbol = endIndex > pendingSkip ? chunk[endIndex - 1] : undefined;

      pendingToken.endChunk = chunkIndex;
      pendingToken.endIndex = endIndex;

      if (endIndex === chunk.length && lastSymbol !== '"') {
        pendingSkip = lastSymbol === '\\' ? 1 : 0;
      } else {
        tokens.push(pendingToken);
        pendingToken = undefined;
      }

      JSON_TOKEN_PREFIX.lastIndex = endIndex;
    }

    while (JSON_TOKEN_PREFIX.lastIndex < chunk.length) {
      // This match always succeeds because the token prefix may be empty.
      let match = JSON_TOKEN_PREFIX.exec(chunk)!;

      let [startIndex] = match.indices![1]!;
      let endIndex = JSON_TOKEN_PREFIX.lastIndex;

      if (startIndex === chunk.length) {
        break;
      }

      let symbol = chunk[startIndex]!;
      let type = JSON_TOKEN_TYPE_MAP[symbol] ?? 'atom';
      let token = {
        type,
        startChunk: chunkIndex,
        startIndex,
        endChunk: chunkIndex,
        endIndex,
      };

      switch (type) {
        case 'atom': {
          // An atom prefix may continue in the next chunk if it's an unclosed
          // string or if it's an undelimited atom (like a number) at the end
          // of the chunk. Otherwise the token is complete and we fall through
          // to the default case.
          if (symbol === '"') {
            let lastSymbol = chunk[endIndex - 1]!;
            // A quote symbol at the end of the match may be the opening quote
            // if the match is a single character, in which case the token is
            // not complete.
            if (lastSymbol !== '"' || endIndex === startIndex + 1) {
              pendingToken = token;
              pendingSkip = lastSymbol === '\\' ? 1 : 0;
              pendingCont = JSON_STRING_CONT;
              break;
            }
          } else if (endIndex === chunk.length) {
            // Non-string atoms at the end of a chunk can never be considered
            // complete.
            pendingToken = token;
            pendingSkip = 0;
            pendingCont = JSON_NS_ATOM_CONT;
            break;
          }
        }

        default: {
          tokens.push(token);
        }
      }
    }

    return tokens;
  }
}

export interface BufferedJsonTokenStream extends AsyncIterableIterator<JsonTokenType> {
  reset(): void;
  drain(): string;
}

export function bufferedScan(stream: AsyncIterable<string>): BufferedJsonTokenStream {
  let scan = scanner();
  let buffer: string[] = [];
  let chunk = '';
  let startIndex = 0;
  let endIndex = 0;

  let tokenStream = (async function* () {
    for await (chunk of stream) {
      startIndex = endIndex = 0;
      for (let token of scan(chunk)) {
        endIndex = token.endIndex;
        yield token.type;
      }
      if (startIndex < chunk.length) {
        buffer.push(chunk.slice(startIndex));
      }
      startIndex = endIndex;
    }

    for (let token of scan()) {
      yield token.type;
    }
  })();

  function reset(): void {
    buffer.length = 0;
    startIndex = endIndex;
  }

  function drain(): string {
    let res = ''.concat(...buffer, chunk.slice(startIndex, endIndex));
    reset();
    return res;
  }

  return Object.assign(tokenStream, { reset, drain });
}
