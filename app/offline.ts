// Offline listening: books downloaded to app storage, and listening progress queued until the
// server can take it.
//
// A download is planned whole (`plan`: the item's metadata, chapters, cover and track list from
// GET /api/items/:id?expanded=1), then fetched one track per call (`step`), each written straight
// into its file by the host (`fetch`'s `exactBodyTo`), so the bytes never enter JavaScript. The
// view drives the steps with a task, so progress moves a track at a time and a cancel takes effect
// mid-track (an `AbortController` per book). Everything a downloaded book needs to play with no
// network is under app:/data/downloads/<id>/, listed in app:/data/downloads/index.json.
//
// Progress made while playing a downloaded book is kept in app:/data/progress-queue.json, one
// entry a book (the newest wins), and sent with PATCH /api/me/progress/batch/update
// (MeController.batchUpdateMediaProgress: an array of { libraryItemId, currentTime, duration,
// progress, isFinished }) whenever the server answers; what it can't take stays queued.
import type { Storage } from './app.contract.d.ts';
import { htmlToText } from './text.ts';

export const DIR = 'app:/data/downloads';
const INDEX = `${DIR}/index.json`;
const QUEUE = 'app:/data/progress-queue.json';
// app.ts's grants name these paths (the build reads its grants as written there).

export type Chapter = { id: number; title: string; start: number; end: number };
export type Track = { remote: string; startOffset: number; duration: number; size: number; file: string; done: boolean; bytes: number };
export type Entry = {
  id: string; libraryId: string; title: string; author: string; narrator: string; description: string;
  duration: number; chapters: Chapter[]; tracks: Track[]; cover: string;
  state: 'downloading' | 'done' | 'failed'; error: string; position: number;
};
export type Queued = { libraryItemId: string; currentTime: number; duration: number; progress: number; isFinished: boolean };

/** A fetch through the sign-in: refreshed and asked again once on a 401 (app.ts's). */
export type Authed = (path: string, init?: RequestInit) => Promise<Response>;

const decode = (bytes: ArrayBuffer) => JSON.parse(new TextDecoder().decode(bytes));
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
async function readJson<T>(storage: Storage, path: string, empty: T): Promise<T> {
  try { return decode(await storage.fs.readFile(path)) as T; }
  catch (e) { if ((e as { code?: string }).code === 'ENOENT' || (e as { code?: string }).code === 'bake') return empty; throw e; }
}
const writeJson = (storage: Storage, path: string, value: unknown) => storage.fs.atomicWriteFile(path, encode(value));

// One writer at a time for the index: a step, a cancel and a sync may answer together.
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}
export const index = (storage: Storage) => readJson<Record<string, Entry>>(storage, INDEX, {});
const update = (storage: Storage, change: (all: Record<string, Entry>) => void) =>
  locked(async () => {
    await storage.fs.mkdir(DIR).catch(() => undefined);
    const all = await index(storage);
    change(all);
    await writeJson(storage, INDEX, all);
    return all;
  });

const aborts = new Map<string, AbortController>();

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : str(x?.name))).filter(Boolean).join(', ') : '');

/** Plans a book's download: its metadata, cover and track list, kept before any audio. */
export async function plan(storage: Storage, authed: Authed, id: string): Promise<void> {
  const res = await authed(`/api/items/${encodeURIComponent(id)}?expanded=1&include=progress`);
  if (!res.ok) throw new Error(`The server answered ${res.status} for the book.`);
  const item = (await res.json()) as {
    id: string; libraryId?: string; userMediaProgress?: { currentTime?: number } | null;
    media: { metadata: Record<string, unknown>; duration?: number; chapters?: { title?: string; start?: number; end?: number }[];
      tracks?: { startOffset?: number; duration?: number; contentUrl: string; metadata?: { size?: number; ext?: string } }[] };
  };
  const dir = `${DIR}/${encodeURIComponent(id)}`;
  await storage.fs.mkdir(dir).catch(() => undefined);
  const m = item.media.metadata;
  // The cover needs no sign-in on ABS; one the server lacks leaves the book without.
  let cover = '';
  try {
    const got = await authed(`/api/items/${encodeURIComponent(id)}/cover`, { exactBodyTo: `${dir}/cover` } as RequestInit);
    if (got.ok) cover = `${dir}/cover`;
  } catch {}
  const tracks = (item.media.tracks ?? []).map((t, i) => ({
    remote: t.contentUrl, startOffset: num(t.startOffset), duration: num(t.duration),
    size: num(t.metadata?.size), file: `${dir}/track-${i}${str(t.metadata?.ext) || ''}`, done: false, bytes: 0,
  }));
  if (!tracks.length) throw new Error('This book has no audio to download.');
  await update(storage, (all) => {
    all[id] = {
      id, libraryId: str(item.libraryId), title: str(m.title) || 'Untitled', author: names(m.authors) || str(m.authorName),
      narrator: names(m.narrators) || str(m.narratorName), description: htmlToText(str(m.description)),
      duration: num(item.media.duration), cover, tracks, state: 'downloading', error: '',
      // Where the listener is now, so the book opens there with no network.
      position: Math.max(all[id]?.position ?? 0, num(item.userMediaProgress?.currentTime)),
      chapters: (item.media.chapters ?? []).map((c, i) => ({ id: i, title: str(c.title) || `Chapter ${i + 1}`, start: num(c.start), end: num(c.end) })),
    };
  });
}

