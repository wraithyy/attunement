---
"attunement": minor
---

v0.2 — adoption blockers:

- `attunement/testing`: `createTestProvider(config, overrides)` — synchronous Provider for tests, overrides validated against the schema and merged over its defaults
- `fromJson` resilience: per-attempt timeout (default 8 s) and retry with exponential backoff on network errors, timeouts and 5xx (default 2 retries); 4xx fails fast
- Validation errors now suggest the nearest key from the raw config ("did you mean") on missing top-level keys
- Loaded config is deep-frozen
