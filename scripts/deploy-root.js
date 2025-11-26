#!/usr/bin/env node
/*
 Deploy build output to repository root for GitHub Pages when source is root of main branch.
 Steps:
 1. Run vite build (expected already done externally or we can spawn it)
 2. Backup existing root index.html to index.prev.html
 3. Copy dist/assets to ./assets (replace)
 4. Copy dist/index.html to root index.html and ensure script tag moved to end of body
 5. Add + commit + push
*/
import { execSync } from 'node:child_process';
import { existsSync, copyFileSync, rmSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function run(cmd) {
  console.log('[cmd]', cmd);
  execSync(cmd, { stdio: 'inherit' });
}

// 1. Build
run('vite build');

// 2. Backup index.html if exists
if (existsSync('index.html')) {
  copyFileSync('index.html', 'index.prev.html');
  console.log('Backed up existing index.html -> index.prev.html');
}

// 3. Copy assets
if (existsSync('assets')) {
  rmSync('assets', { recursive: true, force: true });
  console.log('Removed existing ./assets');
}
mkdirSync('assets');
for (const f of readdirSync('dist/assets')) {
  copyFileSync(join('dist/assets', f), join('assets', f));
}
console.log('Copied dist/assets -> ./assets');

// 4. Prepare index.html
let html = execSync('cat dist/index.html').toString();
// Remove any script tag in head pointing to ./assets/index-*.js
html = html.replace(/<script type="module" crossorigin src="\.\/assets\/index-[a-zA-Z0-9]+\.js"><\/script>/, '');
// Determine new index bundle
const bundle = readdirSync('dist/assets').find(f => /^index-[A-Za-z0-9]+\.js$/.test(f));
if (!bundle) {
  console.error('Could not find index-*.js bundle');
  process.exit(1);
}
// Inject at end of body before closing tag
html = html.replace(/<\/body>/, `  <script type="module" crossorigin src="./assets/${bundle}"></script>\n</body>`);
writeFileSync('index.html', html);
console.log('Wrote new root index.html with bundle', bundle);

// 5. Git add commit push
try {
  run('git add assets index.html index.prev.html');
  run("git commit -m 'Deploy root build'");
  run('git push');
  console.log('Deployment committed & pushed');
} catch (e) {
  console.log('Git commit/push skipped or failed (possibly no changes).');
}
