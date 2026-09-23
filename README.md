# Breaker Box

Self-hosted breaker panel manager. Click a breaker on the visual panel to see and edit what it
powers: outlets, switches, lights, appliances. The **Map** page shows each floor of the house:
draw rooms, upload a floor plan image, place items where they really are, and click a breaker
to light up everything it feeds (or an item to see its breaker).

Stack: SvelteKit (Svelte 5, TypeScript), Drizzle ORM on SQLite via `bun:sqlite`, running on Bun.

## Run it

```sh
bun install
bun run dev          # http://localhost:5173
```

The database is created at `data/breaker-box.db` on first start, migrations run automatically,
and an example house is seeded when the database is empty (set `SEED_DEMO=false` to skip).

The app uses `bun:sqlite`, so it has to run under the Bun runtime. The scripts already pass
`--bun` to Vite; plain `vite dev` under Node won't work.

## Production

```sh
bun run build
ORIGIN=http://breakers.local:3000 bun run start
```

| Variable        | Default               | Notes                                              |
| --------------- | --------------------- | -------------------------------------------------- |
| `DATABASE_URL`  | `data/breaker-box.db` | Path to the SQLite file                            |
| `ORIGIN`        |                       | The URL you open the app at; needed for form posts |
| `PORT`          | `3000`                |                                                    |
| `SEED_DEMO`     | `true`                | Seed example data into an empty database           |
| `MIGRATIONS_DIR`| `drizzle`             | Where the SQL migrations live                      |
| `BODY_SIZE_LIMIT`| `512K`               | Max upload size; set e.g. `20M` for floor plan images (the Docker image does) |

Uploaded floor plans are stored in a `plans/` folder next to the database file.

The build prints an `UNRESOLVED_IMPORT` warning for `bun:sqlite`. That's expected: it's a Bun
built-in, resolved at runtime.

## Data model

- **panels**: name, location, main breaker amps, slot count. `fed_by_breaker_id` is there for sub-panels.
- **breakers**: slot, poles (1 or 2), amps, type (standard/GFCI/AFCI/dual), label, color tag.
  Slots use the usual US numbering: odd on the left, even on the right; a 2-pole breaker takes
  its slot and the one below it.
- **floors** / **rooms**: floors carry a level, elevation, a drawing area (`plan_width` ×
  `plan_height` in plan units), an optional plan image stretched over that area, and a scale
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

Edit `src/lib/server/db/schema.ts`, then `bun run db:generate` to write a new migration into
`drizzle/`. It's applied on the next start.

## Docker

```sh
docker build -t breaker-box .
docker run -p 3000:3000 -v breaker-data:/data -e ORIGIN=http://localhost:3000 breaker-box
```
