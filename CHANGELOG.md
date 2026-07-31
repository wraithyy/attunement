# attunement

## 0.4.1

### Patch Changes

- 9361f18: Make `DevtoolsProps`/`AttunementDevtoolsPanel`/`AttunementDevtools`/`attunementDevtoolsPlugin` generic over the config shape, so a devtools consumer typed with a concrete schema (e.g. `AttunedReact<RuntimeConfig, typeof schema>`) doesn't need a cast to pass its `attuneReact()` instance in.

## 0.4.0

### Minor Changes

- 9d74bec: `attunement/devtools`: dev override panel generated from the schema (enum → select, boolean → checkbox) — standalone floating widget (`AttunementDevtools`) or TanStack Devtools plugin (`attunementDevtoolsPlugin`). `fromOverrides()` source layers localStorage overrides + `?config.KEY=value` URL bootstrap over real config via `merge`, validated by the schema like everything else.
- cfaf690: `attunement/vite`: Vite plugin — dev server serves the config file (full reload on change), optional `injectKey` injects config into index.html for `fromWindow` (real content in dev, deploy-replaceable placeholder in builds).

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
