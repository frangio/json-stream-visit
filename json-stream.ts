// The tokens identified by the scanner are a generalization of JSON tokens that
// includes atom-looking sequences such as `1.2.3`, `foo`, and `"\xZZ"`. Tokens
// other than atoms are recognized exactly. This approximation is sufficient
// because we're interested in detecting token boundaries and assume the atoms
// will be processed by a full JSON parser that recognizes lexical errors.

// Optional whitespace followed by a token prefix (possibly empty). An empty
// group is used to capture the index where the token starts.
const JSON_TOKEN_PREFIX = /[ \t\n\r]*()(?:[{}\[\]:,]|"(?:[^\\"]|\\(?:.|$))*(")?|[^ \t\n\r{}\[\]:,"]*)/dy;

const JSON_STRING_CONT = /(?:[^\\"]|\\(?:.|$))*(")?/y;
const JSON_NS_ATOM_CONT = /[^ \t\n\r{}\[\]:,"]*/y; // non-string atom

export type JsonTokenType =
  | 'begin-object'
  | 'end-object'
  | 'begin-array'
  | 'end-array'
  | 'value-separator'
  | 'name-separator'
  | 'atom'; // strings, numbers, booleans, null

const JSON_TOKEN_TYPE_MAP: Record<string, JsonTokenType> = {
  '{': 'begin-object',
  '}': 'end-object',
  '[': 'begin-array',
  ']': 'end-array',
  ',': 'value-separator',
  ':': 'name-separator',
};

export interface JsonToken {
  type: JsonTokenType;
  endIndex: number;
}

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

      let match = pendingCont.exec(chunk)!;
      let stringClosed = match[1] !== undefined;

      let endIndex = pendingCont.lastIndex;
      let lastSymbol = endIndex > pendingSkip ? chunk[endIndex - 1] : undefined;

      pendingToken.endIndex = endIndex;

      if (endIndex < chunk.length || stringClosed) {
        tokens.push(pendingToken);
        pendingToken = undefined;
      } else {
        pendingSkip = lastSymbol === '\\' ? 1 : 0;
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
      let token = { type, endIndex };

      if (type === 'atom') {
        // An atom prefix may continue in the next chunk if it's an unclosed
        // string or if it's an undelimited atom (like a number) at the end of
        // the chunk.
        if (symbol === '"') {
          let closed = match[2] !== undefined;
          if (!closed) {
            let lastSymbol = chunk[endIndex - 1]!;
            pendingToken = token;
            pendingSkip = lastSymbol === '\\' ? 1 : 0;
            pendingCont = JSON_STRING_CONT;
            continue;
          }
        } else if (endIndex === chunk.length) {
          // Non-string atoms at the end of a chunk can never be considered
          // complete.
          pendingToken = token;
          pendingSkip = 0;
          pendingCont = JSON_NS_ATOM_CONT;
          continue;
        }
        // Otherwise the token is complete.
      }

      tokens.push(token);
    }

    return tokens;
  }
}

export interface BufferedJsonTokenStream extends AsyncIterableIterator<JsonTokenType> {
  buffer(): void;
  flush(): string;
}

export function bufferedScan(stream: AsyncIterable<string>): BufferedJsonTokenStream {
  let scan = scanner();

  let buffering = false;
  let bufferedChunks: string[] = [];
  let currentChunk = '';
  let startIndex = 0;
  let endIndex = 0;

  let tokens = (async function* () {
    for await (currentChunk of stream) {
      startIndex = endIndex = 0;
      for (let token of scan(currentChunk)) {
        endIndex = token.endIndex;
        yield token.type;
        if (!buffering) {
          startIndex = endIndex;
          bufferedChunks.length = 0;
        }
      }
      if (startIndex < currentChunk.length) {
        bufferedChunks.push(currentChunk.slice(startIndex));
        startIndex = currentChunk.length;
      }
    }

    for (let token of scan()) {
      yield token.type;
    }
  })();

  function buffer(): void {
    buffering = true;
  }

  function flush(): string {
    buffering = false;
    return ''.concat(...bufferedChunks, currentChunk.slice(startIndex, endIndex));
  }

  return Object.assign(tokens, { buffer, flush });
}

export type Visitor = ValueVisitor | { entries: ObjectVisitor } | { values: Visitor };
export type ValueVisitor = (value: unknown) => void;
export type ObjectVisitor = (key: string) => Visitor;