/** Downloads a book's next track; `finished` once every track is on disk. */
export async function step(storage: Storage, authed: Authed, id: string): Promise<{ finished: boolean }> {
  const entry = (await index(storage))[id];
  if (!entry || entry.state !== 'downloading') return { finished: entry?.state === 'done' };
  const at = entry.tracks.findIndex((t) => !t.done);
  if (at < 0) {
    await update(storage, (all) => { if (all[id]) all[id].state = 'done'; });
    return { finished: true };
  }
  const abort = new AbortController();
  aborts.set(id, abort);
  try {
    const res = await authed(entry.tracks[at].remote, { exactBodyTo: entry.tracks[at].file, signal: abort.signal, exactTimeout: 600000 } as RequestInit);
    if (!res.ok) throw new Error(`The server answered ${res.status} for track ${at + 1}.`);
    const bytes = num((res as unknown as { exactBodyTo?: { bytes?: number } }).exactBodyTo?.bytes);
    const all = await update(storage, (all) => {
      const e = all[id];
      if (!e || e.state !== 'downloading') return; // cancelled meanwhile
      e.tracks[at] = { ...e.tracks[at], done: true, bytes, size: e.tracks[at].size || bytes };
      if (e.tracks.every((t) => t.done)) e.state = 'done';
    });
    return { finished: all[id]?.state === 'done' };
  } catch (e) {
    if (abort.signal.aborted) return { finished: false };
    await update(storage, (all) => { if (all[id]) { all[id].state = 'failed'; all[id].error = (e as Error).message; } });
    throw e;
  } finally {
    if (aborts.get(id) === abort) aborts.delete(id);
  }
}

/** Stops a book's download, or removes a downloaded book, and deletes its files. */
export async function remove(storage: Storage, id: string): Promise<void> {
  aborts.get(id)?.abort();
  const entry = (await index(storage))[id];
  const dir = `${DIR}/${encodeURIComponent(id)}`;
  for (const f of [...(entry?.tracks.map((t) => t.file) ?? []), `${dir}/cover`]) await storage.fs.rm(f).catch(() => undefined);
  await storage.fs.rm(dir).catch(() => undefined);
  await update(storage, (all) => { delete all[id]; });
}

/** Where a downloaded book was left, kept beside it as it plays. */
export const remember = (storage: Storage, id: string, position: number) =>
  update(storage, (all) => { if (all[id]) all[id].position = position; });

/** Queues one book's progress (replacing what was queued for it) and sends the queue. */
export async function queue(storage: Storage, authed: Authed, item: Queued): Promise<number> {
  await locked(async () => {
    const all = (await readJson<Queued[]>(storage, QUEUE, [])).filter((q) => q.libraryItemId !== item.libraryItemId);
    await writeJson(storage, QUEUE, [...all, item]);
  });
  return flush(storage, authed);
}

/** Sends what is queued; what the server can't take now stays. Answers how many remain. */
export async function flush(storage: Storage, authed: Authed): Promise<number> {
  return locked(async () => {
    const all = await readJson<Queued[]>(storage, QUEUE, []);
    if (!all.length) return 0;
    try {
      const res = await authed('/api/me/progress/batch/update', { method: 'PATCH', body: JSON.stringify(all) });
      if (!res.ok) return all.length;
    } catch {
      return all.length; // offline: try again later
    }
    await writeJson(storage, QUEUE, []);
    return 0;
  });
}

export const queued = async (storage: Storage) => (await readJson<Queued[]>(storage, QUEUE, [])).length;
