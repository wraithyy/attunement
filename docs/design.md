# Design

## Goal

One built artifact deployable to any number of environments, with everything
environment-specific changeable at runtime without a rebuild: API base URL, log
level, OAuth client ids, feature flags, business limits. The library owns the
loading, validation and delivery of that config; the schema stays app-owned.

## Where the pattern comes from

Two production apps already hand-rolled this. attunement is their common core,
extracted and hardened.

### App A

- `fetch("/app-config.json")` → Zod `safeParse` → module-level cache.
- Keys: `API_URL`, `ENABLE_MOCKING`, `LOG_LEVEL`, `LOG_CONTEXT`. Defaults via
  `.default()` keep already-deployed config files bootable when keys are added.
- Async bootstrap in `main.tsx`: await config, then `setApiBaseUrl()`, logger
  setup, then render. ConfigProvider + `useConfig()` context.
- Dev override panel for runtime config exists as a devtool.

What attunement replaces: the loader, the cache, the provider, the async
bootstrap (→ `onLoad` + Suspense) and the override panel
(`attunement/devtools`). What stays in the app: the schema.

### App B

- Same fetch + Zod + cache shape, `.then()` around `root.render`.
- **Coercion everywhere**: config is produced by env-var substitution in CI, so
  every value arrives as a string — string-or-boolean preprocess,
  `z.coerce.number()` for numeric limits. Any library serving this app must
  not assume typed JSON.
- Larger surface: OAuth/analytics keys, third-party API keys, `BASE_PATH`,
  feature toggles.
- **Second runtime file**: `shutdown.json` read as a kill switch → the
  library must support multiple independent `attune()` instances per app.
- Per-environment config files committed in repo → motivated the
  `attunement check` CI story.

## Design pillars

1. **Framework-agnostic core, adapters as entries.** Core exposes
   `attune() → { load(), fingerprint() }` — a promise and a cache, no UI
   concepts. Adapters (`/react` now; `/vue`, `/svelte`, `/solid` when demanded)
   wrap it in the framework's own suspense/context idiom. Nothing in core may
   block a future adapter: no JSX, no hooks, no framework types.
2. **Tree-shaking.** `sideEffects: false`, ESM only, named exports, one entry
   per concern. An app importing `attunement` ships the loader (~2 kB gzip),
   nothing else. CLI/devtools never leak into app bundles.
3. **Standard Schema.** Zod/Valibot/ArkType all work; the schema is the single
   source of truth for types, validation, defaults — and docs generation and
   the devtools panel UI.
4. **Race-free by construction.** Eager load at module scope + Suspense gate:
   config is synchronously available under the Provider, `onLoad` runs before
   first render (API base URL, logger), invalid config hits an error boundary
   instead of a white page.

The v0.1–v0.4 roadmap (core, adoption blockers, CI story, DX extras) has
shipped — see [CHANGELOG](../CHANGELOG.md).

## Explicitly out of scope

- Remote config service, polling, mid-session updates — that's
  Unleash/ConfigCat territory; a `Source` can point at their SDK if needed
- Per-user targeting / gradual rollout
- Value encryption (client always has the key; secrets don't belong in SPA
  config — the hygiene check says so out loud)
- SSR (different problem; config lives server-side there)
