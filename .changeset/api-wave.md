---
"attunement": minor
---

API wave — field-report driven, panel-validated:

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
