import * as path from '@std/path';

const root = Deno.env.get('INIT_CWD') ?? '.';
const denoJsonPath = path.join(root, 'deno.json');

const { name, version, license, publish } = JSON.parse(Deno.readTextFileSync(denoJsonPath));

const packageJson = {
  name: name.replace(/^@frangio\//, ''),
  version,
  description: 'Simple and efficient streaming JSON processor.',
  author: 'Francisco Giordano <fg@frang.io>',
  license,
  repository: {
    type: 'git',
    url: 'git+https://github.com/frangio/json-stream-visit.git'
  },
  type: 'module',
  main: './dist/index.js',
  exports: './dist/index.js',
  types: './dist/index.d.ts',
  files: [
    ...publish.include,
    ...publish.exclude.map((e: string) => '!' + e),
    'dist/**/*.{js,d.ts}{,.map}',
  ]
};

Deno.writeTextFileSync('package.json', JSON.stringify(packageJson, null, 2));
