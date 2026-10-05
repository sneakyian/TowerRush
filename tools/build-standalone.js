// Builds play.html: a single self-contained file that runs when opened
// directly from disk (file://), unlike index.html which needs a web server
// because browsers block ES module loading over file://.
//
// Usage: node tools/build-standalone.js

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Concatenate the modules in dependency order and strip module syntax —
// in a single script tag they all share one scope.
const sources = ['config', 'levels', 'path', 'game', 'effects', 'render', 'main']
  .map((name) => readFileSync(join(root, 'src', `${name}.js`), 'utf8'));

const combined = sources
  .join('\n')
  .split('\n')
  .filter((line) => !line.startsWith('import '))
  .map((line) => line.replace(/^export /, ''))
  .join('\n');

const html = readFileSync(join(root, 'index.html'), 'utf8').replace(
  '<script type="module" src="src/main.js"></script>',
  `<script>\n${combined}\n</script>`,
);

if (html.includes('src/main.js')) {
  throw new Error('failed to inline the game script into play.html');
}

writeFileSync(join(root, 'play.html'), html);
console.log('wrote play.html');
