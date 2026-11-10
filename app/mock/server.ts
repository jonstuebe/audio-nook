// A mock Audiobookshelf server for Audio Nook's tests: fixture JSON and a generated tone.
// `bun exact.mjs test` starts it at app.ts's local address (PORT); run it by hand with
// `bun mock/server.ts` to point the app at it. It keeps everything in memory.
//
// Auth is ABS 3.x's (server/Auth.js, auth/TokenManager.js): /login answers `user.accessToken`, and
// `user.refreshToken` when asked with `x-return-tokens: true`; access tokens are short-lived
// (ACCESS_TTL_MS, default 1 h) and accepted as a Bearer or `?token=`; POST /auth/refresh with
// `x-refresh-token` rotates both; /logout ends the refresh token's session. The `legacy` account
// is a pre-2.26 server's: one `user.token` that never expires and no refresh token.
import { AUTHORS, BOOKS, COLLECTIONS, LIBRARIES, USER, LEGACY_USER, LEGACY_TOKEN, PASSWORD, coverPng } from './fixtures.ts';

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
// Made on first request: sixty-odd books of tone would be slow to make up front.
const made = new Map<string, Uint8Array>();
const audio = {
  get(key: string): Uint8Array | undefined {
    const hit = made.get(key);
    if (hit) return hit;
    const [id, i] = key.split('/');
    const t = BOOKS.find((b) => b.id === id)?.tracks[Number(i)];
    if (!t) return undefined;
    const bytes = toneWav(t.duration, 220 + Number(i) * 110);
    made.set(key, bytes);
    return bytes;
  },
};
const wavSize = (seconds: number) => 44 + Math.round(seconds * 8000) * 2;

type Session = { id: string; itemId: string; currentTime: number; syncs: number; closed: boolean };
const sessions = new Map<string, Session>();
const progress = new Map<string, { currentTime: number; progress: number; lastUpdate: number }>();
progress.set('li_dune', { currentTime: 45, progress: 45 / 120, lastUpdate: 1_700_000_000_000 });
let nextSession = 1;

const json = (body: unknown, status = 200) => Response.json(body, { status });

