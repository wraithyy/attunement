---
"attunement": patch
---

First batch of field-report fixes:

- Schema introspection unwraps `z.preprocess` — zod 3 `ZodEffects`
  (`_def.schema`) and zod 4 pipes (`_def.out`) — so the documented
  all-strings recipe renders checkboxes/selects in the devtools panel
  instead of text inputs.
- `Provider` without `errorFallback` now renders a minimal "Configuration
  failed to load." notice instead of a white page; the error message (config
  keys, source URLs) shows in dev builds only. Pass `errorFallback={null}`
  for the old behavior.
- `AttunementDevtools` accepts `position` ("bottom-right" default,
  "bottom-left", "top-right", "top-left") to dodge TanStack Query devtools
  and friends.
- `attunement check --diff` warns when fewer than two files matched instead
  of silently skipping the diff.
- README: migration-from-hand-rolled-loader section, `onLoad` ordering
  guarantee vs `.then()`, lazy devtools import as the default pattern,
  `injectKey` in the Vite snippet, zod-only introspection caveat moved to
  the Standard Schema bullet.
