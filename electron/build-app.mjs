// Packages the existing browser source without changing its defaults or source files.
import { build, transform } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.env.WORK_MOTIVATOR_SRC ?? join(here, '..'));
const out = resolve(process.env.WORK_MOTIVATOR_OUT ?? join(here, 'app', 'work-motivator.html'));
const read = (file) => readFileSync(join(root, file), 'utf8');
const js = await build({ entryPoints: [join(root, 'src/main.js')], bundle: true, minify: false, format: 'iife', write: false, loader: { '.png': 'dataurl', '.gif': 'dataurl' }, legalComments: 'none', charset: 'utf8' });
const css = await transform(read('src/style.css'), { loader: 'css', minify: false, legalComments: 'none', charset: 'utf8' });
const template = read('src/index.template.html').replace(/<!--[\s\S]*?-->/g, '');
for (const token of ['/*__CSS__*/', '/*__JS__*/']) {
  if (template.split(token).length !== 2) throw new Error(`Expected one ${token} placeholder.`);
}
const html = template
  .replace('/*__CSS__*/', () => css.code)
  .replace('/*__JS__*/', () => js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html, 'utf8');
console.log(`built ${out}`);
