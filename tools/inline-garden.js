/*
 * inline-garden.js — regenerate the inlined copy of src/garden.js inside index.html.
 *
 * index.html is a single self-contained file so it can be downloaded and opened
 * standalone in a browser. The garden model (src/garden.js) is inlined into it
 * and kept in sync by this script; test/app.test.js fails if they ever diverge.
 *
 * Usage: node tools/inline-garden.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const gardenPath = path.join(root, 'src', 'garden.js');

const START = '<!-- BEGIN inlined garden.js -- keep in sync with src/garden.js -->';
const END = '<!-- END inlined garden.js -->';

const indexHtml = fs.readFileSync(indexPath, 'utf8');
const gardenSrc = fs.readFileSync(gardenPath, 'utf8');

// If an inlined block already exists, swap its contents; otherwise replace the
// external <script src> tag.
let next;
if (indexHtml.includes(START)) {
  const i = indexHtml.indexOf(START);
  const j = indexHtml.indexOf(END, i);
  if (i === -1 || j === -1) {
    console.error('found BEGIN marker but not END marker; aborting');
    process.exit(1);
  }
  const block = START + '\n<script>\n' + gardenSrc + '\n</script>\n' + END;
  next = indexHtml.slice(0, i) + block + indexHtml.slice(j + END.length);
} else if (/<script src="src\/garden\.js"><\/script>/.test(indexHtml)) {
  const block = START + '\n<script>\n' + gardenSrc + '\n</script>\n' + END;
  next = indexHtml.replace(/<script src="src\/garden\.js"><\/script>/, block);
} else {
  console.error('neither an inlined block nor a <script src="src/garden.js"> tag found; aborting');
  process.exit(1);
}

fs.writeFileSync(indexPath, next);
console.log(`inlined src/garden.js into index.html (${next.length} bytes)`);
