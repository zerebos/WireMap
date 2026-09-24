# Breakerbook — Data Model

What the UI in `DESIGN.md` needs to exist. Names are suggestions; the shapes and rules are not. `seed.json` is the sample house from the mockups in roughly this shape. Use it to seed dev and screenshot tests.

## Entities

### panels
| field | type | notes |
|---|---|---|
| id | pk | |
| name | text | "Main panel" |
| main_amps | int | 100–400 |
| spaces | int | 20 / 24 / 30 / 40 / 42 |
| numbering | enum | `odd_left_even_right` (default) · `down_left_then_right` |
| location | text? | "Basement utility room" |
| fed_by_breaker_id | fk breakers? | null for the main panel; set for subpanels |

### breakers
| field | type | notes |
|---|---|---|
| id | pk | |
| panel_id | fk | |
| slot | int | first slot it occupies |
| poles | int | 1 or 2. A 2-pole at `slot` also occupies `slot + 2` |
| amps | int | 15 / 20 / 30 / 40 / 50 (allow others) |
| protection | enum | `standard` · `gfci` · `afci` · `dual` |
| label | text? | null = "Unlabeled" in the UI |
| notes | text? | |
| last_checked_at | timestamp? | set when a trace of this breaker is saved |
| is_spare | bool | saved from trace with nothing marked |

Constraints: slots within `1..spaces`; no two breakers overlap (count 2-pole occupancy); a 2-pole's second slot must exist. Tandem/quad breakers are out of scope for now.

### floors
| field | type | notes |
|---|---|---|
| id | pk | |
| name | text | |
| sort | int | bottom = 0. Settings lists them top-down; Map tabs bottom-up |
| plan_image | file ref? | PNG/JPG/PDF (render PDF page 1) |
| plan_opacity | real | 0–1, default .35 |

### rooms
| field | type | notes |
|---|---|---|
| id | pk | |
| floor_id | fk | |
| name | text | unique per floor |
| kind | enum | `interior` · `exterior` (dashed outline, drawn outside walls) |
| shape | json? | polygon points in map units; null = not drawn yet (still selectable from item links) |

Map units: one coordinate space per floor. The mockups use an 820 × 760 canvas; store floats and keep a per-floor scale if real-world dimensions are added later.

### items
| field | type | notes |
|---|---|---|
| id | pk | |
| type | enum | `outlet` · `light` · `switch` · `appliance` |
| name | text | |
| floor_id | fk | |
| room_id | fk? | null = "Not in a room" |
| x, y | real? | null = not placed on the map |
| critical | bool | fridge, sump pump, furnace, server rack… |
| critical_note | text? | shown in shutoff "Heads up" |
| notes | text? | |

### item_breakers (many-to-many)
| field | type |
|---|---|
| item_id | fk |
| breaker_id | fk |

**Decision: items can be fed by more than one breaker.** Real cases: a switch box holding two circuits, multi-wire branch circuits (two breakers that must be off together). Most items have exactly one row here; zero rows = "No breaker". Every "which breaker" question in the UI (Fed by, room circuit cards, shutoff lists, trace moves) must handle 0, 1 or many. See `DESIGN.md` §8.2 for the display proposal.

### settings (single row or key/value)
home_name · start_page (`panel`/`map`/`items`) · theme (`system`/`light`/`dark`) · show_legs (bool) · map_fade_others (bool) · backups_enabled (bool) · backup_retention_days · require_sign_in (bool) · guest_read_only (bool)

### users
id · username · password_hash · role (`owner`/`editor`) · created_at

### Optional: trace_log
breaker_id · traced_at · user_id · items_added · items_removed. Nice for "last checked" history; not required by the current UI.

## Derived values the UI shows

- **Leg** of a slot: row = ceil(slot/2) (odd-left numbering); L1 if row is odd, else L2. 2-pole = both.
- **Physical position**: "{Left|Right}, row {n}".
- **Spaces used**: Σ poles.
- **Min. wire gauge** (copper, guidance only): 15A→14 AWG, 20→12, 30→10, 40→8, 50→6.
- **Needs attention**: item with no `item_breakers` row OR `x` is null.
- **Room circuits**: distinct breakers over items in the room; for each, items on it outside the room ("Also feeds…").
- **Shutoff set** for a room/circuit/item: distinct breakers; affected = all items on those breakers; critical = affected with `critical`.
- **Checked progress**: breakers with `last_checked_at` / total breakers.

## API needs (shape, not names)
CRUD for every entity; bulk reassign items to a breaker; save-trace transaction (label + reassignments + last_checked in one write); export/import all as JSON; CSV export of items; floor-plan upload; nightly backup job.
