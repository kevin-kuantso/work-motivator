import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

const js = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  minify: false,
  format: 'iife',
  write: false,
  legalComments: 'none',
});
const css = await transform(read('src/style.css'), {
  loader: 'css',
  minify: false,
  legalComments: 'none',
});

// Comments are stripped (esbuild drops JS/CSS comments; HTML comments removed here)
// so source-reference URLs in comments never reach the output.
const template = read('src/index.template.html').replace(/<!--[\s\S]*?-->/g, '');
// Function replacers avoid `$` special patterns in String.replace.
const html = template
  .replace('/*__CSS__*/', () => css.code)
  .replace('/*__JS__*/', () => js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/work-motivator.html'), html);
console.log('built dist/work-motivator.html');
