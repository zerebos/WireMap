# Breakerbook

Breaker panel manager for a US home. The **Panel** is drawn like the real one: click a breaker to
see and edit what it powers. The **Map** shows each floor with its rooms and items where they
really are. Pick a circuit to light up everything it feeds, or click a room to see every breaker
it depends on. **Items** is the full inventory, with the ones that still need a breaker or a spot
on the map flagged. Two phone flows help at the panel itself. **Shut off** lists the breakers to
flip for a room, in panel order. **Trace** walks you through mapping an unknown breaker: flip it,
tap what went dark, then name it.

The UI follows the design handoff in [`docs/design/`](docs/design/README.md).

Everything runs in your browser. There's no server to host: the data is a SQLite database kept
in the browser's private storage (OPFS), and the app works offline once it has loaded, so it's
still there when the power's out and the Wi-Fi with it. It can be installed as an app
(Add to Home Screen / Install app).

Stack: SvelteKit (Svelte 5, TypeScript) built as a static single-page app, Drizzle ORM on
[SQLite Wasm](https://sqlite.org/wasm) running in a web worker.

## Run it

```sh
bun install
bun run dev          # http://localhost:5173
```

The first visit creates the database, applies the migrations and adds the example house from
`docs/design/seed.json`.

## Your data

- It's stored per browser and per device. Your phone and your laptop each have their own copy.
- **Settings → Data & backups** downloads everything (including floor plan images) as one `.sqlite` file,
  and restores from one. That's also how you move to another device. Keep a backup somewhere
  safe: browsers can clear site data, and Safari does after a week without a visit unless the
  app is on your home screen. That page can also ask the browser to keep the data permanently.
- A backup is a standard SQLite file. You can open it with any SQLite tool, or with Drizzle
  Studio: `DATABASE_URL=Home-2026-09-24.sqlite bun run db:studio`.
- Only one tab can have the app open at a time; a second tab says so.
- If the browser can't store data at all (some private windows), the app still works but warns
  that changes are lost when the tab closes.

## Hosting

```sh
bun run build        # static site in build/
bun run preview      # try the build locally
```

`build/` can be served by any static web server. Unknown paths should fall back to
`index.html` (or `404.html`, which is the same page). It must be served over HTTPS or from
`localhost`: browsers only allow the storage and offline support on secure pages.

If the app isn't at the root of the site, build with its path, e.g. `BASE_PATH=/breakers bun run build`.

### GitHub Pages

`.github/workflows/pages.yml` builds every push and publishes `main` to
`https://<user>.github.io/<repo>/`. Turn it on once under Settings → Pages → Build and
deployment → Source: **GitHub Actions**. Every visitor gets their own copy of the example house,
so it works as a demo.

## Data model

See [`docs/design/DATA-MODEL.md`](docs/design/DATA-MODEL.md). In short:

- **panels**: name, main breaker amps, spaces (`slot_count`), slot numbering ("odd left, even
  right" or "down the left, then the right"), location, and which slots take tandem breakers.
  A subpanel has a short code that prefixes its breaker numbers ("G6") and `fed_by_breaker_id`,
  the breaker in another panel that feeds it.
- **breakers**: first slot (and A/B half for a tandem), poles, amps, protection
  (standard/GFCI/AFCI/dual), label, notes, when it was last traced, spare, and a tie group for
  handle-tied breakers.
- **breaker_spaces**: the spaces each breaker takes: whole slots, or A/B halves for tandems and
  quads ("21A/23B").
- **floors**: stacking order, an optional plan image (stored in **plan_images**, so a backup is
  one file) with its opacity, position, size, rotation and lock, and a drawing area
  (`plan_width` × `plan_height` map units) with a scale.
- **rooms**: floor, name, interior/exterior, and an outline (rectangle or polygon) in map units.
- **items**: outlet, light, switch or appliance, with a floor, a room, a position on the map,
  notes, and a "critical" flag with a note (fridge, sump pump…) that the shut-off flow calls out.
- **item_breakers**: which breakers feed an item. Usually one, sometimes none, occasionally two
  (a switch box on two circuits).
- **settings**: home name, start page, theme, leg markers, map fading, read-only guest view.

## Using the map

- **Select**: pick a circuit on the left to light up what it feeds, click an item to find its
  breaker, or click a room to see every circuit in it (and shut the room off from your phone).
- **Edit layout**: draw rooms (rectangles or polygons), move and resize them, set the scale, and
  add new items with the **Item** tool (pick a type, click where it is, name it and pick its
  breaker), and place items from *Not placed*. An item's room comes from where it sits.
- **Floor plan**: upload a PNG, JPG, WebP or PDF (its first page) to trace over. Move, size and
  rotate it to line up with the rooms, set how strongly it shows, and lock it in place.

## Roadmap

These are in the design but need a server version of the app to be done properly. Until then
Settings shows them as disabled placeholders, or as the local stand-in described below:

- **Access**: sign-in, users and passwords.
- **Read-only guest view, done properly**: today Settings → Access → "Read-only guest view"
  locks only the device it's turned on for (say, a tablet mounted by the panel), and Sign in
  unlocks it without checking a password. It keeps a tablet from being changed by accident; it
  isn't security. With a server and real accounts, guest view should be enforced by the server
  for anyone on the network, and Sign in should need a real account.
- **Automatic backups**: nightly backups kept for a set number of days.
- **Tracing from a phone**: the design has you scan a QR code on the computer and walk the
  house with your phone. Each browser keeps its own copy of the data, so the phone can't see the
  computer's house yet. For now Trace runs on the device you start it from, and the QR code is a
  placeholder.
- **Owner account** in first-run setup: the fields are shown but disabled.
- **Download PDF** of the printed panel directory: the design renders it with a headless browser
  on the server. For now, Print and choose "Save as PDF" in the browser's print dialog.
- **QR code on the printed directory**: it prints today and opens the live map where this copy
  of the app is served (GitHub Pages, say). On the server version the QR will point at your own
  server instead of GitHub Pages.

The local-first version is meant for prototyping and demoing; a server version is the likely
long-term direction.

Not designed yet, so ask the owner before building:

- Keyboard access on the map: drawing rooms and placing items without a pointer.
- CSV import column mapping (today the CSV must use the exact column names).
- Change history.
- A 3D view (exploratory).

## Changing the schema

Edit `src/lib/db/schema.ts`, then `bun run db:generate` to write a new migration into
`drizzle/`. The migrations are bundled into the app and applied in the browser on the next
load, and also to older backups when they're restored.
