# Audio Nook

A native macOS client for an [Audiobookshelf](https://www.audiobookshelf.org) server, built with
[Exact](https://github.com/expo/exact). The interface is Contract (`app/app.contract`), the data
logic TypeScript (`app/app.ts`), as Exact prescribes. On macOS it is AppKit, with no webview.

The Exact app lives in **`app/`** (made by `exact new`). Everything below runs from there unless
it says otherwise.

| Path | What it is |
| --- | --- |
| `app/app.contract` | The view, its state and actions: sign-in, sidebar sections, cover grids, search, item detail, player, mini player |
| `app/app.ts` | Every Audiobookshelf API call, and the sign-in kept in the Keychain |
| `app/app.test.contract` | The tests, run against the mock server on every host |
| `app/player.contract` | Now Playing: the cover backdrop, a drawn capsule scrubber and volume, the transport, the speed pill, the ••• menu and the chapters panel |
| `app/player.test.contract` | The chapters panel, the speed pill, the ••• menu, scrubbing (drag and arrow keys) and volume |
| `app/detail.contract` | The detail pages: a book's hero, About, Information, chapters and shelves; author, series and collection headers |
| `app/text.ts` | ABS's HTML descriptions as plain paragraphs |
| `app/detail.test.contract` | The book page's links, More, chapters, … menu and size; series, author and collection headers |
| `app/library.contract` | Browsing pieces: cover grid, list, shelves, series, author and collection cards |
| `app/polish.test.contract` | Hover and Play on covers, context menus, keyboard shortcuts, placeholders |
| `app/layouts.test.contract` | Shelves, sort, filter, grid/list, paging, series, authors, collections |
| `app/offline.ts` | Offline listening: downloads into app storage, and progress queued for the server |
| `app/downloads.test.contract` | Download, cancel, remove, play with no network, sync when back |
| `app/miniplayer.test.contract` | The Mini Player window (macOS only) |
| `app/modules/apple/MiniPlayer.swift`, `app/modules/web/index.js` | The app's native module: the Mini Player window (`nook-mini-player`) |
| `app/tools/test-all.sh` | Every test file on web, macOS, and macOS under the platform's chrome, plus the window checks |
| `app/sidebar.test.contract` | The Mac's own sidebar: rows and ⌃⌘S (macOS only, under `--chrome platform`) |
| `app/tools/check-sidebar.mjs` | Drives the Mac app and reads the window: the sidebar's selection and collapse |
| `app/tools/screenshots.mjs` | Captures `docs/screenshots/*-{light,dark}.png` in the real window |
| `app/mock/` | A mock Audiobookshelf server (Bun): fixture JSON, generated PNG covers and WAV tones |
| `app/app.json` | The manifest: name, bundle id, hosts, ATS, the mock server as the app's test server |
| `app/app.tamber`, `app/assets/icons/` | Icon tokens (SF Symbols on Apple, an SVG elsewhere): headphones, books, previous/next chapter, speakers, chapters list |
| `docs/screenshots/` | macOS screens in light and dark: `library`, `search`, `detail`, `player`, `player-chapters` (wide, chapters open), `mini-player` and `sidebar-collapsed`, each with `-light.png` and `-dark.png` |

## Install on a Mac

Audio Nook runs on Macs with Apple silicon and macOS 26 or later. The build is arm64 only: Exact
builds its Apple host for the machine it builds on, and the CI runner is Apple silicon.

1. Download `AudioNook-<version>-macos.dmg` from the repository's
   [Releases](https://github.com/jonstuebe/audio-nook/releases). A build of `main` is also on
   each run of the **Release** workflow under Actions, as an artifact.
2. Open the DMG and drag **Audio Nook** onto **Applications**.
3. Open it. Releases are signed ad-hoc, not with a Developer ID, so the first time macOS says it
   can't check the app for malicious software. Allow it once, by either route:
   - **System Settings ▸ Privacy & Security:** scroll to *"Audio Nook" was blocked to protect
     your Mac*, click **Open Anyway**, then confirm with **Open Anyway** and your password.
     (On macOS 15 and later, Control-click ▸ Open no longer offers this; Settings is the way.)
   - **Terminal:** `xattr -dr com.apple.quarantine "/Applications/Audio Nook.app"`, then open it
     as usual.

   After that it opens like any other app. A build signed with a Developer ID and notarized (see
   Releasing) needs neither step.

   After installing a newer ad-hoc build over an older one, macOS may also ask whether Audio Nook
   may use what it keeps in your keychain (your server's sign-in). Each ad-hoc build is a different
   signature to the keychain, so click **Always Allow** (or sign in again). A Developer ID build
   keeps one identity across updates and is never asked.
4. Sign in with your Audiobookshelf server's address, username and password. Plain `http`
   addresses on your network or a tailnet work: the app allows them (App Transport Security is
   off for its own connections).

## Releasing

The **Release** workflow (`.github/workflows/release.yml`) builds the DMG on GitHub's `xcode-27`
macOS runner. It checks out Exact at the commit in its `EXACT_SHA` and runs `exact setup`, caching
the toolchain on that commit, so a later run only rebuilds the app. It then runs
`bun exact.mjs mac --release`, signs, verifies (`codesign --verify --deep --strict`, and logs
`spctl`'s assessment), and packages `AudioNook-<version>-macos.dmg` with an Applications link.

- **A release:** tag the commit and push the tag. The workflow attaches the DMG and its SHA-256 to
  a GitHub Release whose notes carry the install steps above.

  ```sh
  git tag v1.0.0
  git push origin v1.0.0
  ```

  The tag's version (`1.0.0`) becomes the DMG's name and the app's `CFBundleShortVersionString`.
- **A build without a release:** run the workflow from Actions (**Run workflow**), or push to
  `main`. Either uploads the DMG as an artifact, named `AudioNook-0.1.0-<short sha>-macos.dmg`.
- **Signing:** ad-hoc by default. With the repository secrets `MACOS_CERT_P12` (a base64 Developer
  ID Application `.p12`), `MACOS_CERT_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID` and
  `APPLE_APP_PASSWORD` (an app-specific password), the workflow signs with the Developer ID and
  the hardened runtime instead, notarizes the DMG with `notarytool`, and staples it.
- **Exact's version:** the workflow's `EXACT_SHA` is the commit the app builds against. Bump it
  together with the local checkout (`git -C ../exact checkout <sha>`), and the caches follow.
- **Build time:** a cold run (no caches) takes about 24 minutes: `exact setup` about 5, the
  Contract compiler about 4, the release build about 13 (Exact's Rust crates with thin LTO, and the
  Swift host). A warm run takes about 4 minutes, as the caches hold everything that build compiles.
  - **Two caches:** Exact's toolchain (Rust toolchains, cargo's registry and tools, Hermes
    bundles, Binaryen, Bun's packages, Exact's `target`, about 1.6 GB) is keyed on the Exact
    commit, Xcode and the runner. The app's build (`app/target` and the generated native
    workspace, about 0.6 GB) is keyed on that toolchain key and the app's sources.
  - **Fixed mtimes:** checked-out files and directories get one fixed date, so Cargo and SwiftPM
    see an unchanged source as unchanged.
  - **Saving:** the toolchain is saved after the build, so it holds the build tools Exact
    compiles. A failed setup is never cached, and setup retries network failures. When the
    toolchain is restored, `exact setup --check` stands in for the full setup.
- **What ships:** the production build (`mac --release`: production update trust, no development
  menu or hooks). `deploy.store.macos` is `"0"`, so the app is a plain binary with no update
  channel. The mock server and its address stay out of the app: `commands.server` and
  `MOCK_SERVER` are read only by the test runner.

## Set up Exact

Exact has no packaged CLI: an app refers to a source checkout by path. This app expects it at
`../../exact` relative to `app/`, so next to this repo (set `EXACT2=/path/to/exact` to use another).

You need macOS with **Xcode 27** (Exact's Apple host does not compile with Xcode 26.2: see Known
gaps), Rust through rustup, Google Chrome (for the web host), and Bun 1.4.2:

```sh
curl -fsSL https://bun.sh/install | BUN_INSTALL=~/.bun-1.4.2 bash -s bun-v1.4.2
export PATH=~/.bun-1.4.2/bin:$PATH

cd ~/code            # the folder that holds audio-nook/
git clone https://github.com/expo/exact
cd exact
bun scripts/exact.mjs setup        # once: toolchains, Hermes, crates (several minutes)
bun scripts/exact.mjs setup --check
```

## Run the app

```sh
cd audio-nook/app
bun exact.mjs mac --run      # build and launch on this Mac (the first build takes 10–15 minutes)
bun exact.mjs web            # the web dev loop at http://127.0.0.1:8765/, rebuilt on save
```

To try it without a real server, start the mock in another terminal and sign in with
`http://127.0.0.1:13378`, user `reader`, password `listen`. That account behaves like ABS 3.x,
with short-lived access tokens and a rotating refresh token. The `legacy` account (same password)
behaves like a server before 2.26, with one `user.token` that never expires.

```sh
bun mock/server.ts           # PORT=… picks another port; ACCESS_TTL_MS=… shortens the access token
```

## Run the tests

`bun tools/test-all.sh` (in `app/`) runs everything below: every test file on web, macOS and
macOS under the platform's chrome, then the window checks.

`test` builds the app, starts `mock/server.ts` itself (it is app.json's `commands.server`, at the
`MOCK_SERVER` address in `app.ts`), runs `app.test.contract` and stops the server:

```sh
bun exact.mjs test macos     # the AppKit host (needs Xcode 27)
bun exact.mjs test web       # the web host, headless Chrome
```

The same tests run through Exact's driver directly, from the Exact checkout. `--chrome platform`
runs them under the Mac's real sidebar and toolbar (rows are pressed through AppKit's list), which
`sidebar.test.contract` needs:

```sh
cd ../../exact
EXACT_APP_DIR=../audio-nook/app bun scripts/agent.mjs macos --app app --test ../audio-nook/app/app.test.contract
EXACT_APP_DIR=../audio-nook/app bun scripts/agent.mjs macos --app app --chrome platform --test ../audio-nook/app/app.test.contract
EXACT_APP_DIR=../audio-nook/app bun scripts/agent.mjs macos --app app --chrome platform --test ../audio-nook/app/sidebar.test.contract
EXACT_APP_DIR=../audio-nook/app bun scripts/agent.mjs web --app app --test ../audio-nook/app/app.test.contract
```

A test can't read the window itself, so `bun tools/check-sidebar.mjs` (in `app/`, after
`bun exact.mjs mac`) drives the app and reads `state window`. It checks that each sidebar row
selects its section, and that ⌃⌘S collapses the sidebar and brings it back with the same row
selected. `bun tools/screenshots.mjs` recaptures the screenshots.

The tests cover:

- **Sign-in:** a wrong password is refused, a typed address is normalised (`http:/host` too), a
  relaunch stays signed in, and sign-out returns to the form and spends the refresh token.
- **Tokens:** ABS 3.x access and refresh tokens, and a legacy server's single token. An expired
  access token is refreshed without asking. A refresh the server refuses returns to the form, and
  signing in again resumes. Audio whose token expired renews it and loads again.
- **Navigation:** the sidebar's Listen Now, Search and per-library rows switch sections. The chosen
  library is remembered across a relaunch. On the Mac, ⌃⌘S collapses and restores the sidebar.
- **Library:** the cover grid with progress, Continue Listening, and switching libraries.
- **Search:** title matches in the chosen library, authors by name, and no results. Search follows
  the library chosen in the sidebar, and a result opens its detail.
- **Mini player:** it shows while you browse other sections, plays, pauses and skips, and opens the
  player.
- **Detail** (both hosts): Dune's hero ("Book 1 of Dune Chronicles", the author link, "1m left",
  Continue) and the HTML description, whose More toggles. The Information grid's genres, year,
  publisher, language, ISBN, ASIN, length and size. The series and author links, the More in Dune
  Chronicles shelf, and Herbert's bio with More. Dune Messiah's 12 chapters show 8, then all; a
  chapter's click plays from it and marks it, and another click moves the mark. The … menu marks
  The Hobbit finished and back, shows its series and author, and copies its link. A downloaded
  book shows its size on this Mac, and Remove Download in the menu takes it away. A collection's header.
