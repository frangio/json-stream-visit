import * as path from '@std/path';

const denoJsonPath = path.join(Deno.env.get('INIT_CWD'), 'deno.json');

const { name, version } = JSON.parse(Deno.readTextFileSync(denoJsonPath));

const packageJson = {
  name,
  version,
  description: 'Simple and efficient streaming JSON processor.',
  author: 'Francisco Giordano <fg@frang.io>',
  license: 'MIT',
  repository: {
    type: 'git',
    url: 'git+https://github.com/frangio/json-stream-visit.git'
  },
  type: 'module',
  main: './dist/index.js',
  exports: './dist/index.js',
  types: './dist/index.d.ts',
  files: [
    './src/*.ts',
    './dist/*.{js,d.ts}{,.map}',
  ]
};

Deno.writeTextFileSync('package.json', JSON.stringify(packageJson, null, 2));
