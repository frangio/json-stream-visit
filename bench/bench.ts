import * as jsonsv from '../src/index.ts';

import JSONStream from 'npm:JSONStream@1.3.5';
import { JSONParser } from 'npm:@streamparser/json@0.0.22';
import bfj from 'npm:bfj@9.1.2';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { brotliDecompressSync } from 'node:zlib';

const CHUNK_SIZE = 256;

async function* streamChunks(data: string) {
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    yield data.slice(i, i + CHUNK_SIZE);
  }
}

const dataPath = 'bench/wiki_movie_plots_deduped.json.br';
const dataDecompPath = Deno.makeTempFileSync({ suffix: '.json' });
globalThis.addEventListener('unload', () => Deno.removeSync(dataDecompPath));
const data = (() => {
  const buf = brotliDecompressSync(Deno.readFileSync(dataPath));
  Deno.writeFileSync(dataDecompPath, buf);
  return buf.toString('utf8');
})();

const checkResult = (maxPlotLength: number) => {
  if (maxPlotLength !== 36752) throw Error(`Wrong result (${maxPlotLength})`);
};

Deno.bench('jq (non-streaming)', async (b) => {
  let output = await new Deno.Command('jq', {
    args: ['max_by(.Plot | length).Plot | length', dataDecompPath],
  }).output();
  let maxPlotLength = Number(String.fromCharCode(...output.stdout));
  checkResult(maxPlotLength);
});

Deno.bench('json-stream-visit', { baseline: true }, async () => {
  let maxPlotLength = 0;
  await jsonsv.visit(streamChunks(data), jsonsv.array({
    Plot(plot: any) {
      maxPlotLength = Math.max(maxPlotLength, plot.length);
    }
  }));
  checkResult(maxPlotLength);
});

Deno.bench('JSONStream', async () => {
  let maxPlotLength = 0;
  await finished(
    Readable.from(streamChunks(data))
      .pipe(JSONStream.parse('*.Plot'))
      .on('data', (plot: any) => {
        maxPlotLength = Math.max(maxPlotLength, plot.length);
      })
  );
  checkResult(maxPlotLength);
});

Deno.bench('@streamparser/json', async () => {
  let maxPlotLength = 0;
  const jsonparser = new JSONParser({ paths: ['$.*.Plot'] });
  jsonparser.onValue = ({ value }) => {
    maxPlotLength = Math.max(maxPlotLength, (value as string).length);
  };
  for await (const chunk of streamChunks(data)) {
    jsonparser.write(chunk);
  }
  checkResult(maxPlotLength);
});

Deno.bench('bfj', { n: 1 }, async () => {
  let maxPlotLength = 0;
  const stream = Readable.from(streamChunks(data));
  const matches = bfj.match(stream, 'Plot');
  for await (const plot of matches) {
    if (typeof plot === 'string') {
      maxPlotLength = Math.max(maxPlotLength, plot.length);
    }
  }
  checkResult(maxPlotLength);
});