- **Polish** (both hosts): hovering a cover shows its Play button, which plays it. Placeholders go
  once art loads. The context menu marks Finished and back, downloads, removes, shows the series
  and plays. ⌘1–⌘5 switch sections, ⌘F finds, and Space, ⌘← ⌘→, ⌥⌘← ⌥⌘→ drive playback.
- **Layouts** (both hosts): Listen Now's shelves of books, series and authors. A library sorted by
  title, author, recently added and progress; filtered by in progress, finished, not started and
  downloaded, with an empty filter's way back. Grid and list views, and the 60-book Archive library
  loading 24 at a time as the agent scrolls (`tap … wheel`). The Dune Chronicles series in
  order, Frank Herbert's author page (photo, bio, series, books), Tolkien's with no photo, and the
  Sci-Fi Favorites collection.
- **Downloads** (both hosts): download Dune track by track (0%, 50%, Downloaded). The grid
  badge shows it, and the Downloads row lists it. With the server cut off (`fail fetch`), it
  opens and plays from `app:/data` files at the saved position, and its progress waits in the
  queue. When the server answers again, the queue is sent and the mock confirms the position.
  Cancelling mid-download and Remove Download both delete it.
- **Mini Player window** (macOS): opens from the player, the mini player and ⌥⌘M. Its own buttons
  (typed at it by the agent, which presses the real `NSButton`s) play, pause, skip, change chapter,
  seek and float. It says back what it shows, which the test compares with the main player's state
  in both directions.
