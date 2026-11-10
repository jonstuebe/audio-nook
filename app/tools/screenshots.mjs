// Captures the README's macOS screenshots in light and dark mode, in the window as a person sees
// it (`--chrome platform`: AppKit's sidebar, toolbar and title bar). `bun tools/screenshots.mjs`
// after `bun exact.mjs mac`; the agent starts mock/server.ts itself. Writes docs/screenshots/.
import { spawnSync } from 'node:child_process';

const app = new URL('..', import.meta.url).pathname;
const out = new URL('../../docs/screenshots/', import.meta.url).pathname;
const shot = (name, scheme) => `screenshot ${out}${name}-${scheme}.png window`;
const signIn = ['type server http://127.0.0.1:13378', 'type username reader', 'type password listen', 'tap sign-in-button', 'clock data', 'clock settle'];
const settle = ['clock data', 'clock settle', 'clock +1500 real'];

for (const scheme of ['light', 'dark']) {
  const ops = [
    `prefer prefers-color-scheme ${scheme}`, 'resize 1180x780', 'clock data', ...signIn,
    'tap tab-library-lib_books', ...settle, shot('library', scheme),
    'tap tab-search', 'clock settle', 'type search the', ...settle, shot('search', scheme),
    'tap tab-library-lib_books', 'clock settle', 'tap book-li_dune', ...settle, shot('detail', scheme),
    'tap play', ...settle, 'tap play-pause', 'clock +800 real', shot('player', scheme),
    'back', 'clock settle', 'back', ...settle, shot('mini-player', scheme),
    'type book-li_dune key Control+Meta+s', 'clock +1200 real', shot('sidebar-collapsed', scheme),
    'type book-li_dune key Control+Meta+s', 'clock +800 real',
  ];
  const run = spawnSync('bun', ['exact.mjs', 'agent', 'macos', '--chrome', 'platform', '--reset-storage', ...ops], { cwd: app, encoding: 'utf8' });
  const lines = `${run.stdout}\n${run.stderr}`.split('\n');
  for (const l of lines.filter((l) => l.startsWith('screenshot ') || /error|refused/i.test(l))) console.log(l);
  if (run.status !== 0) process.exit(run.status ?? 1);
}
