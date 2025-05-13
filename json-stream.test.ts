import { test, suite } from 'node:test';
import assert from 'node:assert/strict';
import { scanner, bufferedScan, visit, type JsonToken } from './json-stream.ts';

function scan(chunks: string[]): JsonToken[] {
  let scan = scanner();
  return [...chunks, undefined].flatMap(chunk => scan(chunk));
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

suite('json stream scanner', () => {
  test('simple JSON object', () => {
    const tokens = scan(['{"key":', ' "value"}']);
    assert.deepEqual(tokens, [
      { type: 'begin-object', endIndex: 1 },
      { type: 'atom', endIndex: 6 },
      { type: 'name-separator', endIndex: 7 },
      { type: 'atom', endIndex: 8 },
      { type: 'end-object', endIndex: 9 },
    ]);
  });

  test('split string', () => {
    const tokens = scan(['"Hello', ' World"']);
    assert.deepEqual(tokens, [
      { type: 'atom', endIndex: 7 },
    ]);
  });

  test('lone quotes', () => {
    const tokens = scan(['"', '" "', '"']);
    assert.deepEqual(tokens, [
      { type: 'atom', endIndex: 1 },
      { type: 'atom', endIndex: 1 },
    ]);
  });

  test('escapes', () => {
    assert.deepEqual(scan(['"\\""']), [
      { type: 'atom', endIndex: 4 },
    ]);

    assert.deepEqual(scan(['"\\', '""']), [
      { type: 'atom', endIndex: 2 },
    ]);

    assert.deepEqual(scan(['"\\', '\\', '",']), [
      { type: 'atom', endIndex: 1 },
      { type: 'value-separator', endIndex: 2 },
    ]);
  });

  test('split in three', () => {
    const tokens = scan(['"', 'a', '"']);
    assert.deepEqual(tokens, [
      { type: 'atom', endIndex: 1 },
    ]);
  });

  test('empty', () => {
    const tokens = scan([' ']);
    assert.deepEqual(tokens, []);
  });

  test('one two', () => {
    const tokens = scan(['1 2']);
    assert.deepEqual(tokens, [
      { type: 'atom', endIndex: 1 },
      { type: 'atom', endIndex: 3 },
    ]);
  });
});

suite('buffered json token stream', () => {
  test('basic buffering and draining', async () => {
    const chunks = ['{"key":', ' "value"}'];
    const stream = bufferedScan(generate(chunks));

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
    const stream = bufferedScan(generate(chunks));

    const one = await take(stream, 1);
    assert.deepEqual(one, ['atom']);

    stream.reset();
    assert.equal(stream.drain(), '');

    const two = await take(stream);
    assert.deepEqual(two, ['atom']);
    assert.equal(stream.drain(), ' 2');
  });
});

suite('json stream visitor', () => {
  test('visit simple object', async () => {
    const obj = { name: "test", values: [1, 2, 3] };
    const json = JSON.stringify(obj);
    const visited: unknown[] = [];

    await visit(generate([json]), (value) => visited.push(value));

    assert.deepEqual(visited, [obj]);
  });

  test('visit array members', async () => {
    const arr = [10, 20, 30];
    const json = JSON.stringify(arr);
    const visited: unknown[] = [];

    await visit(generate([json]), { values: (value) => visited.push(value) });

    assert.deepEqual(visited, arr);
  });

  test('visit property in object', async () => {
    const obj = { foo: "bar", baz: 42 };
    const json = JSON.stringify(obj);
    const visited: unknown[] = [];

    await visit(generate([json]), {
      entries: (key) => {
        if (key === "foo") {
          return (value) => visited.push(value);
        }
        return () => {}; // ignore other properties
      }
    });

    assert.deepEqual(visited, ["bar"]);
  });

  test('visit empty object', async () => {
    const obj = {};
    const json = JSON.stringify(obj);
    let visitCount = 0;

    await visit(generate([json]), {
      entries: (key) => {
        visitCount++;
        return () => {};
      }
    });

    assert.equal(visitCount, 0);
  });

  test('visit empty array', async () => {
    const arr: unknown[] = [];
    const json = JSON.stringify(arr);
    let visitCount = 0;

    await visit(generate([json]), { values: () => visitCount++ });

    assert.equal(visitCount, 0);
  });
});
