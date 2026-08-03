# attunement

## 0.5.2

### Patch Changes

- 610b35c: Override recovery moved where the knowledge lives (field report #3):

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

## 0.5.1

### Patch Changes

- 7bcd7e5: Field report #2 fixes:

  - `DevtoolsProps.config` (and `attunementDevtoolsPlugin`) now accept the core
    `Attuned` handle instead of `AttunedReact`. The React handle is invariant in
    its config type (context), so the documented `React.lazy` devtools pattern
    failed to typecheck with a typed schema — and `bindReact` users had to
    export a bound handle just for the panel. The panel only ever needed
    `load()` and the schema; a React handle still works.
  - Default errorFallback detects active dev overrides
    (`localStorage["attunement:overrides"]`), lists them and offers
    "Clear overrides and reload" — a persisted invalid override otherwise turns
    Retry into a loop with the devtools panel unreachable behind the error
    boundary (the same failure mode `cache: "no-store"` fixed for CDNs, second
    persistence source).
  - README: the lazy devtools import now sits inside the `import.meta.env.DEV`
    gate — an ungated `lazy(() => import(...))` still emits and deploys the
    devtools chunk in production builds.

## 0.5.0

### Minor Changes

- ee8ddab: API wave — field-report driven, panel-validated:

  - **`onReady(cb)`** on the attune handle: register render-critical wiring from
    modules the config module must not import (router basepath, i18n) — no more
    import cycles. One queue with `onLoad` (which is now just the first
    callback), awaited in registration order before `load()` resolves; callback
    errors reject the load as `ConfigError`. Registered after resolve: runs
    immediately with a DEV warning; after a failed load: never runs.
  - **`bindReact(attuned)`**: React binding over an existing core handle, so the
    schema can live in a leaf module importable by `attunement check` and tests.
    `attuneReact(options)` is unchanged (it is now `bindReact(attune(options))`).
  - **`errorFallback(error, retry)`**: function fallbacks get a `retry` argument
    (currently a full page reload); the default fallback gains a Retry button.
    The config boundary now rethrows errors that aren't `ConfigError`, so app
    bugs reach your own error boundary instead of masquerading as config
    failures. New `onError` prop on Provider for Sentry-style reporting.
  - **`optional(source)`** exported: failure → undefined → merge/chain falls
    through (was a recipe).
  - **`fromJson` now defaults `cache: "no-store"`** — a CDN-cached stale config
    survives reloads and turns Retry into a loop. Override with
    `fromJson(url, { cache: "default" })` if you serve config with proper
    invalidation.
  - **Devtools**: `fields?: FieldInfo[]` on `DevtoolsProps`/`docsTable` bypasses
    zod introspection (escape hatch for Valibot/ArkType).
    `attunementDevtoolsPlugin(config, { storageKey, fields })` — second argument
    is now an options object (was `storageKey` string).
  - **CLI**: `check --strict` turns secret-hygiene warnings into failures;
    `check --print-fingerprint` prints the same hash the running app reports via
    `fingerprint()`.
  - React entries ship a `"use client"` banner.
  - `@standard-schema/spec` moved to `dependencies` (types-only) — public d.ts
    imports it; consumers without a transitive copy previously got TS2307.
  - Note for type-level consumers: `Attuned` gained `onReady` and an internal
    `_schema` — hand-built mocks of the handle need updating.

- bcb1108: Config fingerprint: `attune()`/`attuneReact()` handles expose `fingerprint()`
  resolving to `{ hash, version?, generatedAt? }` — a stable FNV-1a hash of the
  validated config (key-order independent) plus `_version`/`_generatedAt` read
  off the raw config when the deploy pipeline stamps them. `onLoad` receives the
  fingerprint as a second argument for Sentry scope / log prefix wiring.

### Patch Changes

- b205980: First batch of field-report fixes:

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

## 0.4.4

### Patch Changes

- b6921dc: Devtools panel rows no longer stretch to the full TanStack Devtools shell
  height. The shell applies `> * > * { height: 100% }` to plugin content, which
  blew each field row up to ~400px; rows, buttons and the note now pin
  `height: auto` inline.

## 0.4.3

### Patch Changes

- 69bdbd2: Fix devtools panel for Zod 4 schemas and overflowing content:

  - Schema introspection (`introspectShape`, `docsTable`, devtools form) now reads
    both Zod 3 (`_def.typeName`, enum `values`, default thunk) and Zod 4
    (`_def.type`, enum `entries`, plain default value) internals. With Zod 4,
    booleans render as checkboxes and enums as populated selects again instead of
    falling back to plain text inputs.
  - The panel scrolls its own overflow (`max-height` + `overflow-y: auto`), so all
    fields and the Save/Clear buttons stay reachable inside the TanStack Devtools
    shell's fixed-height, `overflow: hidden` container — and the standalone
    floating widget caps at 70vh.

## 0.4.2

### Patch Changes

- 8f0f965: `attunementDevtoolsPlugin`'s return type now declares `render: ReactElement` instead of `ReactNode` — `ReactNode` includes `undefined`, which the TanStack Devtools shell's `TanStackDevtoolsReactPlugin.render` (`JSX.Element | (...) => JSX.Element`) rejects. The panel always renders a real element, so the wider type was never earning its keep.

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
