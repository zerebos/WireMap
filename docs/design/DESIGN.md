# Breakerbook — Design Spec

Self-hosted manager for a US residential breaker panel. Click a breaker to see and edit what it powers; the Map shows each floor with rooms and items placed where they really are.

This spec plus `tokens.css` and the mockups in `mockups/` are the source of truth for the UI. Build what is described here. Where this document is silent, read the mockup file for exact values (sizes, paddings, copy). Where both are silent, ask; don't invent.

---

## 1. Principles

1. **The panel is the hero.** The breaker panel is drawn like the physical one: two columns, odd slots left, even right, 2-pole breakers spanning two rows. Users should recognize their box.
2. **One accent, one meaning.** Amber (`--amber`) means *selected / powered / the thing you're acting on*. It is never decoration. Text on amber is always `--on-amber`.
3. **Utilitarian and dense.** Tables, lists and labels over cards and hero sections. No dashboards of vanity numbers, no gradients, no emoji, no illustration.
4. **Dark by default, light available.** Both themes are first-class. Every color comes from `tokens.css`.
5. **Safety copy is plain and constant.** Anywhere the user may touch wiring (shutoff, trace) a short "test before you touch" reminder is always visible. Data can be wrong; the UI says so.
6. **Real controls.** Every clickable thing is a `<button>`, `<a href>` or form control. No clickable divs.

---

## 2. Foundations

### Color
All tokens are in `tokens.css`, grouped by role. Key rules:

| Role | Token | Notes |
|---|---|---|
| Page background | `--bg` | |
| Sidebars, toolbars, list headers | `--raised` | one step off the background |
| Cards, inputs, inspector | `--surface` | |
| Primary text / strong borders | `--ink` | |
| Secondary text | `--muted` | ≥ 4.5:1 on `--surface` in both themes |
| Hairlines | `--line` (light), `--line-2` (stronger) | |
| Destructive / unlabeled / "no breaker" | `--warn` | text or outline only; never a big fill |
| Selected / powered | `--amber` + `--on-amber` | |
| Soft amber callouts | `--amber-soft` bg + `--amber` 1–1.5px border + `--amber-ink` title | "Fed by", "Heads up", "Not on a breaker yet" |
| Protection tags | `--tag-bg` / `--tag-fg` | GF, AF, DF |
| Focus ring | `--focus`, 3px outline, 2px offset | all interactive elements |

The **app header is dark in both themes** (`--hdr`), with constant header tokens (`--hdr-fg`, `--hdr-nav`, `--hdr-field*`).

The **primary button** flips per theme: ink-on-light in light theme, amber-with-dark-text in dark theme (`--pri`, `--pri-fg`).

**Inverted status bars** (search results bar on Panel, bottom chip on Map, bulk-action bar on Items, toasts) use `background: var(--ink); color: var(--bg)` so they invert per theme.

### Type
- **Archivo** (Google Fonts, variable `wdth,wght@62..125,100..900`). UI font. Width axis is part of the look:
  - breaker labels `font-stretch: 80%`, 14px/500
  - room labels on the map `85%`, 11px/700 uppercase, `.06em` tracking
  - body `100%`
  - section headings (h2) `105–108%`, 18–22px/800
  - page titles (h1) and wordmark `112%`, 28px/800, `-0.02em`
- **JetBrains Mono** 400/600 for anything numeric or code-like: slot numbers, amps, leg markers, counts, overlines, file names.
- **Overline** (`.ov` in mockups): mono 11px/600, uppercase, `.07em` tracking, `--muted`. Used as section labels inside panels.
- Minimum text size 11px (overlines/badges only); body 13–15px.

