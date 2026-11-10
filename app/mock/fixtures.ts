import { deflateSync } from 'node:zlib';
// Fixture data for the mock Audiobookshelf server. The credentials are the mock's own, never a real server's.
// `reader` signs in as on ABS 3.x (access + refresh tokens); `legacy` as on a server before 2.26 (one `token`).
export const USER = { id: 'usr_mock', username: 'reader', type: 'user' };
export const LEGACY_USER = { id: 'usr_legacy', username: 'legacy', type: 'user' };
export const PASSWORD = 'listen';
export const LEGACY_TOKEN = 'mock-legacy-token-1234';

export const LIBRARIES = [
  { id: 'lib_books', name: 'Audiobooks', mediaType: 'book', displayOrder: 1, icon: 'audiobookshelf' },
  { id: 'lib_kids', name: 'Kids', mediaType: 'book', displayOrder: 2, icon: 'audiobookshelf' },
  // Sixty generated books, so the library pages and loads lazily.
  { id: 'lib_archive', name: 'Archive', mediaType: 'book', displayOrder: 3, icon: 'audiobookshelf' },
];

type Book = {
  id: string; libraryId: string; title: string; author: string; narrator: string; description: string;
  addedAt: number; color: [number, number, number];
  authorId: string; series?: { id: string; name: string; sequence: string };
  tracks: { title: string; duration: number }[];
  chapters: { id: number; start: number; end: number; title: string }[];
};

const threeChapters = (titles: string[]) => titles.map((title, i) => ({ id: i, start: i * 40, end: (i + 1) * 40, title }));

export const BOOKS: Book[] = [
  {
    id: 'li_dune', libraryId: 'lib_books', title: 'Dune', author: 'Frank Herbert', narrator: 'Scott Brick',
    description: 'A desert planet, a noble family, and the spice that everyone wants.', addedAt: 1_690_000_000_000,
    authorId: 'au_herbert', series: { id: 'se_dune', name: 'Dune Chronicles', sequence: '1' },
    color: [196, 140, 72],
    tracks: [{ title: 'Part 1', duration: 60 }, { title: 'Part 2', duration: 60 }],
    chapters: threeChapters(['Book One: Dune', 'Book Two: Muad’Dib', 'Book Three: The Prophet']),
  },
  {
    id: 'li_hobbit', libraryId: 'lib_books', title: 'The Hobbit', author: 'J. R. R. Tolkien', narrator: 'Andy Serkis',
    description: 'In a hole in the ground there lived a hobbit.', addedAt: 1_691_000_000_000,
    authorId: 'au_tolkien', series: { id: 'se_middle', name: 'Middle-earth', sequence: '1' },
    color: [72, 128, 88],
    tracks: [{ title: 'The Hobbit', duration: 120 }],
    chapters: threeChapters(['An Unexpected Party', 'Roast Mutton', 'A Short Rest']),
  },
  {
    id: 'li_martian', libraryId: 'lib_books', title: 'The Martian', author: 'Andy Weir', narrator: 'R. C. Bray',
    description: 'Stranded on Mars, an astronaut has to science his way home.', addedAt: 1_692_000_000_000,
    authorId: 'au_weir',
    color: [178, 72, 56],
    tracks: [{ title: 'The Martian', duration: 120 }],
    chapters: threeChapters(['Sol 6', 'Sol 7', 'Sol 10']),
  },
  {
    id: 'li_gruffalo', libraryId: 'lib_kids', title: 'The Gruffalo', author: 'Julia Donaldson', narrator: 'Imelda Staunton',
    description: 'A mouse takes a stroll through the deep dark wood.', addedAt: 1_693_000_000_000,
    authorId: 'au_donaldson',
    color: [120, 96, 160],
    tracks: [{ title: 'The Gruffalo', duration: 120 }],
    chapters: threeChapters(['The Fox', 'The Owl', 'The Snake']),
  },
  {
    id: 'li_messiah', libraryId: 'lib_books', title: 'Dune Messiah', author: 'Frank Herbert', narrator: 'Scott Brick',
    description: 'Twelve years after Arrakis, the emperor sees where his legend leads.', addedAt: 1_694_000_000_000,
    color: [150, 110, 60], authorId: 'au_herbert', series: { id: 'se_dune', name: 'Dune Chronicles', sequence: '2' },
    tracks: [{ title: 'Dune Messiah', duration: 120 }],
    chapters: threeChapters(['Part One', 'Part Two', 'Part Three']),
  },
  // The Archive: sixty books by one author, added a day apart, none started.
  ...Array.from({ length: 60 }, (_, i): Book => {
    const n = String(i + 1).padStart(2, '0');
    return {
      id: `li_archive_${n}`, libraryId: 'lib_archive', title: `Archive Volume ${n}`, author: 'Various Authors', narrator: 'Various',
      description: `Volume ${n} of the archive.`, addedAt: 1_600_000_000_000 + i * 86_400_000, authorId: 'au_various',
      color: [80 + ((i * 37) % 120), 90 + ((i * 53) % 110), 110 + ((i * 29) % 100)],
      tracks: [{ title: `Volume ${n}`, duration: 120 }], chapters: threeChapters(['One', 'Two', 'Three']),
    };
  }),
];

// Authors (AuthorController / Author.toOldJSON): Frank Herbert has a photo and a bio.
export const AUTHORS = [
  { id: 'au_herbert', name: 'Frank Herbert', description: 'American science-fiction author best known for Dune and its sequels.', image: [92, 78, 66] as [number, number, number] },
  { id: 'au_tolkien', name: 'J. R. R. Tolkien', description: 'English writer and philologist, author of The Hobbit and The Lord of the Rings.', image: null },
  { id: 'au_weir', name: 'Andy Weir', description: '', image: null },
  { id: 'au_donaldson', name: 'Julia Donaldson', description: 'Children’s author and former Children’s Laureate.', image: null },
  { id: 'au_various', name: 'Various Authors', description: '', image: null },
];

// Collections (CollectionController): one in the Audiobooks library.
export const COLLECTIONS = [
  { id: 'co_scifi', libraryId: 'lib_books', name: 'Sci-Fi Favorites', description: 'Deserts and red planets.', bookIds: ['li_dune', 'li_martian', 'li_messiah'] },
];

// A cover is a flat PNG in the book's colour (Apple hosts don't draw SVG images).
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
const covers = new Map<string, Uint8Array>();
export function coverPng(b: { id: string; color: [number, number, number] }): Uint8Array {
  const hit = covers.get(b.id);
  if (hit) return hit;
  const w = 200, h = 200, raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    for (let x = 0; x < w; x++) {
      // A lighter band across the middle, so a cover reads as a cover.
      const band = y > 80 && y < 120 ? 50 : 0;
      for (let c = 0; c < 3; c++) raw[y * (1 + w * 3) + 1 + x * 3 + c] = Math.min(255, b.color[c] + band);
    }
  }
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, w); v.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array())];
  const png = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { png.set(p, o); o += p.length; }
  covers.set(b.id, png);
  return png;
}