const enum VisitStateId {
  ValueBuffering,
  ArrayPreBegin,
  ArrayPostBegin,
  ArrayPostValue,
  ArrayPreEnd,
  ObjectPreBegin,
  ObjectPostBegin,
  ObjectPostKey,
  ObjectPostValue,
  ObjectPreKey,
}

type VisitState =
  | { id: VisitStateId.ValueBuffering;
      value: ValueVisitor; }
  | { id: VisitStateId.ArrayPreBegin;
      value: Visitor; }
  | { id: VisitStateId.ArrayPostBegin | VisitStateId.ArrayPostValue | VisitStateId.ArrayPreEnd;
      value: VisitState; }
  | { id: VisitStateId.ObjectPreBegin | VisitStateId.ObjectPostBegin | VisitStateId.ObjectPreKey | VisitStateId.ObjectPostValue;
      value: ObjectVisitor; }
  | { id: VisitStateId.ObjectPostKey;
      value: VisitState; };

function stateFromVisitor(visitor: Visitor): VisitState {
  if (typeof visitor === 'function') {
    return { id: VisitStateId.ValueBuffering, value: visitor };
  } else if ('values' in visitor) {
    return { id: VisitStateId.ArrayPreBegin, value: visitor.values };
  } else if ('entries' in visitor) {
    return { id: VisitStateId.ObjectPreBegin, value: visitor.entries };
  } else {
    throw Error('todo');
  }
}

export async function visit(stream: AsyncIterable<string>, visitor: Visitor): Promise<void> {
  let stack: VisitState[] = [stateFromVisitor(visitor)];
  let depth = 0;

  let tokens = bufferedScan(stream);

  for await (let token of tokens) {
    if (stack.length === 0) break;

    let state = stack.at(-1)!;

    if (state.id === VisitStateId.ArrayPostBegin) {
      if (token === 'end-array') {
        state.id = VisitStateId.ArrayPreEnd;
      } else {
        state.id = VisitStateId.ArrayPostValue;
        stack.push(state.value);
        state = state.value;
      }
    }

    switch (state.id) {
      case VisitStateId.ValueBuffering:
        if (depth === 0) {
          tokens.buffer();
        }

        switch (token) {
          case 'begin-object':
          case 'begin-array':
            depth += 1;
            break;

          case 'end-object':
          case 'end-array':
            depth -= 1;
            if (depth < 0) throw Error('todo');
            break;
        }

        if (depth === 0) {
          state.value(JSON.parse(tokens.flush()));
          stack.pop();
        }

        break;

      case VisitStateId.ArrayPreBegin:
        if (token !== 'begin-array') throw Error('todo');
        stack.pop();
        stack.push({
          id: VisitStateId.ArrayPostBegin,
          value: stateFromVisitor(state.value),
        });
        break;

      case VisitStateId.ArrayPostValue:
        if (token !== 'end-array') {
          if (token !== 'value-separator') throw Error('todo');
          stack.push(state.value);
          break;
        }
        // Fall through

      case VisitStateId.ArrayPreEnd:
        // We can assume that token === 'end-array'.
        stack.pop();
        break;

      case VisitStateId.ObjectPreBegin:
        if (token !== 'begin-object') throw Error('todo');
        state.id = VisitStateId.ObjectPostBegin;
        break;

      case VisitStateId.ObjectPostBegin:
        if (token === 'end-object') {
          stack.pop();
          break;
        }
        // Fall through

      case VisitStateId.ObjectPreKey: {
        if (token !== 'atom') throw Error('todo');
        state.id = VisitStateId.ObjectPostValue;
        let key: string = JSON.parse(tokens.flush());
        stack.push({
          id: VisitStateId.ObjectPostKey,
          value: stateFromVisitor(state.value(key)),
        });
        break;
      }

      case VisitStateId.ObjectPostKey:
        if (token !== 'name-separator') throw Error('todo');
        stack.pop();
        stack.push(state.value);
        break;

      case VisitStateId.ObjectPostValue:
        switch (token) {
          case 'end-object':
            stack.pop();
            break;

          case 'value-separator':
            state.id = VisitStateId.ObjectPreKey;
            break;

          default:
            throw Error('todo');
        }
        break;
    }
  }
}
