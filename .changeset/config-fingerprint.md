---
"attunement": minor
---

Config fingerprint: `attune()`/`attuneReact()` handles expose `fingerprint()`
resolving to `{ hash, version?, generatedAt? }` — a stable FNV-1a hash of the
validated config (key-order independent) plus `_version`/`_generatedAt` read
off the raw config when the deploy pipeline stamps them. `onLoad` receives the
fingerprint as a second argument for Sentry scope / log prefix wiring.