### Spacing, radii, sizes
- Gaps come from this set: 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32. Layout with flex/grid + `gap`, not margins.
- Radii tokens `--r-xs` … `--r-2xl` (see `tokens.css` comments for which component uses which).
- Controls are 44px tall (`--control-h`); compact filter controls 38px. Touch targets ≥ 44px everywhere except map item markers (32px, deliberate: they sit on a dense plan).
- Desktop reference width 1440; layouts must hold down to ~1200. Phone flows are designed at 390 wide.

### Icons
Inline stroke SVG, 1.9–2px stroke, `currentColor`, `stroke-linecap: round`. No icon font, no emoji. The four item-type icons are canonical, so copy the paths from any mockup:
- **Outlet**: rounded rect + two vertical slots + ground dot
- **Light**: bulb
- **Switch**: rect + toggle
- **Appliance**: rect + circle (washer-like) + small top line

---

## 3. App shell

- **Header** (60px, `--hdr`): wordmark (breaker glyph in amber + "Breakerbook"), nav (Panel · Map · Items · Settings; active link white with 3px amber underline), flexible spacer, search field (340px) that filters **the current view**, theme toggle (sun in dark / moon in light), panel name in mono ("Main panel · 200A").
- The theme toggle and Settings → Appearance write the **same** preference (System / Light / Dark). In the mockups each screen has its own copy; in the app it's one setting.
- Body fills the remaining height; each page scrolls its own regions, never the whole window.

---

## 4. Components

Names match the class names in the mockups.

**Breaker (`.bk`)**: a `<button>`. Full column width, 30px (1-pole) or 62px (2-pole). Contents, outside→in: slot number (mono 11px, 34px wide), label (condensed, ellipsis), optional protection tag, amps (mono 12/600), handle graphic. Right column mirrors (row-reverse, label right-aligned).
States: default (face `--raised`, 1px `--breaker-bd`); hover (border `--ink`); **selected** (amber face, `--on-amber` text, 2px ring; ring is `--ink` in light, `--amber` in dark); **dimmed** by search (opacity .3); **unlabeled** (label reads "Unlabeled", italic, `--warn`); **open slot** (non-interactive, dashed border, italic "Open").
Handle: dark block (`--handle`) with one toggle nub; 2-pole has two nubs joined by a tie bar.

**Leg strip**: 28px column between breaker columns (`--bus`), one mono 9px label per row: L1, L2, L1, … Rows alternate legs; a 2-pole breaker spans both. Hidden when Settings → "Show leg markers" is off.

**Main breaker**: centered block above the columns: double handle + "MAIN" overline + amps.

**Slot chip (`.bnum` / `.cn`)**: mono 12/600 on `--handle`, light text, min 40–48px wide, 26–32px tall. The universal "this is breaker N" token. 2-pole reads "1/3". Unknown breaker: "?" on `--warn`.

**Protection tag (`.tag`)**: GF / AF / DF, 10px/700 on `--tag-bg`. Standard breakers have no tag.

**Buttons**: `.btn` (surface, 1px `--btn-bd`), `.btn-pri` (`--pri`), `.btn-warn` (warn text + border), `.ibtn` (44px square icon button, requires `aria-label`). Links styled as buttons are `<a class="btn">`.

**Segmented control (`.seg` / `.sb`)**: pill track `--line`, active segment `--surface` + subtle shadow. Used for floors, tools, item-type filters. Optional mono count or amber count dot inside a segment.

**Chip toggle (`.chip`)**: 38px bordered button; `is-on` = amber fill. Used for "Needs attention" and label suggestions.

**Switch (`.sw`)**: 48×28 track, `role="switch"` + `aria-checked` on a `<button>`; on = amber track.

**Field (`.fld`)**: label (12px/600 `--muted`) above input/select (44px, `--field` border, amber focus outline).

**Item row**: icon tile (30–34px, `--bg` fill) + name (14/600) + secondary line (12px `--muted`) + optional trailing action. Variants: `.irow` (static, Panel), `.srow` (button, Map inspector), `.irow2` (compact 40px, room cards), `.mrow` (phone, toggles, amber when on, trailing check circle).

