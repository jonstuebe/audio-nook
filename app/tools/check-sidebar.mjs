// Drives the macOS app under the platform's chrome and checks the window's own sidebar: rows
// select their section, ⌃⌘S collapses it, and again brings it back with the same row selected.
// `bun tools/check-sidebar.mjs` (it builds nothing: run `bun exact.mjs mac` first). The agent
// starts mock/server.ts itself.
import { spawnSync } from 'node:child_process';

const app = new URL('..', import.meta.url).pathname;
const ops = [
  'resize 1180x780', 'clock data',
  'type server http://127.0.0.1:13378', 'type username reader', 'type password listen', 'tap sign-in-button',
  'clock data', 'clock settle', 'state window',
  'tap tab-library-lib_kids', 'clock data', 'clock settle', 'state window',
  'type book-li_gruffalo key Control+Meta+s', 'clock +800 real', 'state window',
  'type book-li_gruffalo key Control+Meta+s', 'clock +800 real', 'state window',
];
const run = spawnSync('bun', ['exact.mjs', 'agent', 'macos', '--chrome', 'platform', '--reset-storage', ...ops], { cwd: app, encoding: 'utf8' });
const out = `${run.stdout}\n${run.stderr}`;
const seen = [...out.matchAll(/^sidebar (\{.*\})$/gm)].map((m) => JSON.parse(m[1]));
const expected = [
  { collapsed: false, selected: 0, why: 'signed in: Listen Now' },
  { collapsed: false, selected: 3, why: 'the Kids row' },
  { collapsed: true, selected: 3, why: '⌃⌘S hides the sidebar' },
  { collapsed: false, selected: 3, why: '⌃⌘S shows it again, Kids still selected' },
];
let failed = run.status !== 0 || seen.length !== expected.length;
expected.forEach((want, i) => {
  const got = seen[i];
  const ok = got && got.installed && got.collapsed === want.collapsed && got.selected === want.selected;
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${want.why}: collapsed=${got?.collapsed} selected=${got?.selected} rows=${got?.rows?.map((r) => r.title).join(', ')}`);
});
if (failed) { console.log(out.split('\n').filter((l) => /error|refused|FAIL/i.test(l)).slice(0, 10).join('\n')); process.exit(1); }
console.log(`sidebar: ${expected.length} checks passed`);
