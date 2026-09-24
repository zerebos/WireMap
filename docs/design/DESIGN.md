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
States: default (face `--raised`, 1px `--breaker-bd`); hover (border `--ink`); **selected** (amber face, `--on-amber` text, 2px ring; ring is `--ink` in light, `--amber` in dark); **dimmed** by search (opacity .3); **unlabeled** (label reads "Unlabeled", italic, `--warn`); **open slot** (a `<button>`: dashed border, italic "Open"; hover/focus shows "+ Add breaker"; selected = amber "New breaker…"; see §5.1.1).
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

#### 5.1.1 Adding, moving and removing breakers
Mockup: `PanelEmpty.dc.html` (same panel and new-breaker form; reuse them on the normal Panel page).
- **Add**: click an open slot → the detail pane becomes the new-breaker form (§5.9): overline "New breaker · Slot 7 · Leg L2", label, Amperage, Protection, Poles (1/2; 2-pole disabled with a reason when slot+2 is taken or off the panel), "Add breaker", "Add & next slot". Escape or the close button cancels. After adding, the new breaker is selected and shown in the normal detail pane.
- **Move**: a "Move…" button in the detail header (next to prev/next) enters move mode: the selected breaker gets a dashed amber outline, every slot it fits in (both slots free for a 2-pole) shows "Move here", slots it can't use are dimmed, and a bar above the panel reads "Moving breaker 16 · click an open slot · Esc to cancel". Its items move with it.
- **Change poles**: the Poles field in the detail pane is editable (1-pole / 2-pole segmented). 2-pole needs slot+2 free; otherwise it's disabled with the reason.
- **Remove**: "Remove breaker" as a warn text button at the left of the detail footer. Confirm dialog: "Remove breaker 16 “Bathrooms”? Its 9 items will be left with no breaker." Cancel / Remove (warn). Items are kept and show under Needs attention.

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

### 5.10 Editing the map layout [`MapEditRoom.dc.html`, `MapEditScale.dc.html`]
Viewing and editing are separate modes so a stray drag never moves a wall. The Map toolbar gets an **"Edit layout"** button; edit mode replaces the circuits list and inspector and hides all circuit highlighting.

