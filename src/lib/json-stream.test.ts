import { test, suite } from 'node:test';
import assert from 'node:assert/strict';
import { lexer, bufferedLex, type JsonToken } from './json-stream.ts';

function lex(chunks: string[]): JsonToken[] {
  let lex = lexer();
  return [...chunks, undefined].flatMap(chunk => lex(chunk));
}

async function* generate<T>(items: T[]): AsyncGenerator<T> {
  yield* items;
}

async function take<T>(iter: AsyncIterator<T>, count?: number): Promise<T[]> {
  count ??= Number.MAX_VALUE;
  let res: T[] = [];
  while (res.length < count) {
    let { value, done } = await iter.next();
    if (done) break;
    res.push(value);
  }
  return res;
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

  test('one two', () => {
    const tokens = lex(['1 2']);
    assert.deepEqual(tokens, [
      { type: 'atom', startChunk: 0, startIndex: 0, endChunk: 0, endIndex: 1 },
      { type: 'atom', startChunk: 0, startIndex: 2, endChunk: 0, endIndex: 3 },
    ]);
  });
});

suite('buffered json token stream', () => {
  test('basic buffering and draining', async () => {
    const chunks = ['{"key":', ' "value"}'];
    const stream = bufferedLex(generate(chunks));

    const tokens = await take(stream);

    assert.deepEqual(tokens, [
      'begin-object',
      'atom',
      'name-separator',
      'atom',
      'end-object',
    ]);

    assert.equal(stream.drain(), '{"key": "value"}');
  });

  test('reset clears buffer', async () => {
    const chunks = ['1 2'];
    const stream = bufferedLex(generate(chunks));

    const one = await take(stream, 1);
    assert.deepEqual(one, ['atom']);

    stream.reset();
    assert.equal(stream.drain(), '');

    const two = await take(stream);
    assert.deepEqual(two, ['atom']);
    assert.equal(stream.drain(), ' 2');
  });
});