- **Item detail:** author, narrator, description, length and chapters.
- **Playback:** a session starts at the saved position. The test covers play/pause, ±30 s across
  a track boundary, next/previous chapter, a chapter tap and speed. It also checks that the server
  received a sync, and a close on Stop.

To drive the app by hand and take screenshots (the macOS drive starts the mock server itself;
stop any you started by hand first). `--chrome platform` and `screenshot … window` show the
window as a person sees it, sidebar and toolbar included:

```sh
bun exact.mjs agent macos --chrome platform --reset-storage "type server http://127.0.0.1:13378" \
  "type username reader" "type password listen" "tap sign-in-button" "clock data" "clock settle" \
  "tap tab-library-lib_books" "clock data" "clock +1500 real" "screenshot .exact/library.png window"
```

## Point it at a real Audiobookshelf server

Launch the app and sign in with your server's address (`http://192.168.1.10:13378`,
`https://abs.example.com`; a missing `http://` is added, and `http:/host` is read as
`http://host`), your username and password. The
address, access token, refresh token and username are kept in the Keychain (Exact's
`secret.keep`), so a relaunch skips sign-in. Sign Out (the toolbar button on Listen Now) ends the
session on the server (`POST /logout` with `x-refresh-token`) and forgets the tokens.

The data module may reach any `http:` or `https:` host (`net.fetch http:` / `https:`, because
the person names the server). `app.json` turns App Transport Security off on macOS
(`allowsArbitraryLoads`) so plain-`http` servers on the LAN work. No credentials are stored in
this repo; the mock's `reader` / `listen` exist only in `app/mock/fixtures.ts`.

