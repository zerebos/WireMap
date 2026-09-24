# Breakerbook

Breaker panel manager for a US home. Click a breaker to see and edit what it powers. A floor map shows rooms and items where they really are. Phone flows help you shut off a room safely and trace unknown breakers.

## The design is already done

`docs/design/` is the source of truth for the UI. Read it before writing any UI code.

- `docs/design/DESIGN.md` is the spec. It covers principles, token usage, components, every screen, interactions, states and accessibility. §8 lists what is **not** designed yet.
- `docs/design/DATA-MODEL.md` covers the entities, rules and derived values.
- `docs/design/tokens.css` holds every color, font, radius and size for both themes. The app uses a copy at `src/lib/tokens.css`, imported by `src/app.css`. Keep the two in sync.
- `docs/design/mockups/*.dc.html` are interactive mockups. Read them as source for exact values, copy and behavior. `mockups/README.md` explains the format and how it maps to Svelte.
- `docs/design/screens/*.png` are the visual targets.
- `docs/design/seed.json` is the sample house every mockup uses. `src/lib/db/seed.ts` loads it into a new database.

### Rules
1. Match the design. Don't restyle, simplify or "improve" it. If something seems wrong or missing, ask.
2. Colors, fonts, radii and sizes come only from `tokens.css` variables. No hex values in components.
3. No UI libraries (no Tailwind, shadcn, Bootstrap or Material). Use plain CSS, scoped per component and built on the tokens. Shared component classes that match the mockups (`.btn`, `.seg`, `.sw`, `.fld`, `.bnum`…) live in `src/app.css`.
4. Fonts are Archivo (variable, including the width axis) and JetBrains Mono. They're self-hosted from the `@fontsource-variable` packages so the app works offline.
5. Use real elements only: `<button>`, `<a href>` and form controls. No click handlers on divs. Put `aria-label` on icon buttons. Show a visible focus ring everywhere.
6. Don't add screens, settings, stats or features that aren't in the spec. §8 items need the owner's decision first.
7. Items can have 0, 1 or many breakers (`item_breakers`). Never assume exactly one.

## Stack

This is a **local-first** app. It diverges from the handoff's server/Docker assumption on purpose.

- SvelteKit (Svelte 5 runes) + TypeScript, built with `adapter-static` as a single-page app (`ssr = false`). Run it with Bun.
- SQLite runs in the browser. `@sqlite.org/sqlite-wasm` uses the OPFS "SAH pool" VFS in a worker (`src/lib/db/worker.ts`), and Drizzle reaches it through its `sqlite-proxy` driver (`src/lib/db/index.ts`). There is no server, no API routes and no form actions.
- Floor-plan images are stored in the `plan_images` table, so a backup is one `.sqlite` file (Settings → Data & backups).
- A service worker and web manifest make it an installable PWA that works offline. `.github/workflows/pages.yml` deploys `main` to GitHub Pages under `/WireMap/`.
- Features that need a server (sign-in and users, nightly backups) exist in Settings only as disabled placeholders. They're on the README roadmap.

Confirm with the owner before changing any of these.

## How the code fits together
- `src/routes/+layout.ts` loads the whole house once (`loadHouse()` in `src/lib/house.ts`). Every page reads `data.house` and derives what it needs with `index(house)`.
- All writes are in `src/lib/db/ops.ts`. Call them through `mutate(() => op(...))`, which reloads the house afterwards.
- Panel geometry lives in `src/lib/panel.ts`: slot numbering (both schemes), legs, "Left, row 5" and 2-pole occupancy.
- The header search writes `search.q` (`src/lib/search.svelte.ts`). Each page filters itself with it.
- The theme is `settings.theme`, applied as `data-theme` on `<html>` (`src/lib/theme.ts`) and mirrored to localStorage so `app.html` can set it before paint.
- Selection state that should survive a reload or a link lives in the URL. For example `/panel?b=`, `/map?item=|circuit=|room=&floor=`, `/items?item=`, `/shutoff?room=|breaker=|item=` and `/trace?b=`.

## Commands
- `bun install`, then `bun run dev`.
- Typecheck with `bun run check` (svelte-check), not plain `tsc`. It must report 0 errors and 0 warnings.
- Schema changes: edit `src/lib/db/schema.ts`, then run `bun run db:generate`. The migrations in `drizzle/` are bundled and applied in the browser. drizzle-kit prompts interactively on renames, which fails without a TTY. For those, write the SQL by hand with `drizzle-kit generate --custom` and regenerate that migration's snapshot from the schema.
- Production build as on Pages: `BASE_PATH=/WireMap bun run build`, then serve `build/` under `/WireMap/` with an SPA fallback to `404.html`.

## How to work
For each screen:
1. Read its section in `DESIGN.md` and its mockup file, then build it.
2. Build the app and serve it under `/WireMap/`.
3. Screenshot it with Playwright at the mockup's size (1440×960 desktop, 390×844 phone) in both themes, and compare against `docs/design/screens/`. A fresh browser profile starts with the seeded example house.
4. Fix differences before moving on. Say what still differs, if anything, when you finish a screen.

Wait for the data to render before interacting. `networkidle` returns immediately because nothing goes over the network.
