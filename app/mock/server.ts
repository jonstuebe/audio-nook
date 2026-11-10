// A mock Audiobookshelf server for Audio Nook's tests: fixture JSON and a generated tone.
// `bun exact.mjs test` starts it at app.ts's local address (PORT); run it by hand with
// `bun mock/server.ts` to point the app at it. It keeps everything in memory.
//
// Auth is ABS 3.x's (server/Auth.js, auth/TokenManager.js): /login answers `user.accessToken`, and
// `user.refreshToken` when asked with `x-return-tokens: true`; access tokens are short-lived
// (ACCESS_TTL_MS, default 1 h) and accepted as a Bearer or `?token=`; POST /auth/refresh with
// `x-refresh-token` rotates both; /logout ends the refresh token's session. The `legacy` account
// is a pre-2.26 server's: one `user.token` that never expires and no refresh token.
import { BOOKS, LIBRARIES, USER, LEGACY_USER, LEGACY_TOKEN, PASSWORD, coverPng } from './fixtures.ts';

const PORT = Number(process.env.PORT ?? 13378);

// One mono 16-bit tone per track, 8 kHz: small enough to generate at start.
function toneWav(seconds: number, hz: number): Uint8Array {
  const rate = 8000, n = Math.round(seconds * rate);
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 2000), true);
  return new Uint8Array(buf);
}
const audio = new Map<string, Uint8Array>();
for (const b of BOOKS) b.tracks.forEach((t, i) => audio.set(`${b.id}/${i}`, toneWav(t.duration, 220 + i * 110)));

type Session = { id: string; itemId: string; currentTime: number; syncs: number; closed: boolean };
const sessions = new Map<string, Session>();
const progress = new Map<string, { currentTime: number; progress: number; lastUpdate: number }>();
progress.set('li_dune', { currentTime: 45, progress: 45 / 120, lastUpdate: 1_700_000_000_000 });
let nextSession = 1;

const json = (body: unknown, status = 200) => Response.json(body, { status });

const ACCESS_TTL_MS = Number(process.env.ACCESS_TTL_MS ?? 60 * 60 * 1000);
const access = new Map<string, { username: string; expires: number }>();
const refresh = new Map<string, string>(); // refresh token → username
const counts = { logins: 0, refreshes: 0, refusedRefreshes: 0, logoutsWithRefreshToken: 0 };
let nextToken = 1;
function issue(username: string) {
  const n = nextToken++;
  const accessToken = `at-${n}`, refreshToken = `rt-${n}`;
  access.set(accessToken, { username, expires: Date.now() + ACCESS_TTL_MS });
  refresh.set(refreshToken, username);
  return { accessToken, refreshToken };
}
function authed(req: Request, url: URL) {
  const token = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? url.searchParams.get('token') ?? '';
  if (token === LEGACY_TOKEN) return true;
  const a = access.get(token);
  return !!a && a.expires > Date.now();
}
const userOf = (username: string) => (username === LEGACY_USER.username ? LEGACY_USER : USER);
const loginPayload = (username: string, tokens: Record<string, string | null>) => ({
  user: { ...userOf(username), ...tokens, mediaProgress: BOOKS.map((b) => progressOf(b.id)).filter(Boolean) },
  userDefaultLibraryId: LIBRARIES[0].id,
  serverSettings: { version: username === LEGACY_USER.username ? '2.17.0' : '3.0.0-beta' },
});

function minified(b: (typeof BOOKS)[number]) {
  return {
    id: b.id, libraryId: b.libraryId, mediaType: 'book', addedAt: b.addedAt,
    media: {
      metadata: { title: b.title, authorName: b.author, narratorName: b.narrator },
      duration: b.tracks.reduce((s, t) => s + t.duration, 0), numTracks: b.tracks.length,
      numChapters: b.chapters.length, coverPath: `/metadata/items/${b.id}/cover.jpg`,
    },
  };
}
function expanded(b: (typeof BOOKS)[number]) {
  const m = minified(b);
  return {
    ...m,
    media: {
      ...m.media,
      metadata: { title: b.title, authors: [{ id: 'au1', name: b.author }], narrators: [b.narrator], description: b.description },
      chapters: b.chapters,
      tracks: tracksOf(b),
    },
  };
}
function tracksOf(b: (typeof BOOKS)[number]) {
  let offset = 0;
  return b.tracks.map((t, i) => {
    const track = { index: i + 1, startOffset: offset, duration: t.duration, title: t.title, contentUrl: `/api/items/${b.id}/file/${i}`, mimeType: 'audio/wav' };
    offset += t.duration;
    return track;
  });
}
function progressOf(id: string) {
  const p = progress.get(id);
  const b = BOOKS.find((x) => x.id === id)!;
  const duration = b.tracks.reduce((s, t) => s + t.duration, 0);
  return p ? { id: `mp_${id}`, libraryItemId: id, duration, progress: p.progress, currentTime: p.currentTime, isFinished: false, lastUpdate: p.lastUpdate } : null;
}

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    // The web host's page is another origin; Audiobookshelf answers CORS too.
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const res = await route(req);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, range, x-return-tokens, x-refresh-token',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-expose-headers': 'content-range, accept-ranges, content-length',
};

