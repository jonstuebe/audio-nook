// Drives the macOS app under the platform's chrome and checks the sidebar in the real window: a
// row selects its section, ↓ moves the selection, ⌃⌘S folds the sidebar away so the page takes
// its width, and again brings it back with the same row selected. The sidebar is the app's own
// (sidebar.contract), so what it selects is read from state and where the page sits from layout.
// `bun tools/check-sidebar.mjs` (it builds nothing: run `bun exact.mjs mac` first). The agent
// starts mock/server.ts itself.
import { spawnSync } from 'node:child_process';

const app = new URL('..', import.meta.url).pathname;
// Each check: the steps, then the reads; every read prints a line in order.
const look = ['state sidebarCurrent', 'state sidebarOpen', 'layout panels'];
const ops = [
  'resize 1180x780', 'clock data',
  'type server http://127.0.0.1:13378', 'type username reader', 'type password listen', 'tap sign-in-button',
  'clock data', 'clock settle', ...look,
  'tap tab-library-lib_kids', 'clock data', 'clock settle', ...look,
  'type tab-library-lib_kids key ArrowDown', 'clock data', 'clock settle', ...look,
  'type root key Control+Meta+s', 'clock settle', 'clock +400 real', ...look,
  'type root key Control+Meta+s', 'clock settle', 'clock +400 real', ...look,
];
const run = spawnSync('bun', ['exact.mjs', 'agent', 'macos', '--chrome', 'platform', '--reset-storage', ...ops], { cwd: app, encoding: 'utf8' });
const out = `${run.stdout}\n${run.stderr}`;
const lines = out.split('\n');
// The reads, in order: a JSON value for each `state`, the first viewport line for each `layout`.
const reads = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (/^("[^"]*"|true|false)$/.test(l)) reads.push(JSON.parse(l));
  const space = l.match(/^\s+space viewport (-?[\d.]+),/);
  if (space) reads.push(Number(space[1]));
}
const seen = [];
for (let i = 0; i + 2 < reads.length + 1; i += 3) seen.push({ current: reads[i], open: reads[i + 1], pageX: reads[i + 2] });
const expected = [
  { current: 'home', open: true, beside: true, why: 'signed in: Listen Now selected, the page beside the sidebar' },
  { current: 'lib:lib_kids', open: true, beside: true, why: 'the Kids row selects Kids' },
  { current: 'lib:lib_archive', open: true, beside: true, why: '↓ moves the selection to Archive' },
  { current: 'lib:lib_archive', open: false, beside: false, why: '⌃⌘S folds the sidebar away and the page takes its width' },
  { current: 'lib:lib_archive', open: true, beside: true, why: '⌃⌘S brings it back, Archive still selected' },
];
let failed = run.status !== 0 || seen.length !== expected.length;
expected.forEach((want, i) => {
  const got = seen[i];
  // Beside the sidebar the page starts past its 220-point width; folded away, at the window's edge.
  const beside = got ? got.pageX > 200 : undefined;
  const ok = got && got.current === want.current && got.open === want.open && beside === want.beside;
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${want.why}: selected=${got?.current} open=${got?.open} pageX=${got?.pageX}`);
});
if (failed) { console.log(out.split('\n').filter((l) => /error|refused|FAIL/i.test(l)).slice(0, 10).join('\n')); process.exit(1); }
console.log(`sidebar: ${expected.length} checks passed`);