- **Toolbar**: amber pill "Editing Main floor" · tools segmented: Select · Room (rectangle) · Polygon · Scale · "Floor plan" toggle · Undo (icon) · primary "Done editing" (back to view mode).
- **Left panel "Layout"**: *Rooms* list (click selects; shows size once a scale is set) and *Not placed*: items on this floor with no position (from tracing, Items page, or "Remove from map"), each with a **Place** button. Place → ghost marker follows the pointer, banner "Click where it really is. Esc cancels.", click drops it snapped to the grid.
- **Rooms**: click to select (amber outline + 8 square handles: corners and edge midpoints); drag the body to move, drag a handle to resize (min 60 map units). Exterior areas draw with a dashed wall. Selected room shows amber size labels on the top and right edges when a scale is set; a live "17′ × 15′" tooltip follows the pointer while dragging.
- **Snapping**: to a 10-unit grid by default; room edges snap to other rooms' edges within 8 units and show an amber dashed guide line across the canvas. Holding **Shift** disables snapping.
- **Moving a room carries its items** (checkbox in the inspector, on by default).
- **Draw room (rectangle)**: drag on empty canvas; dashed amber draft rectangle with the same snapping; on release it becomes "New room", selected, name field focused. **Polygon**: click to add corners, click the first corner to close; rectangles can be converted to polygons ("Convert to polygon (add corners)"), after which each corner is a handle and double-clicking an edge adds a corner.
- **Items**: drag to reposition (grid snap, Shift = free). While dragging into a different room a dark tooltip "→ Dining room" follows. The item's room is **derived from its position**; its breakers never change from a move. Inspector shows "Room (from where it sits)" + "Was Half bath" when changed, and "Remove from map" (returns it to Not placed).
- **Keyboard**: rooms and items are focusable buttons; arrow keys nudge one grid step (Shift = 1 unit), Esc deselects. Clicking empty canvas deselects.
- **Room inspector**: name, Kind (Interior / Exterior area), Size (read-only, feet), Shape, "Set a scale to see sizes in feet" (when no scale), Convert to polygon, "Move the N items inside with the room", Delete room (warn; items stay and become "Not in a room").
- **Floor plan**: the "Floor plan" toggle selects the image: dashed amber frame you drag to line it up (rooms don't move), inspector with Opacity, Size (50–150%), Rotate ±90°, "Lock the plan", Replace, Remove. While selected its opacity is raised to at least 55% so it's easy to align.
- **Set scale** (`MapEditScale`): an amber measuring line with two draggable round endpoints; inspector "Measure one wall": Feet + Inches, live readout "1 ft = 20.0 px" and a sanity check ("Kitchen would be 17′ × 15′"), "Apply scale". Once set, sizes show everywhere (room list, labels, inspector). Stored per floor.
- **Undo** covers every layout change in the session (moves, resizes, placements, deletes).

### 5.11 Items on more than one breaker [`MultiBreaker.dc.html`]
A pattern sheet, not a screen. Rule: wherever one breaker is shown, show all of them joined with "+"; anything that turns power off counts the item under **every** breaker it's on.
- **Map item inspector**: "Fed by N breakers": one row per breaker (amber slot chip, label, spec, remove ×; remove hidden when only one is left), "Add another breaker" select. With 2+: "**Turn off both 14 and 21** before opening this box." plus a checkbox "These share a neutral (multi-wire circuit). They should be handle-tied." When checked, the Panel draws those breakers with a tie bar and warns if one is moved away from the other.
- **Items table**: chips "14 + 21" and "2 breakers" instead of the label. Sort by lowest slot; breaker filter matches any.
- **Room circuit cards / Panel "Powers" lists**: the item appears under each breaker with a small "+21" tag naming the others. Room totals count it once; per-circuit counts count it on each.
- **Shutoff**: a shared item pulls every breaker it's on into the list; row meta explains ("3 items here · 1 shared with 21"). A handle-tied pair is one row: "14 + 16 · turn off together".
- **Trace**: marking an item that's on a different breaker offers a segmented choice: **Move to 21** (default) / **On both 14 + 21**. Summary tags it "+14".

### 5.12 Phone views [`PhonePanel.dc.html`, `PhoneMap.dc.html`]
Below ~700px wide the desktop layouts are replaced, not squeezed.
- **Shell**: 56px dark header (breaker glyph, page title, mono subtitle, Settings gear) and a 64px **bottom tab bar**: Panel · Map · Items · Trace (active tab: ink label, amber icon). No top nav.
- **Panel**: search field under the header, then the enclosure at full width. Keep the physical two-column layout (odd left, even right) with a 16px leg strip; each breaker is a 46px cell (2-pole 94px): mono "16 · 20A" + tag on the first line, label in condensed 13px, up to two lines. A 5px dark handle strip sits on the inner edge. Open slots are dashed. Search dims non-matches like desktop.
- **Breaker sheet**: tapping a breaker opens a bottom sheet (scrim, grabber, max 78% height): amber slot chip, "Right, row 8 · Leg L2", label as title, spec line; three actions in a row: Show on map · Shut off · Edit; then "Powers · N" list (icon, name, room · floor). Close button top-right.
- **Map**: floor segmented control (amber dot on floors with items of the selected circuit) and a **native `<select>` circuit picker** above a fixed-height (360px) map scaled to fit the width; item markers stay 24px regardless of scale; pinch to zoom. Below the map an inline panel (not a sheet) shows the selection: circuit (chip, label, "3 of 9 items on this floor", "6 more on Upstairs →", amber "Shut off breaker 16", item rows), room (tap a room: "Room · Main floor", counts, "Shut off this room · N breakers", items sorted by breaker with slot chips), or item (Fed by + its circuit). Empty: one-line hint.
- Editing layouts (§5.10) is desktop-only; the phone Map is for finding things.

### 5.13 Read-only guest view [`PhonePanelGuest.dc.html`]
When Settings → Access → "Read-only guest view" is on, anyone on the network can open the app without signing in (e.g. a tablet mounted by the panel). Same screens and layouts, with:
- header shows an amber outlined **READ-ONLY** tag and a "Sign in" button instead of Settings;
- every edit control is removed (not disabled): no Edit, Add, Move, Remove, label inputs, Trace tab, Edit layout, Settings;
- Shut off and Show on map stay (they don't change data; shutoff progress is kept locally on the device).
Desktop guest view follows the same rules on the desktop layouts.

### 5.14 Sign in [`SignIn.dc.html`]
Split screen: left, a 400px column (wordmark, "Sign in", home name, Username, Password, "Stay signed in on this device" checked by default, primary Sign in); right, a 520px enclosure-colored panel with an abstract mini panel graphic (one amber breaker). Error: warn-outlined alert above the fields "That username and password don’t match." (`role="alert"`), cleared on typing. When guest view is on, a divider and "View the panel without signing in" + "Read-only guest view is on for this home." Footer: "Forgot your password? Reset it from the server’s command line — see the docs." (provide that CLI command). On phones the right panel is dropped.

### 5.15 Tandem breakers [`TandemPanel.dc.html`, `TandemPattern.dc.html`]
Two half-width breakers in one space. Each half is a full breaker record (own label, amps, protection, items) with `half: 'A' | 'B'`. Both halves are on the slot's leg.
- **Naming**: the half letter is part of the number everywhere — "17A", "17B" (A = upper, B = lower). Position text: "Left, row 9 · lower half". Sort 17A, 17B, 18.
- **Panel cell**: the slot keeps its column position; the cell is 46px tall (the whole panel row grows to match, so the leg strip stays aligned) and holds two stacked 20px half-buttons: mono "17A", condensed label, amps, small handle. Each half selects independently (same selected style as a breaker). The panel grid is row-based (CSS grid, 3 columns: left · leg strip · right; 2-pole spans two rows).
- **Detail pane**: overline "Slot 17 · Tandem half B · Leg L1"; Size segmented control: 1-pole · 2-pole · **Tandem A+B**. Choosing Tandem on a 1-pole breaker makes it half A and adds an empty, unlabeled half B (selected). Back to 1-pole is only possible when the other half is gone (reason shown). A neutral card "Shares slot 17 with 17A · Primary bedroom · both halves are on leg L1" + "Select 17A".
- **Tandem-rated slots**: Settings → Panels gets "Tandem slots" (free text range like "17–28", blank = unknown). Header legend shows it. A tandem outside the range gets a dashed warn outline on the Panel and a warn note in the detail ("Slot 29 isn’t rated for tandems… worth checking with an electrician"). It's a warning, not a block. The new-breaker form disables "Tandem A+B" outside the range with that reason.
- **New-breaker form**: Size segmented (1-pole / 2-pole / Tandem A+B); tandem shows two rows (17A, 17B) each with label + amps.
- **Copy the directory**: a "Tandem" checkbox column next to 2-pole; ticking it splits the row into 17A / 17B rows in place.
- **Phone cell**: same 46px height, split into two 20px halves with one line of label each.
- **Counts**: header reads "29 of 40 spaces · 31 breakers" (spaces and breakers differ once tandems exist).
- Quad breakers: see §5.18.

### 5.16 Desktop versions of guest, shutoff and trace
No separate designs needed:
- **Guest view on desktop**: the desktop screens with the §5.13 rules (READ-ONLY tag + Sign in in the header, edit controls removed).
- **Shut off on desktop**: the same component as §5.5 in a 420px right-hand drawer over the Map (from the room inspector's button) or the Panel (from a breaker). Footer and banners unchanged.
- **Trace on desktop**: tracing needs you walking the house, so desktop "Trace" shows a card: QR code + `[server]/trace`, "Open this on your phone", plus the step-1 breaker list (checked / not checked) read-only so progress is visible. Picking a breaker there is allowed and hands off to the phone.

### 5.17 Subpanels [`SubMain.dc.html`, `SubGarage.dc.html`, `SubPattern.dc.html`]
A second panel fed from a breaker in the main panel (e.g. a 60A 2-pole feeding a detached garage).
- **Short code**: each subpanel has a 1–3 letter code that prefixes its breaker numbers everywhere: "G1", "G3/5". The main panel has no prefix.
- **Panel page**: a row of panel tabs above the enclosure (name + "60A · 7/12 spaces"; subpanels show a small branch icon) plus a dashed "+ Subpanel" button. Subpanel pages show "MAIN LUGS" instead of MAIN, meta "Fed by Main 30/32 · 60A · 7 of 12 spaces · {location}", and a "↑ Fed by Main · 30/32" button that jumps to the feeder.
- **Feeder breaker**: label is "→ {subpanel name}", 1.5px `--tag-fg` border and a "SUB" tag. Its detail pane replaces "Powers" with a card "Feeds the Garage subpanel" (Open Garage →, "60A 2-pole feeder · 6 breakers · 9 items", grid of its breakers with item counts) and an amber note "Turning this off kills the whole Garage subpanel — 6 breakers and 9 items, including {critical items}."
- **Power path**: every breaker detail shows a path row: chips "Main 200A › 30/32 · 60A › Garage › G6" (current one amber). Subpanel breakers add "This breaker is also dead whenever Main 30/32 is off."
- **Header**: the panel name at the right of the header becomes a menu listing panels as a tree when there's more than one.
- **Add subpanel**: Name, Short code, Fed by (2-pole breakers in any panel, or "New breaker in an open slot…"), Spaces, main amps (optional; usually main lugs), Location. The feeder's label is set to the subpanel name.
- **Settings → Panels**: panels listed as a tree (subpanels indented with the branch icon). Deleting a subpanel confirms; its breakers are removed and their items become "No breaker".
- **Everywhere else**: chips use the prefixed number; circuit lists and trace lists group by panel; the map inspector "Fed by" adds the power path. **Shutoff** rows name the panel ("Garage panel · Left, row 1"); when every breaker in a shutoff list is in one subpanel, offer the feeder as a dashed one-flip alternative listing what else it cuts. **Trace**: feeders aren't traceable (they show "Flipping this kills the whole Garage panel. Trace its breakers from the Garage panel instead."); the flip sheet's mini diagram shows the right panel.
- Nesting deeper than one level (a subpanel fed from a subpanel) works the same way: the path just gets longer.

### 5.18 Quad breakers [`QuadPanel.dc.html`]
Two 2-pole breakers in one two-space-high body (four half handles), e.g. two 240V circuits in slots 21 and 23. Mixed quads are also common: one 2-pole plus two 1-poles.
- **Numbering**: "21A/23B" (outer pair: top handle of 21 + bottom handle of 23) and "21B/23A" (inner pair: the middle two). A = upper half, B = lower, as with tandems.
- **Panel cell**: spans the two rows. Inside, four 20px half-rows in physical order (21A, 21B, 23A, 23B). The **inner pair** is one button spanning the middle two rows. The **outer pair** shows its label on the top row and a muted "↳ same breaker · 21A/23B" on the bottom row; both rows select the same breaker. **Tie bars** (3px, `--tie`) run over the handles joining each pair: the outer bar spans top to bottom row, the inner bar the middle two, slightly offset so both are visible. The selected breaker's bar turns ink (light) / amber (dark), and every row of it is amber.
- **Detail pane**: overline "Slots 21A + 23B · Legs L1 + L2 · Quad, outer pair"; Size segmented control gains **Quad**. A card shows a mini 4-row diagram of the quad with the current breaker's halves highlighted, "The outer pair of a quad in slots 21–23", "Shares the quad with 21B/23A Heat pump. Both slots are one physical breaker; replacing it affects all of them." and a "Select …" button per mate. Note under it: brands differ on which handles pair up; Edit can swap outer/inner.
- **New-breaker form / directory**: Size gets a 4th option "Quad (2 × 2-pole)"; it asks for the outer and inner pair (label + amps each), or "one 2-pole + two 1-poles". Only offered where s and s+2 are both free and within tandem slots. In Copy the panel directory, a "Quad" tick on slot s turns rows s and s+2 into the four half-rows.
- **Elsewhere**: the display number carries everything ("21A/23B"); shutoff/trace position text: "Left, rows 11–12 · outer pair".

### 5.19 Printable panel directory [`PrintSetup.dc.html`, `PrintSheet.dc.html`]
A fresh label for the inside of the panel door, generated from the data.
- **Entry**: "Print" button next to "Trace" on the Panel page header (and per panel on subpanel tabs).
- **Print page** (desktop): left 380px options column, right a scaled live preview on the page background with a shadow and caption "Letter · 8.5 × 11 in · preview at 76%".
  - Panel (select: every panel, e.g. Main · Garage subpanel)
  - Paper: Letter · A4 · **Door card** (5 × 8 in; fits the clear sleeve many panel doors have)
  - Include: Amps · GFCI/AFCI tags · **Write-in lines** (open and unlabeled slots print as dotted blank lines for handwriting) · QR code to the live map (only useful on the home network) · Printed date · **Large text** (for reading with a flashlight)
  - Footer: primary Print, Download PDF, note "Print at 100% scale (“Actual size”), not “Fit to page”."
- **The sheet** is always light and ink-only regardless of app theme (white stock, near-black ink, ≥1px rules, no fills except a light grey center gutter; must read in grayscale). Layout mirrors the panel: odd slots left, even right, numbers on the outer edges (left column number at left, right column number at right), rows sized to fill the page (`repeat(N, 1fr)`), 2-pole breakers span two rows with a thick 4px ink edge on the outer side. Row: slot number (mono 16px bold), label (15px/600, ellipsis), meta (mono 12px: "20A GF"). Header: "PANEL DIRECTORY" overline, panel name + amps (26px/800), location line, printed date, optional QR box; 2px ink rule under it. Footer: legend ("GF GFCI · AF AFCI · DF Dual function · Thick edge = 2-pole") and **"Test before you touch. Labels can be wrong."** Minimum text 12px (9pt). Door card: 28px margins and smaller type (13/12px); Large text: 19/18/14px. Tandems/quads/subpanels print their display numbers ("17A", "21A/23B", "G6").
- Implement as a print route rendering the sheet at the paper's size with `@page { size: …; margin: 0 }` and the sheet's own padding as the margin; Download PDF uses the same route through a headless browser on the server.

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

Everything in scope is designed. Notes:
1. **Exterior areas**: covered by rooms with `kind: exterior` (§5.10); detached buildings are an extra floor tab.
2. Anything not described in this document: ask before inventing it.

---

## 9. Don'ts

- Don't restyle or "modernize". No shadcn/Tailwind defaults, no card grids, no gradients, no glassmorphism, no emoji, no Inter/Roboto.
- Don't add colors, fonts or radii outside `tokens.css`.
- Don't use amber for anything that isn't a selection/powered/acting-on state.
- Don't add pages, stats, charts or settings that aren't here without asking.
- Don't put the whole page in one scroll container; regions scroll independently (lists, inspector, table body).