async function route(req: Request): Promise<Response> {
    const url = new URL(req.url), path = url.pathname, method = req.method;
    if (path === '/ping') return json({ success: true });
    if (path === '/status') return json({ app: 'audiobookshelf', serverVersion: '3.0.0-beta', isInit: true, authMethods: ['local'] });
    if (path === '/login' && method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
      const known = body.username === USER.username || body.username === LEGACY_USER.username;
      if (!known || body.password !== PASSWORD) return new Response('Unauthorized', { status: 401 });
      counts.logins++;
      if (body.username === LEGACY_USER.username) return json(loginPayload(body.username!, { token: LEGACY_TOKEN }));
      const t = issue(body.username!);
      // Without x-return-tokens ABS sets the refresh token as a cookie and answers null for it.
      return json(loginPayload(body.username!, { accessToken: t.accessToken, refreshToken: req.headers.get('x-return-tokens') === 'true' ? t.refreshToken : null }));
    }
    if (path === '/auth/refresh' && method === 'POST') {
      const old = req.headers.get('x-refresh-token') ?? '';
      const username = refresh.get(old);
      if (!username) {
        counts.refusedRefreshes++;
        return json({ error: old ? 'Invalid refresh token' : 'No refresh token provided' }, 401);
      }
      refresh.delete(old);
      counts.refreshes++;
      return json(loginPayload(username, issue(username)));
    }
    if (path === '/logout' && method === 'POST') {
      const rt = req.headers.get('x-refresh-token');
      if (rt && refresh.delete(rt)) counts.logoutsWithRefreshToken++;
      return json({});
    }
    // Test-only doors, as statuses a test's `request` step reads (200 when the condition holds).
    if (path === '/__mock/expire' && method === 'POST') {
      for (const a of access.values()) a.expires = 0;
      return json({ expired: access.size });
    }
    if (path === '/__mock/reset' && method === 'POST') {
      progress.clear();
      progress.set('li_dune', { currentTime: 45, progress: 45 / 120, lastUpdate: 1_700_000_000_000 });
      return json({ reset: true });
    }
    if (path === '/__mock/revoke' && method === 'POST') {
      for (const a of access.values()) a.expires = 0;
      refresh.clear();
      return json({ revoked: true });
    }
    if (path === '/__mock/auth') {
      const at = (k: keyof typeof counts) => Number(url.searchParams.get(k) ?? 0) <= counts[k];
      const ok = (Object.keys(counts) as (keyof typeof counts)[]).every(at);
      return json(counts, ok ? 200 : 404);
    }
    // Test-only door: how many syncs and closes the server has seen, as a status the test's `request` reads.
    if (path === '/__mock/sessions') {
      const all = [...sessions.values()];
      const min = Number(url.searchParams.get('syncs') ?? 0), closed = url.searchParams.get('closed') === '1';
      const ok = all.some((s) => s.syncs >= min && (!closed || s.closed));
      return json({ sessions: all }, ok ? 200 : 404);
    }
    // Covers need no auth in ABS (Auth.js `ignorePatterns`).
    let cover = path.match(/^\/api\/items\/([^/]+)\/cover$/);
    if (cover) {
      const b = BOOKS.find((x) => x.id === cover![1]);
      return b ? new Response(coverPng(b), { headers: { 'content-type': 'image/png' } }) : new Response('Not found', { status: 404 });
    }
    if (!authed(req, url)) return new Response('Unauthorized', { status: 401 });
    if (path === '/api/me') return json({ ...USER, mediaProgress: BOOKS.map((b) => progressOf(b.id)).filter(Boolean) });
    if (path === '/api/libraries') return json({ libraries: LIBRARIES });
    let m = path.match(/^\/api\/libraries\/([^/]+)\/items$/);
    if (m) {
      const results = BOOKS.filter((b) => b.libraryId === m![1]).map(minified);
      return json({ results, total: results.length, limit: 0, page: 0 });
    }
    if ((m = path.match(/^\/api\/libraries\/([^/]+)\/search$/))) {
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      if (!q) return new Response('Invalid request. Query param "q" must be a string', { status: 400 });
      const inLib = BOOKS.filter((b) => b.libraryId === m![1]);
      const book = inLib.filter((b) => b.title.toLowerCase().includes(q)).map((b) => ({ libraryItem: expanded(b) }));
      const authors = [...new Set(inLib.filter((b) => b.author.toLowerCase().includes(q)).map((b) => b.author))]
        .map((name, i) => ({ id: `au_${i}`, name, numBooks: inLib.filter((b) => b.author === name).length }));
      return json({ book, narrators: [], tags: [], genres: [], series: [], authors });
    }
    if (path === '/api/me/items-in-progress') {
      const libraryItems = BOOKS.filter((b) => progress.has(b.id)).map((b) => ({ ...minified(b), progressLastUpdate: progress.get(b.id)!.lastUpdate }));
      return json({ libraryItems });
    }
    if ((m = path.match(/^\/api\/items\/([^/]+)\/file\/(\d+)$/))) {
      const bytes = audio.get(`${m[1]}/${m[2]}`);
      if (!bytes) return new Response('Not found', { status: 404 });
      return rangeResponse(req, bytes, 'audio/wav');
    }
    if ((m = path.match(/^\/api\/items\/([^/]+)\/play$/)) && method === 'POST') {
      const b = BOOKS.find((x) => x.id === m![1]);
      if (!b) return new Response('Not found', { status: 404 });
      const id = `ps_${nextSession++}`;
      const currentTime = progress.get(b.id)?.currentTime ?? 0;
      sessions.set(id, { id, itemId: b.id, currentTime, syncs: 0, closed: false });
      return json({
        id, libraryItemId: b.id, mediaType: 'book', displayTitle: b.title, displayAuthor: b.author,
        duration: b.tracks.reduce((s, t) => s + t.duration, 0), currentTime, chapters: b.chapters, audioTracks: tracksOf(b),
      });
    }
    if ((m = path.match(/^\/api\/items\/([^/]+)$/))) {
      const b = BOOKS.find((x) => x.id === m![1]);
      return b ? json({ ...expanded(b), userMediaProgress: progressOf(b.id) }) : new Response('Not found', { status: 404 });
    }
    if ((m = path.match(/^\/api\/session\/([^/]+)\/(sync|close)$/)) && method === 'POST') {
      const s = sessions.get(m[1]);
      if (!s) return new Response('Not found', { status: 404 });
      const body = (await req.json().catch(() => ({}))) as { currentTime?: number; duration?: number };
      if (typeof body.currentTime === 'number') {
        s.currentTime = body.currentTime;
        const duration = body.duration || 1;
        progress.set(s.itemId, { currentTime: body.currentTime, progress: body.currentTime / duration, lastUpdate: Date.now() });
      }
      if (m[2] === 'sync') s.syncs++; else s.closed = true;
      return new Response('OK');
    }
    return new Response('Not found', { status: 404 });
}

// AVPlayer streams with Range requests; answer them as a file server does.
function rangeResponse(req: Request, bytes: Uint8Array, type: string) {
  const range = req.headers.get('range')?.match(/bytes=(\d*)-(\d*)/);
  const headers = { 'content-type': type, 'accept-ranges': 'bytes' };
  if (!range) return new Response(bytes, { headers: { ...headers, 'content-length': String(bytes.length) } });
  const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
  return new Response(bytes.slice(start, end + 1), {
    status: 206,
    headers: { ...headers, 'content-range': `bytes ${start}-${end}/${bytes.length}`, 'content-length': String(end - start + 1) },
  });
}

console.log(`mock audiobookshelf at http://127.0.0.1:${PORT} (user ${USER.username} / ${PASSWORD})`);
