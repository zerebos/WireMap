# Breaker Box

Self-hosted breaker panel manager. Click a breaker on the visual panel to see and edit what it
powers: outlets, switches, lights, appliances. Items belong to rooms and floors so they can be
placed on a 2D/3D house map later.

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

The build prints an `UNRESOLVED_IMPORT` warning for `bun:sqlite`. That's expected: it's a Bun
built-in, resolved at runtime.

## Data model

- **panels**: name, location, main breaker amps, slot count. `fed_by_breaker_id` is there for sub-panels.
- **breakers**: slot, poles (1 or 2), amps, type (standard/GFCI/AFCI/dual), label, color tag.
  Slots use the usual US numbering: odd on the left, even on the right; a 2-pole breaker takes
  its slot and the one below it.
- **floors** / **rooms**: floors carry a level, elevation and optional plan image and scale;
  rooms carry an optional outline polygon.
- **devices**: kind, name, breaker, room, plus optional `pos_x/pos_y/pos_z` for the map.

## Changing the schema

Edit `src/lib/server/db/schema.ts`, then `bun run db:generate` to write a new migration into
`drizzle/`. It's applied on the next start.
