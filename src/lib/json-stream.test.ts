import { test, suite } from 'node:test';
import assert from 'node:assert/strict';
import { lexer, type JsonToken } from './json-stream.ts';

function lex(chunks: string[]): JsonToken[] {
  let lex = lexer();
  return [...chunks, undefined].flatMap(chunk => lex(chunk));
}

suite('json stream lexer', () => {
  test('simple JSON object', () => {
    const tokens = lex(['{"key":', ' "value"}']);
    assert.deepEqual(tokens, [
      { type: 'begin-object', startChunk: 0, startIndex: 0, endChunk: 0, endIndex: 1 },
      { type: 'atom', startChunk: 0, startIndex: 1, endChunk: 0, endIndex: 6 },
      { type: 'name-separator', startChunk: 0, startIndex: 6, endChunk: 0, endIndex: 7 },
      { type: 'atom', startChunk: 1, startIndex: 1, endChunk: 1, endIndex: 8 },
      { type: 'end-object', startChunk: 1, startIndex: 8, endChunk: 1, endIndex: 9 },
    ]);
  });

  test('split string', () => {
    const tokens = lex(['"Hello', ' World"']);
    assert.deepEqual(tokens, [
      { type: 'atom', startChunk: 0, startIndex: 0, endChunk: 1, endIndex: 7 },
    ]);
  });

  test('lone quotes', () => {
    const tokens = lex(['"', '" "', '"']);
    assert.deepEqual(tokens, [
      { type: 'atom', startChunk: 0, startIndex: 0, endChunk: 1, endIndex: 1 },
      { type: 'atom', startChunk: 1, startIndex: 2, endChunk: 2, endIndex: 1 },
    ]);
  });

  test('escapes', () => {
    assert.deepEqual(lex(['"\\""']), [
      { type: 'atom', startChunk: 0, startIndex: 0, endChunk: 0, endIndex: 4 },
    ]);

    assert.deepEqual(lex(['"\\', '""']), [
      { type: 'atom', startChunk: 0, startIndex: 0, endChunk: 1, endIndex: 2 },
    ]);

    assert.deepEqual(lex(['"\\', '\\', '",']), [
      { type: 'atom', startChunk: 0, startIndex: 0, endChunk: 2, endIndex: 1 },
      { type: 'value-separator', startChunk: 2, startIndex: 1, endChunk: 2, endIndex: 2 },
    ]);
  });

  test('split in three', () => {
    const tokens = lex(['"', 'a', '"']);
    assert.deepEqual(tokens, [
      { type: 'atom', startChunk: 0, startIndex: 0, endChunk: 2, endIndex: 1 },
    ]);
  });

  test('empty', () => {
    const tokens = lex([' ']);
    assert.deepEqual(tokens, []);
  });
});