**Circuit row (`.circ`)**: Map left list. Slot chip + label + "20A · 9 items" + tag. Selected = amber row.

**Room shape (`.room`)**: absolutely positioned `<button>` on the map. 2px `--wall` border, translucent `--room` fill, room name top-left. States: lit (contains items on the selected circuit: amber tint + `--room-lit-bd` border), selected (inset 3px `--ink` ring, solid `--surface`), muted (other rooms while one is selected: opacity .5).

**Map item marker (`.it`)**: 32px circle button, `--surface` fill, 1.5px `--ink` border, type icon. States: lit (amber fill, pulses twice on light-up, never infinite), dimmed (opacity .28), picked (double ring). **Breaker badge (`.bdg`)**: mono 10px slot number pinned top-right, shown on items of a selected room; "?" in `--warn` when unassigned.

**Circuit card (room inspector)**: bordered card; header button (slot chip, label, spec, count) that selects the circuit; hover/focus fills amber and lights that circuit on the map; compact item rows; footer line "→ Also feeds N items in X, Y" when the circuit leaves the room. "No breaker" card uses a `?` chip and warn title.

**Banners**:
- *Tester reminder*: surface card, amber lightning icon, "**Test before you touch.** Labels can be wrong — confirm with a non-contact tester every time." Always present on shutoff/trace flows.
- *Warning*: 1.5px `--warn` outline, warn title (e.g. "2 items could still be live").
- *Amber callout*: `--amber-soft` + amber border (Fed by, Heads up, Not on a breaker yet, Flip it back on).

**Bottom sheet (phone)**: scrim `--scrim` (not clickable; provide Cancel), sheet with 18px top radius, grabber, `role="dialog"` + `aria-modal`.

**Progress bar**: 6px track `--line`, amber fill.

**Toast**: inverted bar with check icon, `role="status"`.

---

## 5. Screens

Mockup file in brackets. All desktop screens are 1440×960.

### 5.1 Panel [`Panel.dc.html`]
Two regions, 32px gap, 28/32px padding.

**Left (640px), the panel.** Title "Main panel", mono meta "200A main · 29 of 40 spaces used", legend (GF/AF/DF), "Trace" button (→ trace flow). Optional search-results bar ("3 of 25 breakers match “bath”" + Clear). Enclosure card (`--enclosure`, 12px radius, 18px padding) → main breaker → two breaker columns with the leg strip between.

**Right (fills), breaker detail.**
- Header: overline `SLOT 16 · LEG L2` (2-pole: `SLOTS 1 + 3 · LEGS L1 + L2`), prev/next icon buttons (wrap around).
- Label: large inline-editable input (32px/800). Empty shows italic warn placeholder "Unlabeled — what does it power?".
- 4-up grid: Amperage (select 15/20/30/40/50), Protection (Standard/GFCI/AFCI/Dual function), Poles (read-only "1-pole · 120V" / "2-pole · 240V"), Min. wire (copper, read-only, from amps: 15→14 AWG, 20→12, 30→10, 40→8, 50→6; a guide, not a code check).
- "Powers" + summary ("9 items · Main floor, Upstairs") + "Add item". Items grouped Outlets / Lights / Switches / Appliances, two-column grid, each row with "Locate" (→ Map with that item selected).
- Empty state: dashed box, "Nothing mapped to this breaker yet", "Flip it off, walk the house, and add whatever went dark…", primary "Add the first item" (and in the app, a secondary "Trace it").
- Notes textarea.
- Footer: status dot + "All changes saved" / "Unsaved changes" (`--dirty`), "Show on map", "Save changes".

**Behavior.** Click breaker → select. Edits reflect live on the breaker face. Header search dims non-matching breakers; matches on label, slot number, or any item name/room on that breaker.

### 5.2 Map [`Map.dc.html`]
Three columns: circuits list (300) · canvas (fills) · inspector (320).

