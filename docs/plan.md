# Plan

## Goal

One built artifact deployable to any number of environments, with everything
environment-specific changeable at runtime without a rebuild: API base URL, log
level, OAuth client ids, feature flags, business limits. The library owns the
loading, validation and delivery of that config; the schema stays app-owned.

## Where the pattern comes from

Two production apps already hand-roll this. attunement is their common core,
extracted and hardened.

### App A (`frontend/apps/web/src/config/runtime-config.ts`)

- `fetch("/app-config.json")` → Zod `safeParse` → module-level cache.
- Keys: `API_URL`, `ENABLE_MOCKING`, `LOG_LEVEL`, `LOG_CONTEXT`. Defaults via
  `.default()` keep already-deployed config files bootable when keys are added.
- Async bootstrap in `main.tsx`: await config, then `setApiBaseUrl()`, logger
  setup, then render. ConfigProvider + `useConfig()` context.
- Dev override panel for runtime config exists as a devtool
  (`runtime-config-panel`).

What attunement replaces: the loader, the cache, the provider, the async
bootstrap (→ `onLoad` + Suspense). What stays in the app: the schema, the
panel (until `attunement/devtools` exists).

### App B (`src/utils/_env.ts`)

- Same fetch + Zod + cache shape, `.then()` around `root.render`.
- **Coercion everywhere**: config is produced by env-var substitution in CI, so
  every value arrives as a string — `stringOrBoolean` preprocess,
  `z.coerce.number()` for limits (`MAX_UPLOAD_PHOTOS`,
  `MAX_IMAGE_SIZE`...). Any library serving this app must not assume typed
  JSON.
- Larger surface: OAuth/analytics keys (`GOOGLE_GA_KEY`, `GOOGLE_RECAPTCHA_KEY`,
  `THIRD_PARTY_API_KEY`), `BASE_PATH`, feature toggles.
- **Second runtime file**: `shutdown.json` polled as a kill switch → the
  library must support multiple independent `attune()` instances per app.
- Per-environment config files committed in repo (`config/app-config.json`,
  `config/app-config.demo.json`) → validates the config-as-code + CI check
  roadmap item.

## Design pillars

1. **Framework-agnostic core, adapters as entries.** Core exposes
   `attune() → { load() }` — a promise and a cache, no UI concepts. Adapters
   (`/react` now; `/vue`, `/svelte`, `/solid` when demanded) wrap it in the
   framework's own suspense/context idiom. Nothing in core may block a future
   adapter: no JSX, no hooks, no framework types.
2. **Tree-shaking.** `sideEffects: false`, ESM only, named exports, one entry
   per concern. An app importing `attunement` ships the loader (~1 KB), nothing
   else. CLI/devtools never leak into app bundles.
3. **Standard Schema.** Zod/Valibot/ArkType all work; the schema is the single
   source of truth for types, validation, defaults — and later docs generation
   and the devtools panel UI.
4. **Race-free by construction.** Eager load at module scope + Suspense gate:
   config is synchronously available under the Provider, `onLoad` runs before
   first render (API base URL, logger), invalid config hits an error boundary
   instead of a white page.

## Roadmap

### v0.1 — core (done)

- [x] `attune()`: source chain, Standard Schema validation, cache, `onLoad`
- [x] Sources: `fromJson`, `fromWindow`
- [x] `attuneReact()`: Suspense Provider, error boundary, typed `use()`
- [x] tsup build, ESM + d.ts, two entries

### v0.2 — adoption blockers (what App A/App B need to migrate)

- [x] Test helpers: `createTestProvider(overrides)` — partial override over
      schema defaults, synchronous, no Suspense in tests
- [x] Fetch resilience: timeout + retry with backoff on `fromJson`
- [x] Pretty validation errors: key, expected, received, did-you-mean over
      schema keys (levenshtein)
- [x] Coercion story documented (App B case): recipe with `z.coerce` /
      preprocess, or a `coerceStrings` helper if the recipe isn't enough
- [x] Deep freeze of the parsed config

### v0.3 — CI story (the enterprise sell)

- [ ] `attunement check <files...>` CLI: validate config files against the
      schema in CI, catch broken config before deploy, not at boot
- [ ] `--all` + diff mode: key present in prod but missing in stage
- [ ] Secret hygiene warnings: `*_SECRET`/`*_KEY`/`*_TOKEN` names, high-entropy
      values (SPA config is public)
- [ ] Docs generation from schema `.describe()`: markdown table of keys, types,
      defaults

### v0.4 — DX extras

- [ ] `attunement/devtools`: dev-only override panel generated from the schema
      (enum → select, boolean → switch), localStorage layer validated by the
      same schema, `?config.KEY=value` bootstrap
- [ ] `attunement/vite`: dev server serves the config file + reload on change,
      HTML placeholder inject for `fromWindow` deploys
- [ ] Config fingerprint: hash + optional meta (`_version`, `_generatedAt`)
      exposed for Sentry scope / log prefix

### Explicitly out of scope

- Remote config service, polling, mid-session updates — that's
  Unleash/ConfigCat territory; a `Source` can point at their SDK if needed
- Per-user targeting / gradual rollout
- Value encryption (client always has the key; secrets don't belong in SPA
  config — the hygiene check says so out loud)
- SSR (different problem; config lives server-side there)
