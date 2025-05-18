import { test, suite } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { delay } from '@std/async';
import { scanner, bufferedScan, visit, array, TokenType, type Token, type Visitor } from './core.ts';

function scan(chunks: string[]): Token[] {
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
      { type: TokenType.BeginObject, endIndex: 1 },
      { type: TokenType.Atom, endIndex: 6 },
      { type: TokenType.NameSeparator, endIndex: 7 },
      { type: TokenType.Atom, endIndex: 8 },
      { type: TokenType.EndObject, endIndex: 9 },
    ]);
  });

  test('split string', () => {
    const tokens = scan(['"Hello', ' World"']);
    assert.deepEqual(tokens, [
      { type: TokenType.Atom, endIndex: 7 },
    ]);
  });

  test('lone quotes', () => {
    const tokens = scan(['"', '" "', '"']);
    assert.deepEqual(tokens, [
      { type: TokenType.Atom, endIndex: 1 },
      { type: TokenType.Atom, endIndex: 1 },
    ]);
  });

  test('escapes', () => {
    assert.deepEqual(scan(['"\\""']), [
      { type: TokenType.Atom, endIndex: 4 },
    ]);

    assert.deepEqual(scan(['"\\"', '\\"', '"']), [
      { type: TokenType.Atom, endIndex: 1 },
    ]);

    assert.deepEqual(scan(['"\\', '""']), [
      { type: TokenType.Atom, endIndex: 2 },
    ]);

    assert.deepEqual(scan(['"\\', '\\', '",']), [
      { type: TokenType.Atom, endIndex: 1 },
      { type: TokenType.ValueSeparator, endIndex: 2 },
    ]);

    assert.deepEqual(scan(['"\\\\', '"']), [
      { type: TokenType.Atom, endIndex: 1 },
    ]);
  });

  test('split in three', () => {
    const tokens = scan(['"', 'a', '"']);
    assert.deepEqual(tokens, [
      { type: TokenType.Atom, endIndex: 1 },
    ]);
  });

  test('empty', () => {
    const tokens = scan([' ']);
    assert.deepEqual(tokens, []);
  });

  test('one two', () => {
    const tokens = scan(['1 2']);
    assert.deepEqual(tokens, [
      { type: TokenType.Atom, endIndex: 1 },
      { type: TokenType.Atom, endIndex: 3 },
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
    assert.deepEqual(tokens, [TokenType.Atom, TokenType.Atom]);
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
    assert.deepEqual(tokens, [TokenType.Atom, TokenType.Atom]);
    assert.equal(stream.flush(), ' "bar"');
  });
});

suite('json stream visitor', () => {
  test('visit simple object', async () => {
    const obj = { name: 'test', values: [1, 2, 3] };
    const json = JSON.stringify(obj);
    const visited: unknown[] = [];

    await visit(generate([json]), (value) => visited.push(value));

    assert.deepEqual(visited, [obj]);
  });

  test('visit array members', async () => {
    const arr = [10, 20, 30];
    const json = JSON.stringify(arr);
    const visited: unknown[] = [];

    await visit(generate([json]), array(
      (value) => visited.push(value),
    ));

    assert.deepEqual(visited, arr);
  });

  test('visit property in object via function entries', async () => {
    const obj = { foo: 'bar', baz: 42 };
    const json = JSON.stringify(obj);
    const visited: unknown[] = [];

    await visit(generate([json]), {
      foo(value) { visited.push(value); },
    });

    assert.deepEqual(visited, ['bar']);
  });

  test('visit property in object via object entries', async () => {
    const obj = { foo: 'bar', baz: 42 };
    const json = JSON.stringify(obj);
    const visited: unknown[] = [];

    await visit(generate([json]), {
      foo(value) { visited.push(value); },
    });

    assert.deepEqual(visited, ['bar']);
  });

  test('visit multiple objects in array', async () => {
    const obj = [{ foo: 'bar', quux: 0 }, { foo: 'baz' }];
    const json = JSON.stringify(obj);
    const visited: unknown[] = [];

    await visit(generate([json]),
      array({
        foo(value) { visited.push(value); },
      })
    );

    assert.deepEqual(visited, ['bar', 'baz']);
  });

  test('visit empty object', async () => {
    const obj = {};
    const json = JSON.stringify(obj);
    await visit(generate([json]), {});
  });

  test('visit empty array', async () => {
    const arr: unknown[] = [];
    const json = JSON.stringify(arr);
    let visitCount = 0;

    await visit(generate([json]), array(() => visitCount++));

    assert.equal(visitCount, 0);
  });

  test('await visitor result', async () => {
    const obj = { a: 'a', b: 'b' };
    const json = JSON.stringify(obj);
    const log: unknown[] = [];

    await visit(generate([json]), {
      async a(x) {
        await delay(0);
        log.push(x);
      },
      b(x) {
        log.push(x);
      },
    });

    assert.deepEqual(log, ['a', 'b']);
  });

  test('random visitor on well-shaped input', () => {
    type Shape =
      | { type: 'value' }
      | { type: 'array'; values: Shape }
      | { type: 'object'; entries: Record<string, Shape> };

    const { shape } = fc.letrec<Record<string, Shape>>((tie) => ({
      value: fc.constant({ type: 'value' }),
      array: tie('value').map(values => ({ type: 'array', values })),
      object: fc.dictionary(fc.string(), tie('shape')).map(entries => ({ type: 'object', entries })),
      shape: fc.oneof(tie('value'), tie('object'), tie('array')),
    }));

    function input(shape: Shape): fc.Arbitrary<unknown> {
      switch (shape.type) {
        case 'value': return fc.jsonValue();
        case 'array': return fc.array(input(shape.values));
        case 'object': return fc.record(
          Object.fromEntries(
            Object.entries(shape.entries).map(([key, subshape]) => [key, input(subshape)])
          )
        );
      }
    }

    const scenario = shape.chain(shape => input(shape).map(input => ({ shape, input })));

    const chunkSizes = fc.array(fc.integer({ min: 1 }));

    function makeVisitor(shape: Shape): Visitor {
      switch (shape.type) {
        case 'value': return () => {};
        case 'array': return array(makeVisitor(shape.values));
        case 'object': return Object.fromEntries(
          Object.entries(shape.entries).map(([key, subshape]) => [key, makeVisitor(subshape)])
        );
      }
    }

    async function* chunkedStream(str: string, sizes: number[]): AsyncGenerator<string> {
      if (sizes.length === 0) {
        sizes = [str.length];
      }

      for (let sizeIndex = 0; str.length > 0; sizeIndex++) {
        const size = sizes[sizeIndex % sizes.length];
        const chunkSize = Math.min(size, str.length);
        const chunk = str.substring(0, chunkSize);
        yield chunk;
        str = str.substring(chunkSize);
      }
    }

    fc.assert(
      fc.asyncProperty(scenario, chunkSizes, async ({ shape, input }, chunkSizes) => {
        let visitor = makeVisitor(shape);
        let stream = chunkedStream(JSON.stringify(input), chunkSizes);
        await visit(stream, visitor);
      })
    );
  });
});
