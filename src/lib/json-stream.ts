const JSON_TOKEN_PREFIX = /[ \t\n\r]*()(?:[{}\[\]:,]|"(?:[^\\"]|\\(?:.|$))*(?:"|$)|[.\-\w]+)?/dy;
const JSON_STRING_CONT = /(?:[^\\"]|\\(?:.|$))*(?:"|$)/y;
const JSON_NS_ATOM_CONT = /[.\-\w]*/y; // non-string atom

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

export function lexer(): (chunk?: string) => JsonToken[] {
  let chunkIndex = -1;

  let pending = JSON_STRING_CONT;
  let pendingStart = 0;
  let pendingToken: JsonToken | undefined;

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
      pending.lastIndex = pendingStart;

      let match = pending.exec(chunk);

      if (match === null) {
        throw 'todo: error in pending';
      }

      let endIndex = pending.lastIndex;
      let lastSymbol = chunk[endIndex - 1]!;

      pendingToken.endChunk = chunkIndex;
      pendingToken.endIndex = endIndex;

      if (endIndex === chunk.length && lastSymbol !== '"') {
        pendingStart = lastSymbol === '\\' ? 1 : 0;
      } else {
        tokens.push(pendingToken);
        pendingToken = undefined;
      }

      JSON_TOKEN_PREFIX.lastIndex = endIndex;
    }

    while (JSON_TOKEN_PREFIX.lastIndex < chunk.length) {
      let match = JSON_TOKEN_PREFIX.exec(chunk);

      if (match === null) {
        throw 'todo: error';
      }

      if (match.indices![1] === undefined) {
        break;
      }

      let endIndex = JSON_TOKEN_PREFIX.lastIndex;
      let [startIndex] = match.indices![1];
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
          if (symbol === '"') {
            let lastSymbol = chunk[endIndex - 1]!;
            if (endIndex == startIndex + 1 || lastSymbol !== '"') {
              pending = JSON_STRING_CONT;
              pendingStart = lastSymbol === '\\' ? 1 : 0;
              pendingToken = token;
              break;
            }
          } else if (endIndex === chunk.length) {
            pending = JSON_NS_ATOM_CONT;
            pendingStart = 0;
            pendingToken = token;
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
