// Audio Nook's data module: every call to the Audiobookshelf server, and the sign-in it keeps.
// The view sees no token except in the audio URLs `trackUrls` builds; covers need none.
import type { Answer, Result, Sources, Storage, Store } from './app.contract.d.ts';
import * as offline from './offline.ts';

// The mock server the tests run (mock/server.ts, `bun exact.mjs test` starts it here). The app
// itself talks to whatever server the person signs in to.
export const MOCK_SERVER = 'http://127.0.0.1:13378';

// A server the person names at run time: any http or https host (app.json turns ATS off on macOS
// for plain http). The server URL, access and refresh tokens are kept in the Keychain.
export const grants = [
  'net.fetch http:', 'net.fetch https:',
  'secret.keep abs-server', 'secret.keep abs-token', 'secret.keep abs-refresh', 'secret.keep abs-user', 'secret.keep abs-ended',
  // offline.ts: downloaded books, and progress waiting for the server.
  'fs.read app:/data/downloads', 'fs.write app:/data/downloads',
  'fs.read app:/data/progress-queue.json', 'fs.write app:/data/progress-queue.json',
].join('\n');

type Book = Result<'libraryItems'>[number];
type Chapter = Result<'itemDetail'>['chapters'][number];
type Reply = Result<'login'>;

const ok: Reply = { ok: true, error: '' };
const refused = (error: string): Reply => ({ ok: false, error });

function signedIn(store: Store) {
  const server = store.get('abs-server'), token = store.get('abs-token');
  return server && token ? { server, token, refresh: store.get('abs-refresh') ?? '', username: store.get('abs-user') ?? '' } : null;
}

// Forgets the sign-in (the server's address stays, for the form). A resource that meets this
// fails with reason `signed-out`, and the view shows the sign-in form.
function forgetSignIn(store: Store, ended = true) {
  if (ended) store.set('abs-ended', '1');
  else store.forget('abs-ended');
  store.forget('abs-token');
  store.forget('abs-refresh');
  store.forget('abs-user');
}
const signedOut = () => Object.assign(new Error('Your session has ended. Sign in again.'), { reason: 'signed-out' });

// ABS 2.26+ (and 3.x) hands out short-lived JWT access tokens (1 h by default) and a refresh
// token that rotates on every use (server/Auth.js `/auth/refresh`, auth/TokenManager.js). A
// legacy server's `user.token` never expires and comes with no refresh token.
type Tokens = { accessToken?: string | null; refreshToken?: string | null; token?: string | null; username?: string };
const accessOf = (u: Tokens | undefined) => u?.accessToken || u?.token || '';

