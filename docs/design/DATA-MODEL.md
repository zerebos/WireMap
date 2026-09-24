# Breakerbook — Data Model

What the UI in `DESIGN.md` needs to exist. Names are suggestions; the shapes and rules are not. `seed.json` is the sample house from the mockups in roughly this shape. Use it to seed dev and screenshot tests.

## Entities

### panels
| field | type | notes |
|---|---|---|
| id | pk | |
| name | text | "Main panel" |
| short_code | text? | 1–3 letters prefixed to breaker numbers ("G6"); null/empty for the main panel; unique |
| main_amps | int? | 100–400; null = main lugs (typical for subpanels) |
| spaces | int | 20 / 24 / 30 / 40 / 42 |
| numbering | enum | `odd_left_even_right` (default) · `down_left_then_right` |
| location | text? | "Basement utility room" |
| tandem_slots | text? | range from the panel label, e.g. "17-28"; null = unknown (tandems allowed anywhere, no warning) |
| fed_by_breaker_id | fk breakers? | null for the main panel; set for subpanels |

### breakers
| field | type | notes |
|---|---|---|
| id | pk | |
| panel_id | fk | |
| slot | int | first slot it occupies |
| half | enum? | `A` · `B` for tandem halves; null = full-size |
| poles | int | 1 or 2. A 2-pole at `slot` also occupies `slot + 2` |
| amps | int | 15 / 20 / 30 / 40 / 50 (allow others) |
| protection | enum | `standard` · `gfci` · `afci` · `dual` |
| label | text? | null = "Unlabeled" in the UI |
| notes | text? | |
| last_checked_at | timestamp? | set when a trace of this breaker is saved |
| is_spare | bool | saved from trace with nothing marked |
| tie_group | int? | breakers sharing a value are handle-tied (multi-wire circuit); UI keeps them adjacent and lists them as one shutoff row |

**Occupancy (breaker_spaces).** Which spaces a breaker takes is stored explicitly, because quad breakers pair *across* halves (outer pair = 21A + 23B, inner pair = 21B + 23A), so it can't be derived from slot + half + poles.

| field | type | notes |
|---|---|---|
| breaker_id | fk | |
| slot | int | 1..spaces |
| half | enum? | `A` · `B`; null = the whole space |

Rules (validate on every add/move/resize):
- A space `(panel, slot)` holds either **one** row with `half = null`, or up to **two** rows with `half = A` and `half = B`. Never a null row plus a half row.
- 1-pole full-size: 1 row `(s, null)`. 2-pole full-size: `(s, null)`, `(s+2, null)`.
- Tandem half: 1 row `(s, A)` or `(s, B)`.
- Quad: two 2-pole breakers over slots s and s+2: outer `(s, A)`, `(s+2, B)`; inner `(s, B)`, `(s+2, A)`. Mixed quads (one 2-pole + two 1-poles) fill the remaining halves with 1-pole breakers.
- 2-pole spaces must be in the same column (s and s+2); half-width breakers (tandem/quad) only in `panels.tandem_slots` when set (warn, don't block).
- `breakers.slot` / `breakers.half` stay as the **anchor** (first space) for sorting and display; `breaker_spaces` is the source of truth.
- Display number: spaces in order joined by "/", slot + half each, panel short code prefixed once: "1/3", "17B", "21A/23B", "G3/5". Sort by anchor slot, then half.
- Quad pair (`outer` / `inner`) is derived from the spaces; brands differ, so the UI lets the user swap which pair is which (that just swaps the halves on the second slot).

### floors
| field | type | notes |
|---|---|---|
| id | pk | |
| name | text | |
| sort | int | bottom = 0. Settings lists them top-down; Map tabs bottom-up |
| plan_image | file ref? | PNG/JPG/PDF (render PDF page 1) |
| plan_opacity | real | 0–1, default .35 |
| plan_offset_x, plan_offset_y | real | image position in map units |
| plan_scale | real | image size multiplier, default 1 |
| plan_rotation | int | 0 / 90 / 180 / 270 |
| plan_locked | bool | |
| units_per_ft | real? | from Set scale; null = sizes hidden |

### rooms
| field | type | notes |
|---|---|---|
| id | pk | |
| floor_id | fk | |
| name | text | unique per floor |
| kind | enum | `interior` · `exterior` (dashed outline, drawn outside walls) |
| shape | json? | `{type:"rect",x,y,w,h}` or `{type:"polygon",points:[[x,y],…]}` in map units; null = not drawn yet |

Map units: one coordinate space per floor. The mockups use an 820 × 760 canvas; store floats and keep a per-floor scale if real-world dimensions are added later.

### items
| field | type | notes |
|---|---|---|
| id | pk | |
| type | enum | `outlet` · `light` · `switch` · `appliance` |
| name | text | |
| floor_id | fk | |
| room_id | fk? | derived from x,y on save (point-in-shape); null = "Not in a room" |
| x, y | real? | null = not placed on the map |
| critical | bool | fridge, sump pump, furnace, server rack… |
| critical_note | text? | shown in shutoff "Heads up" |
| notes | text? | |

### item_breakers (many-to-many)
| field | type |
|---|---|
| item_id | fk |
| breaker_id | fk |

**Decision: items can be fed by more than one breaker.** Real cases: a switch box holding two circuits, multi-wire branch circuits (two breakers that must be off together). Most items have exactly one row here; zero rows = "No breaker". Every "which breaker" question in the UI (Fed by, room circuit cards, shutoff lists, trace moves) must handle 0, 1 or many. Display rules: `DESIGN.md` §5.11.

### settings (single row or key/value)
home_name · start_page (`panel`/`map`/`items`) · theme (`system`/`light`/`dark`) · show_legs (bool) · map_fade_others (bool) · backups_enabled (bool) · backup_retention_days · require_sign_in (bool) · guest_read_only (bool)

### users
id · username · password_hash · role (`owner`/`editor`) · created_at

### Optional: trace_log
breaker_id · traced_at · user_id · items_added · items_removed. Nice for "last checked" history; not required by the current UI.

## Derived values the UI shows

- **Leg** of a slot: row = ceil(slot/2) (odd-left numbering); L1 if row is odd, else L2. 2-pole = both.
- **Display number** with panels: short_code + slot + half, e.g. "G3/5", "G6", "17B".
- **Power path** of a breaker: walk panels.fed_by_breaker_id up to the main panel. **Downstream** of a feeder: every breaker in the fed panel (recursively) and their items.
- **Physical position**: "{Left|Right}, row {n}".
- **Spaces used**: number of distinct slots with any breaker_spaces row (a tandem or quad pair shares spaces). **Breakers** = number of breaker records.
- **Min. wire gauge** (copper, guidance only): 15A→14 AWG, 20→12, 30→10, 40→8, 50→6.
- **Needs attention**: item with no `item_breakers` row OR `x` is null.
- **Room circuits**: distinct breakers over items in the room; for each, items on it outside the room ("Also feeds…").
- **Shutoff set** for a room/circuit/item: distinct breakers; affected = all items on those breakers; critical = affected with `critical`.
- **Checked progress**: breakers with `last_checked_at` / total breakers.

## API needs (shape, not names)
CRUD for every entity; bulk reassign items to a breaker; save-trace transaction (label + reassignments + last_checked in one write); export/import all as JSON; CSV export of items; floor-plan upload; nightly backup job.