## The look: what is native and what is approximated

The app follows Apple Books, Music and Podcasts on macOS 26. Exact projects Contract onto AppKit,
so most of the chrome is AppKit's own; what Exact doesn't expose is approximated with system
colours and fonts.

**Native (AppKit draws it):**

- **Sidebar:** the root `tablist` becomes the window's sidebar. That is an `NSSplitViewController`
  sidebar holding AppKit's source list, which is the macOS 26 floating glass sidebar running full
  height with the traffic lights inset over it. It brings the toolbar's sidebar button with its
  tracking separator, View ▸ Show Sidebar and ⌃⌘S. AppKit's autosave keeps its width and whether
  you collapsed it across launches.
- **Sidebar rows:** system row sizes, the native selection highlight, and SF Symbols in the accent
  colour. The rows are Listen Now (`headphones`), Search (`magnifyingglass`), and one per ABS
  library (`books.vertical`). Each library has a panel of its own, so the selected row is the
  library whose books show.
- **Toolbar and title bar:** each route's `header` becomes the unified toolbar. Its heading is the
  window title, its buttons are toolbar items (Sign Out, Stop), and Back is the toolbar's own.
- **Search field:** the Search route's `input type="search"` becomes the toolbar's `NSSearchField`.
- **Liquid Glass:** the mini player and the player's chapters panel are
  `backgroundMaterial="glass"` (`NSGlassEffectView`). The mini player's buttons are
  `buttonStyle="glass"` and `"prominent-glass"`.
- **Controls:** the `progress` bar and the sign-in form's grouped list are AppKit's. The player
  draws its own, as Music does: a capsule scrubber and volume slider (pointer events and arrow
  keys, `role="slider"` for VoiceOver), plain transport glyphs with hover and pressed states, a
  filled play disc, and a speed pill that opens a native menu.
