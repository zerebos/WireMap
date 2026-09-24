# Mockups

Interactive mockups exported from the design canvas. They are **reference, not code to ship**: the markup, inline styles and `<helmet><style>` rules give exact sizes, colors, copy and states, and the `renderVals()` script shows the interaction logic.

They won't open standalone in a browser (they need the canvas runtime). Read them as source.

| File | Screen | Size |
|---|---|---|
| `Panel.dc.html` | Panel + breaker detail | 1440 × 960 |
| `Map.dc.html` | Floor map, circuits list, inspector | 1440 × 960 |
| `Items.dc.html` | Items table + editor drawer | 1440 × 960 |
| `Settings.dc.html` | Settings | 1440 × 960 |
| `Shutoff.dc.html` | Shut off a room (phone) | 390 × 844 |
| `TracePick.dc.html` | Trace step 1: pick & flip (phone) | 390 × 844 |
| `TraceMark.dc.html` | Trace step 2: mark what died (phone) | 390 × 844 |
| `TraceName.dc.html` | Trace step 3: name & save (phone) | 390 × 844 |

The three Trace files are the same component, each starting at a different step.

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
