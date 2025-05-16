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
  main: './index.js',
  exports: './index.js',
  types: './index.d.ts',
  files: [
    './index.js',
    './index.d.ts'
  ]
};

Deno.mkdirSync('npm', { recursive: true });
Deno.writeTextFileSync('npm/package.json', JSON.stringify(packageJson, null, 2));