- **Colours and type:** system semantic colours (`-exact-secondary-label`, `-exact-secondary-fill`,
  `AccentColor`) and text styles (`-exact-large-title`, `-exact-title2`, `-exact-subheadline`…).
  Light and dark follow the system, with no hard-coded colours except the covers' drop shadows.
- **Now Playing:** the `audio` element is AVPlayer, with Media Session metadata for Control Center
  and the media keys. The screen sits over its cover, blurred and scaled past the edges, under a
  scrim of the scheme (`player.*` tokens in `app.tamber`). Title, author and chapter are
  left-aligned under the cover with a ••• menu (Go to Book, Download, Mark as Finished, Copy Link,
  Stop Playing). The scrubber marks chapter boundaries and grows under the pointer. Below it:
  volume, then speed, chapters and the Mini Player. Wide, the chapters are a glass panel beside the
  player; narrow, under it.

- **Mini Player window:** a separate `NSPanel` (Window ▸ Mini Player, ⌥⌘M, or the button on the
  mini player and in the player's toolbar) with an `NSGlassEffectView` behind cover art, title,
  chapter, an `NSSlider`, glass `NSButton`s (previous/next chapter, ±30 s, play/pause) and a pin
  that floats it above other apps (`NSWindow.Level.floating`, remembered). It is the app's own
  native module, `nook-mini-player` (`app/modules/apple/MiniPlayer.swift`). Contract gives it the
  player's state as props and handles its buttons' messages, so it is always in step with the
  main player. AppKit autosaves its position.

- **Menus and keys:** a book's right-click menu (Play, Download / Remove Download, Mark as Finished
  / Not Finished, Show in its series) is an `NSMenu`. Playback is in the menu bar's View menu and the
  Dock menu: Play/Pause, Skip Back/Forward 30 Seconds (⌘← ⌘→), Previous/Next Chapter (⌥⌘← ⌥⌘→).
  Space plays and pauses, except on the Search page. Find in Library (⌘F) is in Edit, and the
  sidebar's sections are ⌘1… in Go, as AppKit files them.
