# Breaker Box

Self-hosted breaker panel manager. Click a breaker on the visual panel to see and edit what it
powers: outlets, switches, lights, appliances. The **Map** page shows each floor of the house:
draw rooms, upload a floor plan image, place items where they really are, and click a breaker
to light up everything it feeds (or an item to see its breaker).

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

The first visit creates the database, applies the migrations and adds an example house.

## Your data

- It's stored per browser and per device. Your phone and your laptop each have their own copy.
- The **Backup** page downloads everything (including floor plan images) as one `.sqlite` file,
  and restores from one. That's also how you move to another device. Keep a backup somewhere
  safe: browsers can clear site data, and Safari does after a week without a visit unless the
  app is on your home screen. The Backup page can ask the browser to keep the data permanently.
- A backup is a standard SQLite file. You can open it with any SQLite tool, or with Drizzle
  Studio: `DATABASE_URL=breaker-box-2026-09-24.sqlite bun run db:studio`.
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

- **panels**: name, location, main breaker amps, slot count. `fed_by_breaker_id` is there for sub-panels.
- **breakers**: slot, poles (1 or 2), amps, type (standard/GFCI/AFCI/dual), label, color tag.
  Slots use the usual US numbering: odd on the left, even on the right; a 2-pole breaker takes
  its slot and the one below it.
- **floors** / **rooms**: floors carry a level, elevation, a drawing area (`plan_width` ×
  `plan_height` in plan units), an optional plan image stretched over that area (stored in
  **plan_images**, so a backup is one file), and a scale
  (`meters_per_unit`, 1 unit = 1 cm until you measure one). Rooms carry an optional outline
  polygon in the same plan units.
- **devices**: kind, name, breaker, room, plus optional `pos_x/pos_y` (plan units) and `pos_z`
  (height above the floor in metres). A device's floor comes from its room; dropping it inside a
  room outline on the map sets the room.

## Using the map

- **Draw room**: click the corners, then click the first corner (or press Enter). Corners snap to
  other rooms' corners and walls; Shift keeps a line straight, Alt turns snapping off. Select a
  room to drag its corners, drag a midpoint to add a corner, or double-click a corner to remove it.
- **Set scale**: click both ends of a wall you know the length of and enter it.
- **Add item**: click where it is; kind and breaker stick between items for quick mapping.
  Items that aren't placed yet are listed beside the map: pick one, then click where it goes.
- The small panel beside the map works both ways: click a breaker to highlight its items, click
  an item to highlight its breaker.

## Changing the schema

Edit `src/lib/db/schema.ts`, then `bun run db:generate` to write a new migration into
`drizzle/`. The migrations are bundled into the app and applied in the browser on the next
load, and also to older backups when they're restored.
