# Screenshots

Put exported PNGs of each mockup here, both themes, named:

```
panel-dark.png        panel-light.png
map-dark.png          map-light.png
map-room-dark.png     (Map with the Kitchen selected, the default state)
items-dark.png        items-light.png
settings-dark.png     settings-light.png
shutoff-dark.png      shutoff-light.png
trace-pick-dark.png   trace-mark-dark.png   trace-name-dark.png
setup-panel-dark.png  setup-start-dark.png  directory-dark.png
panel-empty-dark.png  map-empty-dark.png    items-empty-dark.png
map-edit-dark.png     map-scale-dark.png    multi-breaker-dark.png
phone-panel-dark.png  phone-guest-dark.png  phone-map-dark.png    signin-dark.png
tandem-panel-dark.png tandem-pattern-dark.png quad-panel-dark.png
sub-main-dark.png     sub-garage-dark.png   sub-pattern-dark.png
print-setup-dark.png  print-sheet.png       (the sheet has no theme)
```

These are the visual targets. After building a screen, render it with Playwright at the same size (1440×960 desktop, 390×844 phone) using `seed.json` data, and compare against the matching PNG. Fix differences in layout, spacing, color and type before moving on. Pixel-perfect isn't the goal; matching structure, density and tone is.
