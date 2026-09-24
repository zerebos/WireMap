# Mockups

Interactive mockups exported from the design canvas. They are **reference, not code to ship**: the markup, inline styles and `<helmet><style>` rules give exact sizes, colors, copy and states, and the `renderVals()` script shows the interaction logic.

They won't open standalone in a browser (they need the canvas runtime). Read them as source.

| File | Screen | Size |
|---|---|---|
| `Panel.dc.html` | Panel + breaker detail (header has Trace and Print buttons) | 1440 × 960 |
| `Map.dc.html` | Floor map, circuits list, inspector | 1440 × 960 |
| `Items.dc.html` | Items table + editor drawer | 1440 × 960 |
| `Settings.dc.html` | Settings | 1440 × 960 |
| `Shutoff.dc.html` | Shut off a room (phone) | 390 × 844 |
| `TracePick.dc.html` | Trace step 1: pick & flip (phone) | 390 × 844 |
| `TraceMark.dc.html` | Trace step 2: mark what died (phone) | 390 × 844 |
| `TraceName.dc.html` | Trace step 3: name & save (phone) | 390 × 844 |
| `SetupPanel.dc.html` | First-run setup, opens on step 2 | 1440 × 960 |
| `SetupStart.dc.html` | First-run setup, opens on step 4 | 1440 × 960 |
| `Directory.dc.html` | Copy the panel directory | 1440 × 960 |
| `PanelEmpty.dc.html` | Panel with no breakers + new-breaker form | 1440 × 960 |
| `MapEmpty.dc.html` | Map floor with no rooms | 1440 × 960 |
| `ItemsEmpty.dc.html` | Items with none yet | 1440 × 960 |
| `MapEditRoom.dc.html` | Map layout editing, Kitchen selected (drag rooms, handles, items; place unplaced items) | 1440 × 960 |
| `MapEditScale.dc.html` | Map layout editing, Set scale tool | 1440 × 960 |
| `MultiBreaker.dc.html` | Pattern sheet: items on more than one breaker | 1440 × 960 |
| `PhonePanel.dc.html` | Phone panel, breaker sheet open | 390 × 844 |
| `PhonePanelGuest.dc.html` | Phone panel, read-only guest view | 390 × 844 |
| `PhoneMap.dc.html` | Phone map | 390 × 844 |
| `SignIn.dc.html` | Sign in | 1440 × 960 |
| `TandemPanel.dc.html` | Panel with tandem slots (17, 19, and 29 outside the rated range), 17B selected | 1440 × 960 |
| `TandemPattern.dc.html` | Pattern sheet: tandems in the form, directory, settings, phone, chips | 1440 × 960 |
| `QuadPanel.dc.html` | Panel with two quads (21/23 two 2-poles; 25/27 mixed) + a tandem; outer pair selected | 1440 × 960 |
| `PrintSetup.dc.html` | Print the directory: options + live preview | 1440 × 960 |
| `PrintSheet.dc.html` | The printed sheet itself (Letter; tweak switches to A4 / door card) | 816 × 1056 |
| `SubMain.dc.html` | Main panel with a subpanel feeder (30/32) selected; panel tabs | 1440 × 960 |
| `SubGarage.dc.html` | Garage subpanel (short code G), G1 selected, power path | 1440 × 960 |
| `SubPattern.dc.html` | Pattern sheet: subpanels in add form, settings, header, fed-by, shutoff, trace | 1440 × 960 |

The three Trace files are the same component, each starting at a different step; same for the two Setup files.

## Reading the format

```html
<x-dc>                       <!-- the component's markup -->
  <helmet><style>…</style></helmet>   <!-- page CSS: classes like .bk, .circ, .room -->
  <div class="{{themeCls}}">…</div>   <!-- {{hole}} = value from renderVals() -->
  <sc-for list="{{rows}}" as="r">…</sc-for>   <!-- {#each rows as r} -->
  <sc-if value="{{cond}}">…</sc-if>           <!-- {#if cond} -->
</x-dc>
<script type="text/x-dc">
class Component extends DCLogic {
  renderVals() { … return { rows, cond, onClick: () => this.setState(…) } }
}
</script>
```

Svelte 5 translation:
- `this.state` / `setState` → `$state`
- values computed in `renderVals()` → `$derived`
- `onClick="{{fn}}"` → `onclick={fn}`
- `class="{{r.cls}}"` strings built in JS → `class={{ 'is-sel': selected }}` etc.
- Theme classes `.th-light` / `.th-dark` → `data-theme` on `<html>` + `tokens.css`.
- The `BREAKERS` / `RAW` / `ROOMS` arrays at the top of each script are the sample house, also in `../seed.json`.

All color variables in the mockups use the same names as `../tokens.css`.
