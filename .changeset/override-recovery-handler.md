---
"attunement": patch
---

Override recovery moved where the knowledge lives (field report #3):

- `fromOverrides(storageKey?)` now registers a recovery handler (internal
  globalThis registry) that knows its own storage key and the `config.*` URL
  bootstrap. "Clear overrides and reload" therefore works with a custom
  `storageKey` and also strips `config.*` query params — a broken shared
  repro link no longer reseeds the override on reload.
- The react entry no longer carries any override knowledge (hardcoded key,
  localStorage parsing, dead-in-production recovery UI paths) — the default
  errorFallback just renders what registered handlers report, which in
  production is nothing because `fromOverrides` doesn't run there.
- New `OverrideRecovery` component in `attunement/devtools`: the same
  recovery block for custom/branded errorFallbacks; renders nothing when no
  overrides are stored.