**Circuits list**: "Circuits" + "25 of 25", hint line, circuit rows. Header search filters by label, slot, item name/room. Clicking the selected circuit deselects.

**Toolbar (60px)**: floor segmented control (amber dot on floors that contain items of the current selection) · tools segmented (Select / Draw room / Place item) · "Floor plan" toggle button.

**Canvas**: 20px grid (`--grid-bg`/`--grid-line`), optional floor-plan image under the rooms (opacity 0–100, default 35%), rooms, item markers. Overlays:
- top-right stack: tool banner ("Drag on the grid to draw a room…" + Done; or "Place an item…" + type chips) and/or floor-plan popover (file name, "Rooms traced over it: 7", opacity slider, Replace, Remove; or a dropzone "Drop a PNG, JPG or PDF of the Upstairs plan…").
- bottom-left inverted status chip: "Breaker 16 · Bathrooms — 3 of 9 on this floor [6 on Upstairs →] [Clear]" or "Kitchen · Main floor — 13 items on 7 circuits [Clear]"; when nothing is selected a quiet hint chip.
- bottom-right zoom control (−, 100%, +, fit).
- Draw-room tool shows a dashed ghost rectangle while dragging; Place tool shows a dashed ghost marker + "Click to place".

**Selection model (one at a time, priority item > circuit > room):**

| Action | Result |
|---|---|
| Click circuit in list | circuit mode: its items lit, rooms containing them tinted, everything else dimmed |
| Click item marker | item mode: item picked, its circuit lit |
| Click empty area of a room (Select tool only) | room mode: room outlined, its items full-strength with breaker badges, other rooms muted, other items dimmed |
| Hover/focus a circuit card in room mode | that circuit's items light up **everywhere on the floor**, not only in the room |
| Change floor tab | clears room selection; circuit/item selection persists (with cross-floor indicators) |
| Clear | back to none |

**Inspector per mode:**
- *None*: "Nothing selected" + one-line hint.
- *Circuit*: overline "Breaker 16", label, "20A · GFCI · 9 items", "On Main floor · 3" rows, "Elsewhere" buttons per other floor, "Edit in panel".
- *Item*: type overline, name, **room link** ("Half bath · Main floor", switches to room mode), amber "Fed by" callout (slot chip, label, spec, "Move to another breaker" select, "Open in panel →"), "Also on this circuit · N" rows (clicking switches floor if needed), "Move on map", "Remove" (warn).
- *Room*: overline "Room · Main floor", name, "13 items on 7 circuits", **primary amber "Shut off this room · 7 breakers"** (→ shutoff flow), "Edit shape" / "Rename", then "Circuits in this room · N" as circuit cards in slot order, "No breaker" card last.
- Footer legend of the four item types.

### 5.3 Items [`Items.dc.html`]
Inventory table with an item editor drawer.