const ACCESS_TTL_MS = Number(process.env.ACCESS_TTL_MS ?? 60 * 60 * 1000);
const access = new Map<string, { username: string; expires: number }>();
const refresh = new Map<string, string>(); // refresh token → username
const counts = { logins: 0, refreshes: 0, refusedRefreshes: 0, logoutsWithRefreshToken: 0, progressBatches: 0 };
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
      metadata: { title: b.title, authorName: b.author, narratorName: b.narrator, seriesName: b.series ? `${b.series.name} #${b.series.sequence}` : '' },
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
      metadata: { title: b.title, authors: [{ id: b.authorId, name: b.author }], narrators: [b.narrator], description: b.description,
        series: b.series ? [{ id: b.series.id, name: b.series.name, sequence: b.series.sequence }] : [] },
      chapters: b.chapters,
      tracks: tracksOf(b),
    },
  };
}
function tracksOf(b: (typeof BOOKS)[number]) {
  let offset = 0;
  return b.tracks.map((t, i) => {
    // AudioTrack.toJSON: its file's metadata names the size (FileMetadata).
    const size = wavSize(t.duration);
    const track = { index: i + 1, startOffset: offset, duration: t.duration, title: t.title, contentUrl: `/api/items/${b.id}/file/${i}`, mimeType: 'audio/wav',
      metadata: { filename: `track-${i + 1}.wav`, ext: '.wav', size } };
    offset += t.duration;
    return track;
  });
}
// libraryItemsBookFilters' progress values: what the listener has done with a book.
function progressState(id: string): string {
  const p = progress.get(id);
  return !p || p.currentTime <= 0 ? 'not-started' : p.progress >= 1 ? 'finished' : 'in-progress';
}
function authorJson(a: (typeof AUTHORS)[number], libraryId: string) {
  const numBooks = BOOKS.filter((b) => b.authorId === a.id && (!libraryId || b.libraryId === libraryId)).length;
  return { id: a.id, asin: null, name: a.name, description: a.description || null, imagePath: a.image ? `/metadata/authors/${a.id}.jpg` : null,
    libraryId: libraryId || 'lib_books', addedAt: 1_690_000_000_000, updatedAt: 1_690_000_000_000, numBooks };
}
function seriesOf(libraryId: string) {
  const map = new Map<string, { id: string; name: string; description: null; addedAt: number; books: ReturnType<typeof minified>[] }>();
  for (const b of BOOKS.filter((b) => b.libraryId === libraryId && b.series).sort((x, y) => Number(x.series!.sequence) - Number(y.series!.sequence))) {
    const entry = map.get(b.series!.id) ?? { id: b.series!.id, name: b.series!.name, description: null, addedAt: b.addedAt, books: [] };
    entry.books.push(minified(b));
    entry.addedAt = Math.max(entry.addedAt, b.addedAt);
    map.set(b.series!.id, entry);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function collectionJson(c: (typeof COLLECTIONS)[number]) {
  return { id: c.id, libraryId: c.libraryId, name: c.name, description: c.description, books: c.bookIds.map((id) => expanded(BOOKS.find((b) => b.id === id)!)), lastUpdate: 0, createdAt: 0 };
}
function progressOf(id: string) {
  const p = progress.get(id);
  const b = BOOKS.find((x) => x.id === id)!;
  const duration = b.tracks.reduce((s, t) => s + t.duration, 0);
  return p ? { id: `mp_${id}`, libraryItemId: id, duration, progress: p.progress, currentTime: p.currentTime, isFinished: p.progress >= 1, lastUpdate: p.lastUpdate } : null;
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
    // What PATCH /api/me/progress/batch/update has been sent: 200 when `item` has been synced at
    // or past `at` seconds, at least `batches` times.
    if (path === '/__mock/progress') {
      const item = url.searchParams.get('item') ?? '', at = Number(url.searchParams.get('at') ?? 0);
      const p = progress.get(item);
      const ok = counts.progressBatches >= Number(url.searchParams.get('batches') ?? 1) && !!p && p.currentTime >= at;
      return json({ batches: counts.progressBatches, progress: p ?? null }, ok ? 200 : 404);
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
    // Author photos need no auth either (`ignorePatterns`); an author without one is a 404.
    const photo = path.match(/^\/api\/authors\/([^/]+)\/image$/);
    if (photo) {
      const a = AUTHORS.find((x) => x.id === photo[1]);
      return a?.image ? new Response(coverPng({ id: `author:${a.id}`, color: a.image }), { headers: { 'content-type': 'image/png' } }) : new Response('Not Found', { status: 404 });
    }
    // Covers need no auth in ABS (Auth.js `ignorePatterns`).
    let cover = path.match(/^\/api\/items\/([^/]+)\/cover$/);
    if (cover) {
      const b = BOOKS.find((x) => x.id === cover![1]);
      return b ? new Response(coverPng(b), { headers: { 'content-type': 'image/png' } }) : new Response('Not found', { status: 404 });
    }
    if (!authed(req, url)) return new Response('Unauthorized', { status: 401 });
    // MeController.batchUpdateMediaProgress / createUpdateMediaProgress / getMediaProgress.
    if (path === '/api/me/progress/batch/update' && method === 'PATCH') {
      const items = (await req.json().catch(() => [])) as { libraryItemId?: string; currentTime?: number; progress?: number }[];
      if (!Array.isArray(items) || !items.length) return new Response('Missing request payload', { status: 400 });
      for (const it of items) if (it.libraryItemId && typeof it.currentTime === 'number') progress.set(it.libraryItemId, { currentTime: it.currentTime, progress: it.progress ?? 0, lastUpdate: Date.now() });
      counts.progressBatches++;
      return new Response('OK');
    }
    let pm = path.match(/^\/api\/me\/progress\/([^/]+)$/);
    if (pm && method === 'PATCH') {
      // createUpdateMediaProgress: fields left out keep their values; isFinished finishes the book.
      const it = (await req.json().catch(() => ({}))) as { currentTime?: number; progress?: number; isFinished?: boolean };
      const was = progress.get(pm[1]);
      const finished = it.isFinished ?? (was ? was.progress >= 1 : false);
      const currentTime = it.currentTime ?? was?.currentTime ?? 0;
      progress.set(pm[1], { currentTime: finished && currentTime <= 0 ? 1 : currentTime, progress: finished ? 1 : it.progress ?? (was && was.progress < 1 ? was.progress : 0), lastUpdate: Date.now() });
      return new Response('OK');
    }
    if (pm) {
      const p = progressOf(pm[1]);
      return p ? json(p) : new Response('Not Found', { status: 404 });
    }
    if (path === '/api/me') return json({ ...USER, mediaProgress: BOOKS.map((b) => progressOf(b.id)).filter(Boolean) });
    if (path === '/api/libraries') return json({ libraries: LIBRARIES });
    // LibraryController.getLibraryItems: sort, desc, filter (group.<base64 value>), limit and page.
    let m = path.match(/^\/api\/libraries\/([^/]+)\/items$/);
    if (m) {
      let all = BOOKS.filter((b) => b.libraryId === m![1]);
      const filter = url.searchParams.get('filter') ?? '';
      const [group, encoded] = [filter.split('.')[0], filter.split('.').slice(1).join('.')];
      const value = encoded ? decodeURIComponent(atob(decodeURIComponent(encoded))) : '';
      if (group === 'progress') all = all.filter((b) => progressState(b.id) === value);
      if (group === 'series') all = all.filter((b) => b.series?.id === value);
      const sort = url.searchParams.get('sort') ?? 'media.metadata.title', desc = url.searchParams.get('desc') === '1';
      const key = (b: (typeof BOOKS)[number]): string | number =>
        sort === 'addedAt' ? b.addedAt : sort === 'media.metadata.authorName' ? b.author.toLowerCase() : sort === 'progress' ? (progress.get(b.id)?.lastUpdate ?? 0)
        : sort === 'sequence' ? Number(b.series?.sequence ?? 0) : b.title.toLowerCase();
      all = [...all].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.title.localeCompare(b.title)) * (desc ? -1 : 1));
      const limit = Number(url.searchParams.get('limit') ?? 0), page = Number(url.searchParams.get('page') ?? 0);
      const results = (limit ? all.slice(page * limit, page * limit + limit) : all).map(minified);
      return json({ results, total: all.length, limit, page, sortBy: sort, sortDesc: desc, filterBy: filter });
    }
    // LibraryController.getUserPersonalizedShelves → LibraryItem.getPersonalizedShelves: non-empty shelves only.
    if ((m = path.match(/^\/api\/libraries\/([^/]+)\/personalized$/))) {
      const inLib = BOOKS.filter((b) => b.libraryId === m![1]);
      const limit = Number(url.searchParams.get('limit') ?? 10);
      const started = inLib.filter((b) => progressState(b.id) === 'in-progress').sort((a, b) => progress.get(b.id)!.lastUpdate - progress.get(a.id)!.lastUpdate);
      const recent = [...inLib].sort((a, b) => b.addedAt - a.addedAt).slice(0, limit);
      const discover = inLib.filter((b) => progressState(b.id) === 'not-started').sort((a, b) => a.title.localeCompare(b.title)).slice(0, limit);
      const series = seriesOf(m[1]).slice(0, limit);
      const authors = AUTHORS.filter((a) => inLib.some((b) => b.authorId === a.id)).slice(0, limit).map((a) => authorJson(a, m![1]));
      const shelves = [
        { id: 'continue-listening', label: 'Continue Listening', labelStringKey: 'LabelContinueListening', type: 'book', entities: started.map(minified), total: started.length },
        { id: 'recently-added', label: 'Recently Added', labelStringKey: 'LabelRecentlyAdded', type: 'book', entities: recent.map(minified), total: inLib.length },
        { id: 'recent-series', label: 'Recent Series', labelStringKey: 'LabelRecentSeries', type: 'series', entities: series, total: series.length },
        { id: 'discover', label: 'Discover', labelStringKey: 'LabelDiscover', type: 'book', entities: discover.map(minified), total: discover.length },
        { id: 'newest-authors', label: 'Newest Authors', labelStringKey: 'LabelNewestAuthors', type: 'authors', entities: authors, total: authors.length },
      ];
      return json(shelves.filter((s) => s.entities.length));
    }
    // LibraryController.getAuthors (unpaged): { authors: [Author.toOldJSONExpanded(numBooks)] }.
    if ((m = path.match(/^\/api\/libraries\/([^/]+)\/authors$/))) {
      const lib = m[1];
      return json({ authors: AUTHORS.filter((a) => BOOKS.some((b) => b.libraryId === lib && b.authorId === a.id)).map((a) => authorJson(a, lib)) });
    }
    // LibraryController.getAllSeriesForLibrary: { results: [series + books (minified)], total }.
    if ((m = path.match(/^\/api\/libraries\/([^/]+)\/series$/))) {
      const results = seriesOf(m[1]);
      return json({ results, total: results.length, limit: 0, page: 0 });
    }
    if ((m = path.match(/^\/api\/libraries\/([^/]+)\/series\/([^/]+)$/))) {
      const found = seriesOf(m[1]).find((x) => x.id === m![2]);
      return found ? json({ id: found.id, name: found.name, description: null, addedAt: found.addedAt }) : new Response('Not Found', { status: 404 });
    }
    // LibraryController.getCollectionsForLibrary: { results: [collection + books (expanded)], total }.
    if ((m = path.match(/^\/api\/libraries\/([^/]+)\/collections$/))) {
      const results = COLLECTIONS.filter((c) => c.libraryId === m![1]).map(collectionJson);
      return json({ results, total: results.length, limit: 0, page: 0 });
    }
    if ((m = path.match(/^\/api\/collections\/([^/]+)$/))) {
      const c = COLLECTIONS.find((x) => x.id === m![1]);
      return c ? json(collectionJson(c)) : new Response('Not Found', { status: 404 });
    }
    // AuthorController.findOne with include=items,series.
    if ((m = path.match(/^\/api\/authors\/([^/]+)$/))) {
      const a = AUTHORS.find((x) => x.id === m![1]);
      if (!a) return new Response('Not Found', { status: 404 });
      const books = BOOKS.filter((b) => b.authorId === a.id);
      const json1: Record<string, unknown> = { ...authorJson(a, '') };
      const include = (url.searchParams.get('include') ?? '').split(',');
      if (include.includes('items')) {
        json1.libraryItems = books.map(minified);
        if (include.includes('series')) {
          const map = new Map<string, { id: string; name: string; items: unknown[] }>();
          for (const b of books.filter((b) => b.series).sort((x, y) => Number(x.series!.sequence) - Number(y.series!.sequence))) {
            const entry = map.get(b.series!.id) ?? { id: b.series!.id, name: b.series!.name, items: [] };
            const item = minified(b);
            (item.media.metadata as Record<string, unknown>).series = { id: b.series!.id, name: b.series!.name, sequence: b.series!.sequence };
            entry.items.push(item);
            map.set(b.series!.id, entry);
          }
          json1.series = [...map.values()];
        }
      }
      return json(json1);
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
