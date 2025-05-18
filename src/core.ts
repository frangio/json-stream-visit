// The tokens identified by the scanner are a generalization of JSON tokens that
// includes atom-looking sequences such as `1.2.3`, `foo`, and `"\xZZ"`. Tokens
// other than atoms are recognized exactly. This approximation is sufficient
// because we're interested in detecting token boundaries and assume the atoms
// will be processed by a full JSON parser that recognizes lexical errors.

// Optional whitespace followed by a token prefix (possibly empty). An empty
// group is used to capture the index where the token starts.
const TOKEN_PREFIX = /[ \t\n\r]*()(?:[{}\[\]:,]|"(?:[^\\"]|\\(?:.|($)))*(")?|[^ \t\n\r{}\[\]:,"]*)/dy;

const STRING_CONT = /(?:[^\\"]|\\(?:.|($)))*(")?/y;
const NS_ATOM_CONT = /[^ \t\n\r{}\[\]:,"]*/y; // non-string atom

/** @internal */
export const enum TokenType {
  BeginObject,
  EndObject,
  BeginArray,
  EndArray,
  ValueSeparator,
  NameSeparator,
  Atom, // strings, numbers, booleans, null
}

const TOKEN_TYPE_MAP: Record<string, TokenType> = {
  '{': TokenType.BeginObject,
  '}': TokenType.EndObject,
  '[': TokenType.BeginArray,
  ']': TokenType.EndArray,
  ',': TokenType.ValueSeparator,
  ':': TokenType.NameSeparator,
};

/** @internal */
export interface Token {
  type: TokenType;
  endIndex: number;
}

// Instantiates a streaming JSON tokenizer: a stateful function that processes
// a chunk of JSON at a time and returns an array of the new tokens it's
// recognized in the stream from the chunk. Some tokens may span multiple
// chunks and will only be recognized and returned once they've been seen
// whole. As explained above, tokens are not exactly JSON tokens and must be
// processed by a JSON parser to recognize lexical errors. Invoking the
// tokenizer without a chunk signals the end of the stream.
/** @internal */
export function scanner(): (chunk?: string) => Token[] {
  // Will track the position of each chunk in the stream counting from 0.
  let chunkIndex = -1;

  // Will hold a token whose end boundary hasn't been seen yet, the regex that
  // must be used to match its continuation, and the number of characters that
  // must be skipped (used for escapes in strings).
  let pendingToken: Token | undefined;
  let pendingSkip = 0;
  let pendingCont = STRING_CONT;

  return function (chunk?: string): Token[] {
    chunkIndex += 1;

    let tokens: Token[] = [];

    if (chunk === undefined) {
      if (pendingToken !== undefined) {
        tokens.push(pendingToken);
        pendingToken = undefined;
      }
      return tokens;
    }

    TOKEN_PREFIX.lastIndex = 0;

    if (pendingToken !== undefined) {
      if (pendingSkip >= chunk.length) {
        pendingSkip -= chunk.length;
        return tokens;
      }

      pendingCont.lastIndex = pendingSkip;

      let match = pendingCont.exec(chunk)!;
      let stringHangingEscape = match[1] !== undefined;
      let stringClosed = match[2] !== undefined;

      let endIndex = pendingCont.lastIndex;

      pendingToken.endIndex = endIndex;

      if (endIndex < chunk.length || stringClosed) {
        tokens.push(pendingToken);
        pendingToken = undefined;
      } else {
        pendingSkip = stringHangingEscape ? 1 : 0;
      }

      TOKEN_PREFIX.lastIndex = endIndex;
    }

    while (TOKEN_PREFIX.lastIndex < chunk.length) {
      // This match always succeeds because the token prefix may be empty.
      let match = TOKEN_PREFIX.exec(chunk)!;

      let [startIndex] = match.indices![1]!;
      let endIndex = TOKEN_PREFIX.lastIndex;

      if (startIndex === chunk.length) {
        break;
      }

      let symbol = chunk[startIndex]!;
      let type = TOKEN_TYPE_MAP[symbol] ?? TokenType.Atom;
      let token = { type, endIndex };

      if (type === TokenType.Atom) {
        // An atom prefix may continue in the next chunk if it's an unclosed
        // string or if it's an undelimited atom (like a number) at the end of
        // the chunk.
        if (symbol === '"') {
          let hangingEscape = match[2] !== undefined;
          let closed = match[3] !== undefined;
          if (!closed) {
            pendingToken = token;
            pendingSkip = hangingEscape ? 1 : 0;
            pendingCont = STRING_CONT;
            continue;
          }
        } else if (endIndex === chunk.length) {
          // Non-string atoms at the end of a chunk can never be considered
          // complete.
          pendingToken = token;
          pendingSkip = 0;
          pendingCont = NS_ATOM_CONT;
          continue;
        }
        // Otherwise the token is complete.
      }

      tokens.push(token);
    }

    return tokens;
  };
}

/** @internal */
export interface BufferedJsonTokenStream extends AsyncIterableIterator<TokenType> {
  buffer(): void;
  flush(): string;
}

/** @internal */
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
        startIndex = endIndex = currentChunk.length;
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

export const ARRAY_VISITOR = Symbol('Array Visitor');

export type Visitor = ValueVisitor | ArrayVisitor | ObjectVisitor;

export type ValueVisitor = (value: unknown) => unknown;
export type ArrayVisitor = { [ARRAY_VISITOR]: Visitor };
export type ObjectVisitor = { [key in string]?: Visitor };

export type TypedVisitor<T> =
  | ValueVisitor
  | (T extends (infer U)[]
    ? TypedArrayVisitor<TypedVisitor<U>>
    : T extends Record<string, unknown>
    ? { [k in keyof T]?: TypedVisitor<T[k]> }
    : never);

export type TypedArrayVisitor<V extends Visitor> = { [ARRAY_VISITOR]: V };

export function array<const V extends Visitor>(inner: V): TypedArrayVisitor<V> {
  return { [ARRAY_VISITOR]: inner };
}

const enum VisitStateId {
  ValueBuffering,
  ValueSkipping,
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

// Start states can be reused when they appear in array visitors, so we
// defensively use readonly properties to avoid bugs.
type VisitStartState =
  | { readonly id: VisitStateId.ValueBuffering; readonly value: ValueVisitor }
  | { readonly id: VisitStateId.ArrayPreBegin; readonly value: Visitor }
  | { readonly id: VisitStateId.ObjectPreBegin; readonly value: ObjectVisitor }
  | { readonly id: VisitStateId.ValueSkipping; readonly value: undefined };

type VisitState =
  | VisitStartState
  | {
      id:
        | VisitStateId.ArrayPostBegin
        | VisitStateId.ArrayPostValue
        | VisitStateId.ArrayPreEnd;
      value: VisitStartState;
    }
  | {
      id:
        | VisitStateId.ObjectPreBegin
        | VisitStateId.ObjectPostBegin
        | VisitStateId.ObjectPreKey
        | VisitStateId.ObjectPostValue;
      value: ObjectVisitor;
    }
  | { id: VisitStateId.ObjectPostKey; value: VisitStartState };

function stateFromVisitor(visitor: Visitor): VisitStartState {
  if (typeof visitor === 'function') {
    return { id: VisitStateId.ValueBuffering, value: visitor };
  } else if (ARRAY_VISITOR in visitor) {
    return { id: VisitStateId.ArrayPreBegin, value: visitor[ARRAY_VISITOR] };
  } else {
    return { id: VisitStateId.ObjectPreBegin, value: visitor };
  }
}

const DEPTH_DELTA: Record<TokenType, 0 | 1 | -1> = {
  [TokenType.BeginObject]: 1,
  [TokenType.BeginArray]: 1,
  [TokenType.EndObject]: -1,
  [TokenType.EndArray]: -1,
  [TokenType.ValueSeparator]: 0,
  [TokenType.NameSeparator]: 0,
  [TokenType.Atom]: 0
};

class SyntaxError extends Error {}

export async function visit(stream: AsyncIterable<string>, visitor: Visitor): Promise<void>;
export async function visit<T>(stream: AsyncIterable<string>, visitor: TypedVisitor<T>): Promise<void>;
export async function visit(stream: AsyncIterable<string>, visitor: Visitor): Promise<void> {
  let stack: VisitState[] = [stateFromVisitor(visitor)];
  let depth = 0;

  let tokens = bufferedScan(stream);

  for await (let token of tokens) {
    if (stack.length === 0) break;

    let state = stack.at(-1)!;

    if (state.id === VisitStateId.ArrayPostBegin) {
      if (token === TokenType.EndArray) {
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
        // Fall through

      case VisitStateId.ValueSkipping:
        depth += DEPTH_DELTA[token];

        if (depth === 0) {
          if (state.id === VisitStateId.ValueBuffering) {
            await state.value(JSON.parse(tokens.flush()));
          }
          stack.pop();
        } else if (depth < 0) {
          throw new SyntaxError('unbalanced delimiters');
        }

        break;

      case VisitStateId.ArrayPreBegin:
        if (token !== TokenType.BeginArray) throw new SyntaxError('expected array');
        stack.pop();
        stack.push({
          id: VisitStateId.ArrayPostBegin,
          value: stateFromVisitor(state.value),
        });
        break;

      case VisitStateId.ArrayPostValue:
        if (token !== TokenType.EndArray) {
          if (token !== TokenType.ValueSeparator) throw Error('expected array end or comma');
          stack.push(state.value);
          break;
        }
        // Fall through

      case VisitStateId.ArrayPreEnd:
        // We can assume that token === 'end-array'.
        stack.pop();
        break;

      case VisitStateId.ObjectPreBegin:
        if (token !== TokenType.BeginObject) throw new SyntaxError('expected object');
        stack.pop();
        stack.push({
          id: VisitStateId.ObjectPostBegin,
          value: state.value,
        });
        break;

      case VisitStateId.ObjectPostBegin:
        if (token === TokenType.EndObject) {
          stack.pop();
          break;
        }
        // Fall through

      case VisitStateId.ObjectPreKey: {
        if (token !== TokenType.Atom) throw new SyntaxError('expected string');
        let key: string = JSON.parse(tokens.flush());
        let visitor = state.value[key];
        state.id = VisitStateId.ObjectPostValue;
        if (visitor === undefined) {
          stack.push({
            id: VisitStateId.ObjectPostKey,
            value: { id: VisitStateId.ValueSkipping, value: undefined },
          });
        } else {
          stack.push({
            id: VisitStateId.ObjectPostKey,
            value: stateFromVisitor(visitor),
          });
        }
        break;
      }

      case VisitStateId.ObjectPostKey:
        if (token !== TokenType.NameSeparator) throw new SyntaxError('expected colon');
        stack.pop();
        stack.push(state.value);
        break;

      case VisitStateId.ObjectPostValue:
        switch (token) {
          case TokenType.EndObject:
            stack.pop();
            break;

          case TokenType.ValueSeparator:
            state.id = VisitStateId.ObjectPreKey;
            break;

          default:
            throw Error('expected object end or comma');
        }
        break;
    }
  }
}
