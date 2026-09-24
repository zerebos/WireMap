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
  right" or "down the left, then the right"), location. `fed_by_breaker_id` is there for subpanels.
- **breakers**: slot, poles (1 or 2; a 2-pole breaker also takes the slot below), amps,
  protection (standard/GFCI/AFCI/dual), label, notes, when it was last traced, spare.
- **floors**: stacking order, an optional plan image (stored in **plan_images**, so a backup is
  one file) and its opacity, and a drawing area (`plan_width` × `plan_height` map units) with a scale.
- **rooms**: floor, name, interior/exterior, and an outline polygon in map units.
- **items**: outlet, light, switch or appliance, with a floor, a room, a position on the map,
  notes, and a "critical" flag with a note (fridge, sump pump…) that the shut-off flow calls out.
- **item_breakers**: which breakers feed an item. Usually one, sometimes none, occasionally two
  (a switch box on two circuits).
- **settings**: home name, start page, theme, leg markers, map fading.

## Using the map

- **Select**: pick a circuit on the left to light up what it feeds, click an item to find its
  breaker, or click a room to see every circuit in it (and shut the room off from your phone).
- **Draw room**: drag a rectangle on the grid, then name it. **Edit shape** on a selected room
  lets you drag its corners.
- **Place item**: pick a type and click where it is. It lands in the room under it.
- **Floor plan**: upload a PNG, JPG or WebP to trace over, and set how strongly it shows.

## Roadmap

These are in the design but need a server version of the app, so Settings shows them as
disabled placeholders for now:

- **Access**: sign-in, users and passwords, and a read-only guest view (for a tablet mounted by
  the panel).
- **Automatic backups**: nightly backups kept for a set number of days.
- **Tracing from a phone**: the design has you scan a QR code on the computer and walk the
  house with your phone. Each browser keeps its own copy of the data, so the phone can't see the
  computer's house yet. For now Trace runs on the device you start it from, and the QR code is a
  placeholder.
- **Owner account** in first-run setup: the fields are shown but disabled.

The local-first version is meant for prototyping and demoing; a server version is the likely
long-term direction.

Designed as open questions in `docs/design/DESIGN.md` §8 and not built yet:

- A fuller display of items on more than one breaker.
- Exterior areas and detached buildings.
- Phone layouts of Panel and Map.
- Subpanels.

Keyboard access on the map: drawing rooms and placing items work only with a pointer, as in the design. A keyboard way to do both needs designing.

Also still to come from before: a 3D view and PDF floor plans.

## Changing the schema

Edit `src/lib/db/schema.ts`, then `bun run db:generate` to write a new migration into
`drizzle/`. The migrations are bundled into the app and applied in the browser on the next
load, and also to older backups when they're restored.
