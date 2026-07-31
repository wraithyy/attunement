# attunement

## 0.3.0

### Minor Changes

- e98bf43: v0.3 — CI story: `attunement` CLI. `check --schema <module> <files...>` validates config files against the app schema (same did-you-mean errors as runtime), `--diff` fails on top-level key drift between environments, secret hygiene warnings (credential-like names, high-entropy values), `docs` renders a markdown table of keys/types/defaults from a zod schema. New `attunement/cli` entry + `attunement` bin.

## 0.2.0

### Minor Changes

- c34c9bd: v0.2 — adoption blockers:

  - `attunement/testing`: `createTestProvider(config, overrides)` — synchronous Provider for tests, overrides validated against the schema and merged over its defaults
  - `fromJson` resilience: per-attempt timeout (default 8 s) and retry with exponential backoff on network errors, timeouts and 5xx (default 2 retries); 4xx fails fast
  - Validation errors now suggest the nearest key from the raw config ("did you mean") on missing top-level keys
  - Loaded config is deep-frozen

- 6477d0e: `merge(...sources)`: combine sources instead of falling through — parallel run, shallow merge in call order (later wins), nullish parts skipped. Recipes for base+overrides, separate schemas, dependent configs and module-federation caveats.
