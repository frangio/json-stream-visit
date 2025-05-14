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
  test('token flush', async () => {
    const chunks = ['"foobar"'];
    const stream = bufferedScan(generate(chunks));
    await take(stream, 1);
    assert.equal(stream.flush(), '"foobar"');
  });

  test('multi-token buffered flush', async () => {
    const chunks = ['"foo" "bar" "baz"'];
    const stream = bufferedScan(generate(chunks));
    stream.buffer();

    const tokens = await take(stream, 2);
    assert.deepEqual(tokens, ['atom', 'atom']);
    assert.equal(stream.flush(), '"foo" "bar"');
  });

  test('multi-chunk flush', async () => {
    const chunks = ['"foo', 'bar"'];
    const stream = bufferedScan(generate(chunks));
    await take(stream, 1);
    assert.equal(stream.flush(), '"foobar"');
  });

  test('multi-chunk multi-token buffered flush', async () => {
    const chunks = ['{"foo":', '"bar"}'];
    const stream = bufferedScan(generate(chunks));
    stream.buffer();
    await take(stream, 5);
    assert.equal(stream.flush(), '{"foo":"bar"}');
  });

  test('non-buffered token flush', async () => {
    const chunks = ['"foo" "bar" "baz"'];
    const stream = bufferedScan(generate(chunks));

    const tokens = await take(stream, 2);
    assert.deepEqual(tokens, ['atom', 'atom']);
    assert.equal(stream.flush(), ' "bar"');
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
      entries: () => {
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