- Header: "Items", mono "79 items · 3 need attention", "Export CSV", primary "Add item".
- Filters: type segmented with live counts · floor select · breaker select (All / No breaker / each) · "Needs attention · N" chip (item has no breaker **or** isn't placed on the map) · "Clear filters" when any filter is active. Header search matches name, room, floor, breaker label/number, "no breaker".
- Table (grid rows, 50px): checkbox · type icon · Name (button, opens drawer) · Room · Floor · Breaker (slot chip + label + tag, or warn "No breaker") · On map ("Locate" link, or warn "Not placed"). Sortable headers: Name, Room (floor then room), Floor, Breaker (unassigned last); arrow shows direction.
- Selection: row checkboxes + select-all; **inverted bulk bar** at the table bottom: "3 selected · Move to breaker [select] · Clear selection".
- Empty: "No items match these filters" + Clear filters.
- **Drawer (380px)**: overline "Outlet · Upstairs", title; amber callout "Not on a breaker yet — Flip breakers off one at a time…" when unassigned; fields Name, Type, Floor, Room (options = that floor's rooms), Breaker ("— No breaker —" + all); map-position card ("Placed on Main floor" + Locate / "Not on the map yet" + "Place on map"); Notes; footer Delete (warn) · Close · Save. Changing floor clears the map position. "Add item" creates a blank item and opens it.

### 5.4 Settings [`Settings.dc.html`]
Left section nav (260px, anchor links, active = surface pill) + "Changes save automatically" footnote. Content column max 860px; each section = h2 + card of rows (label + description left, control right).

- **General**: Home name; Open to (Panel / Map / Items).
- **Appearance**: theme cards System / Light / Dark with mini previews (System is split half light/half dark), radio indicator, amber ring when chosen; switches "Show leg markers on the panel", "Fade other items on the map".
- **Panels**: "Add subpanel"; Main panel card with MAIN tag: Main breaker (100–400A), Spaces (20/24/30/40/42), Slot numbering ("Odd left, even right" / "Down the left, then the right"), Location. Warning callout if spaces < spaces in use.
- **Floors**: listed top-to-bottom as the house stacks (this order drives the Map floor tabs, bottom-up left-to-right); per floor: move up/down buttons, name, room and item counts ("7 rooms · 42 items"), plan file name or "No floor plan image", Upload/Replace, delete. "Add floor".
- **Data & backups**: Export JSON / CSV; Import JSON (replaces all; say so); Automatic backups switch (nightly, to the data volume's `backups/` folder); Keep backups for (7/14/30/90 days; disabled when backups off); Erase all data (warn).
- **Access**: Require sign-in; Read-only guest view (for a tablet by the panel; disabled when sign-in is off); Users list + Add user + Change password.

### 5.5 Shut off a room, phone [`Shutoff.dc.html`]
Reached from the room inspector. Designed for standing at the panel.
- Header: back, "Shut off Kitchen", "Main floor · 7 breakers · Main panel".
- Tester reminder banner (always).
- Warning if any item in the room has no breaker: "N items could still be live — {names} — no breaker on record. Treat as live until you trace it. Trace it now →".
- "Turn these off", in panel order: big rows (68px) with slot chip, label, **physical position** ("Left, row 5"; 2-pole "Left, row 1–2"), "3 items here", and an ON/OFF pill. Tapping toggles; done rows turn amber-soft.
- "Heads up": items flagged critical that lose power, with their note (e.g. Refrigerator: "Food stays safe about 4 hours if the door stays shut.").
- "Also goes dark elsewhere": affected items outside the room, grouped by room (floor suffix if different floor).
- Sticky footer: "3 of 7 off" + progress. When all off: "All 7 off — now test" + primary "Done working — restore power", which flips the list into **restore mode** ("Turn these back on", pills read OFF→ON). When all back on: "Power restored — back to map".
- The same screen should accept a circuit or a single item as the target (title "Shut off {item}").

### 5.6 Trace a breaker, phone [`TracePick` / `TraceMark` / `TraceName`]
How users map their house. Three steps, one flow:
1. **Pick & flip**: "Trace circuits" + "Flip one breaker, tap what goes dark." + progress "14 of 25 breakers checked". Lists "Not checked yet" (unlabeled first) and "Checked". Tap → bottom sheet: **mini panel diagram** (2 × 20 cells, target highlighted amber), "Step 1 of 3", "Flip breaker 29 off", physical position, warning to save work on anything plugged in, primary "It’s off — start marking", Cancel.
2. **Mark what died**: "Breaker 29 is off", instruction line, floor tabs with amber count badges, items grouped by room as toggle rows. Row secondary text states consequence: "Already on 29" / "No breaker yet" / "On 26 · Basement outlets"; when marked: "New — will be added to 29" or **"Moves from 26 · Basement outlets"** in warn. Items already on this breaker start marked (so un-marking removes them). "Add something not listed" (dashed). Footer "2 items marked" + "Review" ("Nothing lost power" when zero).
3. **Name & save**: amber callout "Flip 29 back on" with a switch (turns neutral "29 is back on" when done); label input with suggestion chips derived from marked items (dominant room, "{room} outlets" if single type, floor name; "Spare" if nothing marked); "Feeds N items" list with tags New / Same / From 26; note "1 item will move off 26. Worth re-tracing that breaker next." Primary "Save & trace the next one" (returns to step 1 with toast "Breaker 29 saved as “Storage”"), secondary "Save and finish".
Saving sets the breaker's label, reassigns marked items, unassigns un-marked items that were on it, and stamps **last checked**.

### 5.7 First-run setup [`SetupPanel.dc.html`, `SetupStart.dc.html`]
Shown when the database is empty. Minimal header (wordmark + "Setup", no nav). Left step rail (320px, `--raised`): numbered steps with title + one-line description; current = amber number on a surface pill; done = dark check (clickable to go back); upcoming = muted. Rail footnote: "Everything is stored on this server. Nothing is sent anywhere." Content column with a sticky footer: Back · "Step N of 4" · primary Continue.

1. **You & your home**: "Welcome to Breakerbook"; Home name; owner account (username, password, confirm) with note that sign-in can be turned off later.
2. **Your panel**: Panel name; Main breaker (100–400A, hint "Printed on the big breaker at the top."); Spaces (12–42, hint "Count both sides, including empty slots and knockouts."); numbering as two radio cards ("Odd left, even right": most US panels; "Down the left, then the right" with a live example of the numbers). **Live preview** on the right (300px): mini enclosure with MAIN and every slot numbered per the chosen scheme; updates as the fields change.
3. **Floors**: listed top to bottom; each row: up/down, name input, "Plan image" (optional), remove (disabled for the last floor). Quick-add chips (Basement adds to the bottom; Upstairs/Attic to the top; Detached garage to the bottom) + "Other…". Hint: a detached garage or shed can be its own floor.
4. **Fill it in**: three radio cards: **Copy the panel directory** (FASTEST tag) → §5.8; **Trace it with your phone** (expands to show a QR code + `[server address]/trace`, same network) → §5.6; **Restore a backup** (JSON, replaces what was just set up). Primary button label follows the choice ("Open the directory" / "I’m on my phone — start" / "Choose backup file…"). Link "Skip — take me to the empty panel" → §5.9.

### 5.8 Copy the panel directory [`Directory.dc.html`]
Bulk entry of the paper label inside the panel door. App header (Panel active).
- Left: title, meta "Main panel · 200A · 40 spaces", instruction line; a card with two columns (odd slots left, even right, same order as the panel), each row: slot number · label input · amps select (— / 15…60) · 2-pole checkbox. Filled inputs switch to the quieter filled style. Ticking 2-pole on slot *s* replaces row *s+2* with a dashed "↳ second pole of *s*" row; 2-pole is disabled when *s+2* doesn't exist. Tab order runs down each column.
- Right (340px): progress ("11 breakers entered", bar, "19 of 40 spaces used · 21 left"), tips (Tab, 2-pole, Blank, GFCI set later), "Paste a list instead…" (one label per line, slot order), primary "Save N breakers" → Panel, Cancel.
- Blank rows create nothing. Protection defaults to Standard.

### 5.9 Empty states [`PanelEmpty.dc.html`, `MapEmpty.dc.html`, `ItemsEmpty.dc.html`]
- **Panel, no breakers**: every slot is an **open-slot button** (dashed; hover/focus reads "+ Add breaker"). Detail pane shows "Your panel is empty", one line of guidance, and three action cards: Copy the panel directory (FASTEST) → §5.8, Trace with your phone → §5.6, Add one at a time ("Click any open slot", dashed, informational). Clicking an open slot turns it amber ("New breaker…") and the pane becomes a **new-breaker form**: overline "New breaker · Slot 7 · Leg L2", label input, Amperage, Protection, Poles segmented (2-pole disabled with a reason when the slot below is taken or doesn't exist), "Add breaker", "Add & next slot" (jumps to the next free slot, keeps the amps), footer link to the directory. The open-slot button and form also apply on the normal Panel page whenever an open slot is clicked.
- **Map, floor with no rooms**: circuits list still shows breakers ("20A · 0 items", hint "Nothing placed yet…"). Canvas shows a centered card "Map the {floor}" with two big options: **Upload a floor plan** (dashed dropzone, PNG/JPG/PDF) and **Draw rooms** (switches to the draw tool: banner "Drag on the grid to draw your first room" + ghost rectangle). Inspector shows a 3-step checklist (Add rooms · Place items · Connect them to breakers) and "Trace with your phone instead".
- **Items, none yet**: no filters or table header. Centered: the four type icons as tiles, "No items yet", explanation that tracing is the quickest way, buttons Trace a breaker (primary) · Add item · Import CSV…, mono hint "CSV columns: name, type, floor, room, breaker". Export CSV disabled.
- Existing smaller empty states (breaker with no items, search with no results, floor with no plan image, "Nothing on this floor") are described with their screens above.

---

## 6. Rules the UI depends on

- **Slot numbering** (default "odd left, even right"): slot *s* is in the left column if odd; row = ceil(s/2); leg = L1 on odd rows, L2 on even rows. A 2-pole breaker at slot *s* occupies *s* and *s+2* (same column, two rows, both legs). Alternate numbering "down the left, then the right" must be supported by the same rendering code.
- **Physical position text**: "{Left|Right}, row {n}" (2-pole "row n–n+1"). Used in shutoff and trace.
- **Critical items** (fridge, freezer, sump pump, furnace, network/server gear, medical): a per-item flag with an optional note. Surfaced wherever an action cuts their power.
- **Needs attention** = no breaker OR not placed on map.
- **Selection priority on the Map**: item > circuit > room (see table above).
- Deletions and imports that replace data require a confirm; nothing else does.

---

## 7. Accessibility

- Real elements only (see Principles). Icon-only buttons have `aria-label`. Toggles use `aria-pressed`; switches `role="switch"` + `aria-checked`.
- Visible focus: 3px `--focus` outline, 2px offset, on everything.
- Contrast: body text ≥ 4.5:1, large text ≥ 3:1, in both themes. `--muted` is the lightest allowed text color.
- Color is never the only signal: lit items also change fill *and* the list/inspector says what's selected; warn states always have text.
- Animations: only the two-pulse light-up and short transitions (≤ .3s). Respect `prefers-reduced-motion` (disable the pulse).

---

## 8. Not designed yet (decide with the owner before building)

1. **Items on more than one breaker** (switch boxes with two circuits, multi-wire branch circuits). The data model supports it (`DATA-MODEL.md`). UI proposal: "Fed by" shows stacked slot chips ("14 + 21"); room cards list the item under each breaker; shutoff counts it under every breaker it touches.
2. **Exterior areas**: rooms with `kind: exterior`, drawn outside the walls with a dashed outline; selectable like rooms. Detached buildings (shed) are an extra floor tab.
3. **Phone layouts of Panel and Map**: likely a single-column stacked panel. Later.
4. **Subpanels**: the model supports a panel fed by a breaker; UI beyond "Add subpanel" isn't designed.

---

## 9. Don'ts

- Don't restyle or "modernize". No shadcn/Tailwind defaults, no card grids, no gradients, no glassmorphism, no emoji, no Inter/Roboto.
- Don't add colors, fonts or radii outside `tokens.css`.
- Don't use amber for anything that isn't a selection/powered/acting-on state.
- Don't add pages, stats, charts or settings that aren't here without asking.
- Don't put the whole page in one scroll container; regions scroll independently (lists, inspector, table body).