- **Covers:** each cover keeps its art's own shape, square or portrait, standing on the shelf's
  floor as Books draws it, with a placeholder until it loads. Pressing scales it (`:active`
  `-exact-press-scale`, the host's own press).

**Approximated (Exact has no such primitive yet):**

- **Search field in the sidebar.** Exact's sidebar holds only rows, so search is a Search row whose
  page has the toolbar's native search field, as Podcasts does.
- **Sidebar section headers** ("Listen", "Library"). Exact's source list has no group rows, so the
  rows are one flat list: Listen Now and Search first, then the libraries. Authors and Series rows
  were left out for the same reason.
- **Large titles.** The Mac toolbar has none ("there is no large title" in Exact's bar), so each
  page draws its title in `-exact-large-title` at the top of its content, as Books does under its
  toolbar. The toolbar shows the same title, small.
- **The ambient backdrop is the cover blurred, not its dominant colour.** Exact has no image colour
  sampling, so the hero blurs and saturates a scaled copy of the cover (CSS `filter`, which macOS
  and the web draw; Linux draws it unfiltered), faded out with a `mask-image` gradient.
- **More appears by length, not by measured lines.** The view can't know whether a clamped text was
  cut, so More shows when the description is long (over ~320 characters, or more than one
  paragraph). Collapsed, the paragraphs run together, so the clamp's last line isn't a blank one.
- **Descriptions are plain text.** Bold and italic in ABS's HTML are dropped; Contract's `text`
  takes Markdown, but a Markdown text can't be line-clamped.
- **Hover on covers.** Apple hosts don't draw `:hover` state parts yet (Exact's LLP 1121 stage 8 B),
  so a cover tracks the pointer with its `hover` event. That lifts its shadow and shows a glass Play
  button, at the cost of a state change per hover.
- **No "Controls" menu.** `-exact-menu` files a command only into the standard menus, so playback
  lives in View and the Dock menu, where Music has a Controls menu of its own.
- **Space as a shortcut.** A bare Space shortcut would take the key from a text field, so it is
  present only off the Search page. The sign-in form hides all shortcuts.
- **Shelves scroll sideways in a `scroll`**, not an `NSCollectionView` with paging arrows.
- **Lists are rows in a scroll, not a virtualized `list`** (an `NSTableView` on the Mac). A
  virtualized list holds one `for` and nothing else, and the page's large title and paging marker
  sit beside it. A very large library renders every row it has loaded.
- **Cover grid.** A CSS grid (`repeat(auto-fill, minmax(9.5rem, 1fr))`) in a `scroll`, not an
  `NSCollectionView`. Exact has no grid virtualization, so a very large library renders every card.
- **Selection in the grid.** A cover is a link that opens the book. There is no
  keyboard-selectable collection item.
- **Mini player placement.** It floats in glass over the page's foot. Exact has no
  toolbar-accessory or window-bottom-bar API, which is where Music puts it.
- **A second window.** Contract has no window of its own beyond the main one, so the Mini Player
  is a native module that owns an `NSPanel`. Its content is AppKit, not Contract. On the web the
  tag draws nothing, and the in-page mini player is the only one.
- **Sidebar collapse in tests.** Contract tests can't read the window, so `tools/check-sidebar.mjs`
  checks collapse through `state window`.

## How it works

- **Sign-in:** `login` sends `POST /login` with `x-return-tokens: true`, the header ABS's mobile app
  sends to get the refresh token in the reply rather than a cookie. It keeps `user.accessToken`,
  falling back to a pre-2.26 server's `user.token`, and `user.refreshToken` when present. Every other
  request sends `Authorization: Bearer <access token>`.
- **Token refresh:** ABS 2.26+ access tokens last an hour by default. A 401 triggers
  `POST /auth/refresh` with `x-refresh-token` and stores the new `user.accessToken` and
  `user.refreshToken`; the refresh token rotates on every use. The request is then retried once.
  Requests that hit a 401 together share one refresh. If the server refuses the refresh (401/403),
  the app forgets the sign-in and shows the form with "Your session has ended. Sign in again."
  This follows `server/Auth.js` and `server/auth/TokenManager.js` in advplyr/audiobookshelf.
- **Media URLs:** ABS's JWT strategy also reads `?token=`, so audio URLs carry the access token.
  They come from the `trackUrls` resource. If the audio fails to load (an access token that expired
  mid-book), the player renews the token once, rebuilds the URL and resumes where it was. Covers
  need no auth in ABS (`Auth.js` `ignorePatterns`), so cover URLs carry no token and never expire.
- **Library:** `GET /api/libraries` gives the sidebar's library rows. The chosen library is
  remembered with `persist`.
  `GET /api/libraries/:id/items` lists its books, merged with `GET /api/me`'s `mediaProgress` for
  each book's progress. Covers are `/api/items/:id/cover`.
- **A book's page:** `GET /api/items/:id?expanded=1&include=progress` gives
  `Book.oldMetadataToJSONExpanded`'s metadata: `subtitle`, `authors[]`, `narrators[]`, `series[]`
  `{id, name, sequence}`, `genres[]`, `publishedYear`, `publisher`, `language`, `isbn`, `asin`, and
  `description` as HTML. It also gives the item's `size` and the listener's progress.
  - **Description:** `descriptionPlain` strips the tags and runs the paragraphs together, so
    `text.ts` turns `description` into paragraphs (block ends, `<br>`, list bullets, entities).
  - **Hero:** sits over an ambient backdrop, the cover itself blurred and saturated (CSS `filter`),
    faded into the window with a `mask-image` gradient. It shows "Book N of <Series>" (linking the
    series), the title and subtitle, the author (linking their page) and narrator, and a slim
    progress bar with the time left.
  - **Actions:** Play/Continue is a prominent glass button. Download is a glass button that turns
    into inline progress and Cancel. The … menu has Mark as Finished, Show in Series, Go to Author,
    Remove Download and Copy Link (the book's page in the server's web app).
  - **About:** clamps to four lines with More, up to 42rem wide.
  - **Information:** genres as tags, then length, chapters, published, publisher, language,
    narrator, ISBN, ASIN, size, and the size on this Mac when downloaded.
  - **Chapters:** the first eight, with Show All. A click plays from that chapter, and the chapter
    playing is marked.
  - **Shelves:** More in <Series> (the series' other books, by sequence) and More by <Author>
    (`GET /api/authors/:id?include=items`, less what the series shelf shows).
  - **Width:** the hero sits beside its text when wide and stacks above it when narrow
    (`flex-wrap`).
- **Author, series and collection pages:** an author has a large round photo over a blurred
  backdrop of itself, with the bio at four lines and More. A series and a collection have a header
  of fanned covers, with books, length and how many are finished, then numbered rows (a series by
  its sequence) with cover, length and progress.
- **Listen Now:** `GET /api/libraries/:id/personalized` (`LibraryItem.getPersonalizedShelves`) gives
  shelves, each `{id, label, type, entities}`. The book, series and author shelves (Continue
  Listening, Recently Added, Recent Series, Discover, Newest Authors…) become horizontal shelves.
- **A library's page:** Books, Series, Authors and Collections are the toolbar's centred segments.
  - **Books:** a cover grid or a list (the toolbar's toggle), with Sort (title, author, recently
    added, progress) and Filter (in progress, finished, not started, downloaded) menus in the
    toolbar, all remembered. They become `GET /api/libraries/:id/items?sort=…&desc=…&filter=progress.<base64>&limit=…`
    (`libraryItemsBookFilters`' sort keys and `libraryFilters.decode`'s base64 values).
    Downloaded is answered from app storage. Books come 24 at a time: the next page loads when the
    end of the grid scrolls into view (`intersect=`), or from Show More.
  - **Series:** `GET /api/libraries/:id/series`. A series page is the library's items with
    `filter=series.<base64 id>&sort=sequence`, each under "Book N".
  - **Authors:** `GET /api/libraries/:id/authors`. An author page is
    `GET /api/authors/:id?include=items,series`, with the photo (`/api/authors/:id/image`, no
    auth; initials when ABS has none), bio, series and books.
  - **Collections:** `GET /api/libraries/:id/collections`, and a collection's page.
- **Search:** `GET /api/libraries/:id/search?q=…&limit=24` for the chosen library, asked as you
  type. ABS answers `{book: [{libraryItem}], authors, series, narrators, tags, genres}`
  (`LibraryController.search` → `libraryItemsBookFilters.search`), with each `libraryItem`
  expanded. Book matches show as covers and author matches by name.
- **Detail:** `GET /api/items/:id?expanded=1&include=progress` gives the title, authors, narrators,
  description (tags stripped), duration and chapters.
- **Playback:** `POST /api/items/:id/play` (direct play) returns the session, its audio tracks and
  chapters. One HTML `audio` element (AVPlayer on macOS) streams the current track. It sits outside
  the screens, so playback goes on while you browse.
  - Positions are in the book's time: a seek finds the track that holds it, loads it, and seeks on
    `loadedmetadata`. When a track ends, the next one starts.
  - The scrubber (a drag, or ←/→ for 15 s), ±30 s, previous/next chapter, a chapter tap and
    speed (0.75×–2×) all work this way. Volume is the `audio` element's, remembered.
  - It is the system's Now Playing app (media keys, Control Center).
- **Downloads:** Download on a book's page plans the book with
  `GET /api/items/:id?expanded=1&include=progress`. It keeps the metadata, chapters, cover, track
  list (each track's `contentUrl` and `metadata.size`) and where the listener is, in
  `app:/data/downloads/index.json`. A task then fetches one track per step. Each track is a
  `fetch` with `exactBodyTo: "app:/data/downloads/<id>/track-<n>"`, so the host writes the bytes
  straight to the file (staged, replaced only when complete). Progress shows on the page and on
  the book's cover in every grid, track by track, weighted by size. Cancel aborts the track in
  flight and deletes what was fetched; Remove Download deletes the files. The Downloads row lists
  what's kept.
- **Offline playback:** a downloaded book always plays from its files, with no server session.
  It opens at the later of the kept position and the server's
  (`GET /api/me/progress/:id`, when reachable), and its detail page opens from the kept metadata
  when the server can't be reached.
- **Queued progress:** a downloaded book's syncs go to `app:/data/progress-queue.json`, one entry
  a book, newest wins. They are sent with `PATCH /api/me/progress/batch/update`
  (`MeController.batchUpdateMediaProgress`: `[{libraryItemId, currentTime, duration, progress,
  isFinished}]`) on every sync, and every 30 s while anything waits. What the server can't take
  stays queued.
- **Sync:** `POST /api/session/:id/sync` every 15 s while playing, and on resume. It sends
  `currentTime`, `timeListened` (capped at 60 s) and `duration`. `POST /api/session/:id/close`
  runs on Stop, on starting another book, and on sign-out.

## Features

| Feature | State |
| --- | --- |
| Sign in (server URL, username, password), kept across launches, sign out | Done |
| Sidebar (Listen Now, Search, one row per library), collapsible, remembered | Done (native AppKit sidebar) |
| Library cover grid with title, author, cover, progress | Done |
| Search the chosen library | Done (toolbar search field on the Search page) |
| Mini player while browsing | Done (Liquid Glass) |
| Listen Now shelves from ABS's personalized shelves | Done |
| Series, Authors and Collections pages, with detail pages | Done |
| Book detail like Apple Books: hero over a cover backdrop, links, glass actions and … menu, About with More, Information grid, chapters, series and author shelves | Done (backdrop is the blurred cover) |
| Author, series and collection detail headers and lists | Done |
| Hover and pressed covers, context menus, keyboard shortcuts, menu bar playback | Done (hover drawn by the app; playback in View and the Dock menu) |
| Cover art at its own aspect ratio, placeholders, empty and loading states | Done |
| Grid/list toggle, sort, filter, paging | Done (24 at a time, loaded as you scroll) |
| Mini Player window | Done on macOS (a native module's `NSPanel`) |
| Offline downloads: progress, cancel, delete, Downloads row, offline playback, queued sync | Done (progress per track, while the app runs) |
| Continue Listening | Done (`/api/me/items-in-progress`) |
| Item detail: title, author, narrator, description, duration, chapters | Done |
| Playback: session, streaming, play/pause, ±30 s, chapters, scrubber, speed, volume | Done |
| Now Playing like Music: cover backdrop, drawn scrubber with chapter marks, play disc, speed pill, ••• menu, chapters panel | Done (backdrop is the blurred cover, not its dominant colour) |
| Progress sync and close | Done (every 15 s while playing; close on stop) |

## Known gaps

- **macOS needs Xcode 27.** The macOS tests pass with Xcode 27.2 (27B52). Exact's Apple host
  (`exact/host/apple`, at exact `5434f432`) does not compile with Xcode 26.2 / Swift 6.2.3. The
  errors are in Exact's own sources:
  `SystemColorNames.swift:130` (`'quinaryLabelColor' has been renamed to 'quinaryLabel'`), and two
  "unable to type-check this expression in reasonable time" errors (`TextResidency.swift:301`,
  `TextAnswers.swift:213`).
- **`verify`'s `contract verify` step fails inside Exact.** One of Exact's own crates
  (`semantics/difftest`) does not compile. The app's tests and screen checks in `verify` pass.
- **Now Playing's backdrop stops at the toolbar.** A routed app's page can't extend under
  Exact's unified toolbar, so the title bar keeps the window's own material above the blurred
  cover.
- **No colour from the cover.** Neither Contract nor app.ts can read an image's pixels, so the
  backdrop is the blurred cover itself, not its dominant colour.
- **The look's approximations** are listed under "The look: what is native and what is
  approximated" above.
- **One page of items.** `libraryItems` asks for the whole library in one request (no `limit`).
  Very large libraries would want paging on `reachend`.
- **Direct play only.** The session asks for `forceDirectPlay`, so the server's HLS transcode is
  never used. A codec AVPlayer can't play (e.g. some `.ogg`/`.opus`) will fail to load.
- **`timeListened` is approximate.** It is computed from the position moved between syncs (capped
  at 60 s), not from wall-clock listening time: Exact's data module refuses the clock, and Contract
  has no wall time without `exactTime()`.
- **Downloads run while the app runs.** Tracks are fetched by the data module (`fetch` with
  `exactBodyTo`), so quitting stops a download; it resumes at the next undone track when the app
  runs again. `@exact/background-transfer` would let the system finish it, but it is unsupported
  on the web, and its events arrive in wakes that a driven test can't make.
- **Download progress moves a track at a time.** `exactBodyTo` reports the bytes written once the
  file is complete, not as they arrive. A single-file book shows 0% until done.
- **No bookmarks, podcasts, or author/series pages.** Podcast libraries list their items, but
  episodes aren't handled.
- **SF Symbols on the web.** Headphones, books and previous/next chapter use `app.tamber` icon
  tokens: the SF Symbol on Apple, an SVG elsewhere. Every other symbol is one of Exact's built-in
  roles.
- **Reload and pushed screens.** On macOS a relaunch reopens a section at its root, not on a book
  that was pushed. The web restores the pushed screen from its URL.
- **Tests and real time.** Exact's clock is virtual, but media events are the host's and arrive in
  real time. The player therefore ignores `timeupdate` until a seek's `seeked`, and the tests read
  positions while paused.