// One refresh at a time: requests that meet a 401 together share it, because the refresh token
// they hold is spent by the first.
let refreshing: Promise<string> | null = null;
function refreshAccess(store: Store): Promise<string> {
  refreshing ??= (async () => {
    const s = signedIn(store);
    if (!s) throw signedOut();
    if (!s.refresh) {
      forgetSignIn(store);
      throw signedOut();
    }
    const res = await fetch(`${s.server}/auth/refresh`, {
      method: 'POST',
      exactTimeout: 15000,
      headers: { 'x-refresh-token': s.refresh, 'content-type': 'application/json' },
    } as RequestInit);
    if (res.status === 401 || res.status === 403) {
      forgetSignIn(store);
      throw signedOut();
    }
    if (!res.ok) throw new Error(`The server answered ${res.status} refreshing the sign-in.`);
    const body = (await res.json().catch(() => null)) as { user?: Tokens } | null;
    const access = accessOf(body?.user);
    if (!access) throw new Error('The server’s refresh reply had no access token.');
    store.set('abs-token', access);
    if (body?.user?.refreshToken) store.set('abs-refresh', body.user.refreshToken);
    return access;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

const send = (server: string, token: string, path: string, init: RequestInit) =>
  fetch(`${server}${path}`, {
    ...init,
    exactTimeout: 15000,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  } as RequestInit);

// One authorised request as a raw Response (a download to a file, a PATCH with no body back),
// refreshed and asked once more on a 401, as `api` is.
async function authed(store: Store, path: string, init: RequestInit = {}): Promise<Response> {
  const s = signedIn(store);
  if (!s) throw signedOut();
  const url = /^https?:/.test(path) ? path : `${s.server}${path}`;
  const go = (token: string) => fetch(url, {
    exactTimeout: 15000,
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  } as RequestInit);
  const res = await go(s.token);
  return res.status === 401 ? go(await refreshAccess(store)) : res;
}
const authedFor = (store: Store): offline.Authed => (path, init) => authed(store, path, init);

// One authorised request. A 401 refreshes the access token and asks once more; a refresh the
// server refuses signs out. A failed status throws, which fails the resource.
async function api(store: Store, path: string, init: RequestInit = {}): Promise<unknown> {
  const s = signedIn(store);
  if (!s) throw signedOut();
  let res = await send(s.server, s.token, path, init);
  if (res.status === 401) {
    res = await send(s.server, await refreshAccess(store), path, init);
    if (res.status === 401) {
      forgetSignIn(store);
      throw signedOut();
    }
  }
  if (!res.ok) throw new Error(`The server answered ${res.status} for ${path}.`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

const withToken = (store: Store, path: string) => {
  const s = signedIn(store);
  return s ? `${s.server}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(s.token)}` : '';
};
// ABS serves covers without auth (Auth.js `ignorePatterns`), so a cover URL never expires.
const coverUrl = (store: Store, id: string) => `${store.get('abs-server') ?? ''}/api/items/${encodeURIComponent(id)}/cover`;

// "http://host:port/", "http:/host:port" or "host:port" → "http://host:port": the origin typed.
function normalizeServer(raw: string): string | null {
  let s = raw.trim().replace(/\/+$/, '');
  if (!s) return null;
  // A scheme with too few or too many slashes (a typo, a paste) is still that scheme.
  const scheme = s.match(/^(https?):\/*/i);
  s = scheme ? `${scheme[1].toLowerCase()}://${s.slice(scheme[0].length)}` : `http://${s}`;
  try {
    const u = new URL(s);
    if (!u.host) return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

type Item = { id: string; media: { metadata: Record<string, unknown>; duration?: number } };
type Progress = { libraryItemId: string; progress: number; currentTime: number; isFinished: boolean };
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

async function progressMap(store: Store): Promise<Map<string, Progress>> {
  const me = (await api(store, '/api/me')) as { mediaProgress?: Progress[] };
  return new Map((me.mediaProgress ?? []).map((p) => [p.libraryItemId, p]));
}

function book(store: Store, i: Item, progress: Map<string, Progress>): Book {
  const m = i.media.metadata, p = progress.get(i.id);
  return {
    id: i.id,
    title: str(m.title) || 'Untitled',
    author: str(m.authorName),
    cover: coverUrl(store, i.id),
    duration: num(i.media.duration),
    progress: p ? (p.isFinished ? 1 : num(p.progress)) : 0,
  };
}

const chapters = (raw: unknown): Chapter[] =>
  Array.isArray(raw) ? raw.map((c, i) => ({ id: i, title: str(c.title) || `Chapter ${i + 1}`, start: num(c.start), end: num(c.end) })) : [];

const sources: Sources = {
  session: (_args, store) => {
    const s = signedIn(store);
    // `ended`: the server refused a refresh, so the form says why it is back.
    return { signedIn: s != null, server: s?.server ?? store.get('abs-server') ?? '', username: s?.username ?? '', ended: s == null && store.get('abs-ended') === '1' };
  },

  login: async ([rawServer, username, password], store): Promise<Reply> => {
    const server = normalizeServer(rawServer);
    if (!server) return refused('Enter the server’s address, like http://192.168.1.10:13378.');
    if (!username.trim()) return refused('Enter your username.');
    let res: Response;
    try {
      res = await fetch(`${server}/login`, {
        method: 'POST',
        exactTimeout: 15000,
        // Asks for the refresh token in the reply rather than a cookie, as ABS's mobile app does.
        headers: { 'content-type': 'application/json', 'x-return-tokens': 'true' },
        body: JSON.stringify({ username: username.trim(), password }),
      } as RequestInit);
    } catch (e) {
      if ((e as { code?: string }).code === 'bake') throw e;
      return refused(`Can’t reach ${server}. Check the address and that the server is running.`);
    }
    if (res.status === 401) return refused('That username and password didn’t work.');
    if (!res.ok) return refused(`The server answered ${res.status}.`);
    const body = (await res.json().catch(() => null)) as { user?: Tokens } | null;
    // 2.26+ answers `accessToken` (and `refreshToken`, asked for above); older servers `token`.
    const token = accessOf(body?.user);
    if (!token) return refused('That doesn’t look like an Audiobookshelf server.');
    store.set('abs-server', server);
    store.set('abs-token', token);
    if (body?.user?.refreshToken) store.set('abs-refresh', body.user.refreshToken);
    else store.forget('abs-refresh');
    store.set('abs-user', body?.user?.username ?? username.trim());
    store.forget('abs-ended');
    return ok;
  },

  logout: async (_args, store): Promise<Reply> => {
    // ABS ends the session the refresh token names (`x-refresh-token`); sign out here whatever it says.
    const s = signedIn(store);
    if (s) {
      const headers: Record<string, string> = { authorization: `Bearer ${s.token}` };
      if (s.refresh) headers['x-refresh-token'] = s.refresh;
      await fetch(`${s.server}/logout`, { method: 'POST', exactTimeout: 10000, headers } as RequestInit).catch(() => undefined);
    }
    forgetSignIn(store, false);
    return ok;
  },

  // A refresh the player asks for when its audio stops loading (an access token that expired
  // mid-book). A legacy token never expires, so there is nothing to renew.
  renewToken: async (_args, store): Promise<Reply> => {
    const s = signedIn(store);
    if (!s) return refused('signed-out');
    if (!s.refresh) return ok;
    try {
      await refreshAccess(store);
      return ok;
    } catch (e) {
      return refused((e as { reason?: string }).reason === 'signed-out' ? 'signed-out' : (e as Error).message);
    }
  },

  // The audio URLs for a session's tracks, with the access token held now (`gen` is the player's
  // count of renewals, so a renewal asks again).
  trackUrls: ([paths], store) => paths.map((p) => (/^(https?|app):/.test(p) ? p : withToken(store, p))),

  // Downloads: what is kept, and each step of fetching it (offline.ts).
  downloads: async (_args, _store, storage) => Object.values(await offline.index(storage)).map(downloadInfo),
  startDownload: async ([id], store, storage): Promise<Reply> => {
    try {
      await offline.plan(storage, authedFor(store), id);
      return ok;
    } catch (e) {
      return refused((e as Error).message);
    }
  },
  downloadNext: async ([id], store, storage) => {
    try {
      return { ok: true, error: '', finished: (await offline.step(storage, authedFor(store), id)).finished };
    } catch (e) {
      return { ok: false, error: (e as Error).message, finished: false };
    }
  },
  removeDownload: async ([id], _store, storage): Promise<Reply> => {
    await offline.remove(storage, id);
    return ok;
  },
  pendingSync: async (_args, _store, storage) => ({ count: await offline.queued(storage) }),
  flushProgress: async (_args, store, storage) => ({ count: signedIn(store) ? await offline.flush(storage, authedFor(store)) : await offline.queued(storage) }),


  libraries: async ([server], store) => {
    if (!server) return [];
    const body = (await api(store, '/api/libraries')) as { libraries?: { id: string; name: string; mediaType?: string }[] };
    return (body.libraries ?? []).map((l) => ({ id: l.id, name: l.name }));
  },

  libraryItems: async ([server, libraryId], store) => {
    if (!server || !libraryId) return [];
    const [body, progress] = await Promise.all([
      api(store, `/api/libraries/${encodeURIComponent(libraryId)}/items?sort=media.metadata.title&minified=1`) as Promise<{ results?: Item[] }>,
      progressMap(store),
    ]);
    return (body.results ?? []).map((i) => book(store, i, progress));
  },

  inProgress: async ([server, libraryId], store) => {
    if (!server) return [];
    const [body, progress] = await Promise.all([
      api(store, '/api/me/items-in-progress') as Promise<{ libraryItems?: (Item & { libraryId?: string })[] }>,
      progressMap(store),
    ]);
    return (body.libraryItems ?? []).filter((i) => !libraryId || i.libraryId === libraryId).map((i) => book(store, i, progress));
  },

  // GET /api/libraries/:id/search (LibraryController.search → libraryItemsBookFilters.search):
  // `{ book: [{ libraryItem }], authors, series, narrators, tags, genres }`, each libraryItem
  // expanded, so its metadata names `authors` rather than `authorName`.
  search: async ([server, libraryId, query], store) => {
    const q = query.trim();
    if (!server || !libraryId || !q) return { query: q, books: [], authors: [] };
    const [body, progress] = await Promise.all([
      api(store, `/api/libraries/${encodeURIComponent(libraryId)}/search?q=${encodeURIComponent(q)}&limit=24`) as Promise<{
        book?: { libraryItem: Item }[]; authors?: { id: string; name: string }[];
      }>,
      progressMap(store),
    ]);
    const books = (body.book ?? []).map((m) => {
      const b = book(store, m.libraryItem, progress);
      const authors = m.libraryItem.media.metadata.authors;
      return b.author || !Array.isArray(authors) ? b : { ...b, author: authors.map((x) => str(x?.name)).filter(Boolean).join(', ') };
    });
    return { query: q, books, authors: (body.authors ?? []).map((x) => ({ id: str(x.id), name: str(x.name) })) };
  },

  itemDetail: async ([server, id], store, storage) => {
    const empty = { id: '', title: '', author: '', narrator: '', description: '', cover: '', duration: 0, progress: 0, currentTime: 0, chapters: [] };
    if (!server || !id) return empty;
    // A downloaded book opens with no network, from what was kept with it.
    const kept = (await offline.index(storage))[id];
    let fetched: unknown;
    try {
      fetched = await api(store, `/api/items/${encodeURIComponent(id)}?expanded=1&include=progress`);
    } catch (e) {
      if (!kept || kept.state !== 'done' || (e as { reason?: string }).reason === 'signed-out') throw e;
      return { id, title: kept.title, author: kept.author, narrator: kept.narrator, description: kept.description, cover: kept.cover,
        duration: kept.duration, progress: kept.duration ? kept.position / kept.duration : 0, currentTime: kept.position, chapters: kept.chapters };
    }
    const i = fetched as Item & {
      media: { chapters?: unknown[] };
      userMediaProgress?: Progress | null;
    };
    const m = i.media.metadata;
    const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : str(x?.name))).filter(Boolean).join(', ') : '');
    const p = i.userMediaProgress;
    return {
      id: i.id,
      title: str(m.title) || 'Untitled',
      author: names(m.authors) || str(m.authorName),
      narrator: names(m.narrators) || str(m.narratorName),
      description: str(m.description).replace(/<[^>]+>/g, ''),
      cover: coverUrl(store, i.id),
      duration: num(i.media.duration),
      progress: p ? (p.isFinished ? 1 : num(p.progress)) : 0,
      currentTime: p ? num(p.currentTime) : 0,
      chapters: chapters(i.media.chapters),
    };
  },

  startPlayback: async ([id], store, storage) => {
    // A downloaded book plays from its files, with no session on the server: its progress is
    // queued and sent as the server allows (syncSession below).
    const kept = (await offline.index(storage))[id];
    if (kept?.state === 'done') {
      let at = kept.position;
      try {
        const p = (await api(store, `/api/me/progress/${encodeURIComponent(id)}`)) as Progress | null;
        if (p && num(p.currentTime) > at) at = num(p.currentTime);
      } catch {}
      return {
        id: `local:${id}`, itemId: id, title: kept.title, author: kept.author, cover: kept.cover, duration: kept.duration,
        currentTime: at, chapters: kept.chapters,
        tracks: kept.tracks.map((t, i) => ({ index: i, startOffset: t.startOffset, duration: t.duration, path: t.file })),
      };
    }
    const s = (await api(store, `/api/items/${encodeURIComponent(id)}/play`, {
      method: 'POST',
      body: JSON.stringify({
        deviceInfo: { clientName: 'Audio Nook', deviceId: 'audio-nook-mac' },
        supportedMimeTypes: ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/wav', 'audio/flac'],
        mediaPlayer: 'audio-nook',
        forceDirectPlay: true,
      }),
    })) as {
      id: string; libraryItemId: string; displayTitle?: string; displayAuthor?: string; duration?: number; currentTime?: number;
      chapters?: unknown[]; audioTracks?: { startOffset?: number; duration?: number; contentUrl: string }[];
    };
    return {
      id: s.id,
      itemId: s.libraryItemId,
      title: str(s.displayTitle),
      author: str(s.displayAuthor),
      cover: coverUrl(store, s.libraryItemId),
      duration: num(s.duration),
      currentTime: num(s.currentTime),
      chapters: chapters(s.chapters),
      tracks: (s.audioTracks ?? []).map((t, i) => ({
        index: i,
        startOffset: num(t.startOffset),
        duration: num(t.duration),
        path: t.contentUrl,
      })),
    };
  },

  syncSession: async ([sessionId, currentTime, timeListened, duration], store, storage): Promise<Reply> => {
    if (sessionId.startsWith('local:')) return keepLocal(store, storage, sessionId.slice(6), currentTime, duration);
    try {
      await api(store, `/api/session/${encodeURIComponent(sessionId)}/sync`, { method: 'POST', body: JSON.stringify({ currentTime, timeListened, duration }) });
      return ok;
    } catch (e) {
      return refused((e as Error).message);
    }
  },

  closeSession: async ([sessionId, currentTime, timeListened, duration], store, storage): Promise<Reply> => {
    if (sessionId.startsWith('local:')) return keepLocal(store, storage, sessionId.slice(6), currentTime, duration);
    try {
      await api(store, `/api/session/${encodeURIComponent(sessionId)}/close`, { method: 'POST', body: JSON.stringify({ currentTime, timeListened, duration }) });
      return ok;
    } catch (e) {
      return refused((e as Error).message);
    }
  },
};

// A downloaded book's place: kept beside it, and queued for the server.
async function keepLocal(store: Store, storage: Storage, id: string, currentTime: number, duration: number): Promise<Reply> {
  await offline.remember(storage, id, currentTime);
  const progress = duration ? Math.min(1, currentTime / duration) : 0;
  await offline.queue(storage, authedFor(store), { libraryItemId: id, currentTime, duration, progress, isFinished: progress >= 0.999 });
  return ok;
}

function downloadInfo(e: offline.Entry) {
  const total = e.tracks.reduce((s, t) => s + (t.size || 1), 0);
  const done = e.tracks.reduce((s, t) => s + (t.done ? t.size || 1 : 0), 0);
  return {
    id: e.id, title: e.title, author: e.author, cover: e.cover, duration: e.duration, state: e.state, error: e.error,
    tracksDone: e.tracks.filter((t) => t.done).length, tracksTotal: e.tracks.length,
    progress: e.state === 'done' ? 1 : total ? done / total : 0,
    listened: e.duration ? Math.min(1, e.position / e.duration) : 0,
  };
}

export const answer: Answer = (source, args, store, storage, native) => sources[source](args, store, storage, native);
