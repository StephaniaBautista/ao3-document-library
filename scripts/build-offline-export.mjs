import { build } from 'esbuild';
await build({ entryPoints: ['lib/offline/export.ts'], bundle: true, format: 'esm', platform: 'browser', target: ['es2020'], minify: true, outfile: 'public/offline-export.js', legalComments: 'linked' });
