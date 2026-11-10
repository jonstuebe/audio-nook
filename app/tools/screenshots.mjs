// Captures the README's macOS screenshots in light and dark mode, in the window as a person sees
// it (`--chrome platform`: AppKit's sidebar, toolbar and title bar). `bun tools/screenshots.mjs
// [scene …]` after `bun exact.mjs mac`; with no scene it takes them all. The agent starts
// mock/server.ts itself. Writes docs/screenshots/<name>-<light|dark>.png.
import { spawnSync } from 'node:child_process';

const app = new URL('..', import.meta.url).pathname;
const out = new URL('../../docs/screenshots/', import.meta.url).pathname;
const signIn = ['type server http://127.0.0.1:13378', 'type username reader', 'type password listen', 'tap sign-in-button', 'clock data', 'clock settle'];
const settle = ['clock data', 'clock settle', 'clock +1500 real'];
const play = ['tap play', ...settle, 'tap play-pause', 'clock +800 real'];
const pump = (n) => Array.from({ length: n }, () => ['clock +300', 'clock data']).flat();

// Each scene: the ops after sign-in, with `shot <name>` where a picture is taken.
const scenes = {
  main: [
    'tap tab-library-lib_books', ...settle, 'tap book-li_hobbit hover', 'clock +400 real', 'shot library',
    'tap tab-search', 'clock settle', 'type search the', ...settle, 'shot search',
    'tap tab-library-lib_books', 'clock settle', 'tap book-li_dune', ...settle, 'shot detail',
    ...play, 'shot player',
    'back', 'clock settle', 'back', ...settle, 'shot mini-player',
    'type book-li_dune key Control+Meta+s', 'clock +1200 real', 'shot sidebar-collapsed',
    'type book-li_dune key Control+Meta+s', 'clock +800 real',
  ],
  'mini-player-window': [
    'tap continue-li_dune', ...settle, ...play, 'tap player-mini-window', 'clock +2500 real', 'panel mini-player-window',
  ],
  layouts: [
    ...settle, 'clock +1000 real', 'shot home-shelves',
    'tap tab-library-lib_books', ...settle, 'tap view-authors', ...settle, 'tap author-au_herbert', ...settle, 'clock +800 real', 'shot author',
    'back', 'clock settle', 'tap view-series', ...settle, 'tap series-se_dune', ...settle, 'shot series',
    'back', 'clock settle', 'tap view-books', ...settle, 'tap layout-button', ...settle, 'shot list-view', 'tap layout-button', 'clock settle',
  ],
  downloads: [
    'tap tab-library-lib_books', ...settle, 'tap book-li_martian', ...settle, 'tap download', 'clock data', ...pump(2), 'back', 'clock settle',
    'tap book-li_dune', ...settle, 'tap download', 'clock data', ...pump(1), 'clock settle', 'shot download-detail',
    'back', 'clock settle', 'tap tab-downloads', 'clock data', 'clock settle', 'shot downloads',
  ],
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenes);
for (const name of wanted) {
  if (!scenes[name]) { console.error(`no scene ${name}: ${Object.keys(scenes).join(', ')}`); process.exit(2); }
  for (const scheme of ['light', 'dark']) {
    const ops = [`prefer prefers-color-scheme ${scheme}`, 'resize 1180x780', 'clock data', ...signIn, ...scenes[name]].flatMap((op) =>
      op.startsWith('shot ') ? [`screenshot ${out}${op.slice(5)}-${scheme}.png window`] :
      op.startsWith('panel ') ? [`type mini-window snapshot:${out}${op.slice(6)}-${scheme}.png`] : [op]);
    const run = spawnSync('bun', ['exact.mjs', 'agent', 'macos', '--chrome', 'platform', '--reset-storage', ...ops], { cwd: app, encoding: 'utf8' });
    const lines = `${run.stdout}\n${run.stderr}`.split('\n');
    for (const l of lines.filter((l) => l.startsWith('screenshot ') || (l.includes('mini-window') && l.startsWith('typed')) || /error|refused/i.test(l))) console.log(l);
    if (run.status !== 0) process.exit(run.status ?? 1);
  }
}
