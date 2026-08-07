# attunement

> Typed, validated runtime config for SPAs. The app attunes to its environment before first render.

[![npm](https://img.shields.io/npm/v/attunement)](https://www.npmjs.com/package/attunement)
[![CI](https://github.com/wraithyy/attunement/actions/workflows/ci.yml/badge.svg)](https://github.com/wraithyy/attunement/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/attunement)](./LICENSE)
![gzip size](https://img.shields.io/bundlejs/size/attunement)

- **One build, any environment** — config loads at runtime; changing an API URL is a redeploy, not a rebuild
- **Schema-first** — types, validation and defaults from one definition, via [Standard Schema](https://standardschema.dev) (Zod, Valibot, ArkType). Schema introspection (devtools panel, `attunement docs`) is zod-only for now — the spec has no introspection API
- **Race-free** — in React nothing renders before config is loaded and valid (Suspense gate); elsewhere `await load()` before bootstrap
- **Test-ready** — `createTestProvider` gives components config synchronously, no fetch, no mocks
- **Tooling included** — `attunement check` validates config files in CI, dev override panel (standalone or TanStack Devtools), Vite plugin with reload-on-change
- **Tiny** — zero dependencies, ~1 kB core, tree-shakable ESM
- **Framework-agnostic core** — React 19 adapter included; Angular/Vue/vanilla use the same core ([recipes](./docs/recipes.md#other-frameworks)); multiple independent instances per app

**[Why](#why) · [Install](#install) · [Quick start](#quick-start) · [API](#api) ·
[Testing](#testing) · [Sources](#sources) · [Vite plugin](#vite-plugin) ·
[Devtools](#devtools) · [CI check](#ci-check) · [Recipes](./docs/recipes.md)**

Pre-1.0: the API is small and settling — minor versions may still move it.
Design notes in [docs/design.md](./docs/design.md).

## Why

A SPA built with `import.meta.env` bakes configuration into the bundle — every
environment needs its own build, which breaks the basic CI/CD contract that
**the artifact you tested is the artifact you ship**. attunement loads config
at runtime instead: one artifact promoted through dev → staging → production,
config owned by your deployment tooling (Helm values, Terraform, an `envsubst`
in the entrypoint). The catch with runtime config is that it arrives untyped,
unvalidated and racing your first render — closing that gap is what this
library is for.

### vs. the alternatives

| | Runtime (no rebuild) | Schema validation | Typed config | Blocks render until ready | Tooling | Runtime cost |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **attunement** | ✅ | ✅ any Standard Schema, in the running app | ✅ inferred from schema | ✅ Suspense gate | dev override panel, CI check CLI, Vite plugin | ~1 kB, zero deps |
| `import.meta.env` / [import-meta-env](https://github.com/runtime-env/import-meta-env) | ❌ build-time | ⚠️ primitive type check at inject time, nothing at runtime | ✅ generated `.d.ts` | — | editor types | none (build-time) |
| hand-rolled `window._env_` + `envsubst` | ✅ | ❌ unless you write it | ❌ hand-written | ❌ DIY — a stale or 404'd `env.js` fails silently | ❌ | none |
| `runtime-env-cra`, `react-inject-env` (dormant since ~2021) | ✅ | ❌ | ❌ | ❌ | ❌ | tiny |
| ConfigCat / Unleash / LaunchDarkly | ✅ | flag-level only | ⚠️ per-flag getters | SDK-specific opt-in (e.g. `asyncWithLDProvider`) | ✅ hosted dashboard, targeting UI | full SDK (tens of kB) + network |

Feature-flag services solve a different problem (targeting, rollout,
experimentation) — a `Source` can wrap their SDK if you use both.

## Install

```sh
pnpm add attunement   # or npm / yarn
```

Browser SPAs only (no SSR — config lives server-side there). Islands
frameworks (Astro, Qwik) work the same way inside client-hydrated islands;
server-rendered parts never call it. The React adapter needs React 19+; the
zero-dependency core runs anywhere with `fetch`.

## Quick start

```tsx
// config.ts — module scope, so the fetch starts with the app, not with a render
import { z } from "zod";
import { attuneReact, fromJson } from "attunement/react";
import { setApiBaseUrl } from "./api";

export const appConfig = attuneReact({
  schema: z.object({
    API_URL: z.string(),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("warn"),
  }),
  sources: [fromJson("/app-config.json")],
  onLoad: (config) => {
    setApiBaseUrl(config.API_URL); // runs before first render
  },
});
```

`onLoad` is the **only** hook guaranteed to finish before the first render —
it's awaited inside the load promise itself. Wire up anything render-critical
(API base URL, router basepath, logger) in `onLoad`.

The wiring rule: **in the config module** → `onLoad`; **from another module**
(router, i18n) → `appConfig.onReady()`. This avoids import cycles while keeping
your critical wiring sequenced before render.

```tsx
// main.tsx
createRoot(el).render(
  <appConfig.Provider fallback={<Splash />} errorFallback={(error, retry) => <ConfigError error={error} onRetry={retry} />}>
    <App />
  </appConfig.Provider>
);
```

```tsx
// anywhere under Provider — synchronous, fully typed, never undefined
const { API_URL } = appConfig.use();
```

Both fallbacks are optional: without `errorFallback` a failed load renders a
minimal "Configuration failed to load." notice with a Retry button (error details
in dev only — message names config keys and source URLs, which end users shouldn't
see). **Clicking Retry performs a full page reload.**

When `fromOverrides()` is in play, the default notice also detects stored dev
overrides and offers "Clear overrides and reload" — clearing storage **and**
stripping `config.*` URL params, so a broken shared repro link can't reseed
itself. A custom `errorFallback` replaces all of that; drop
`<OverrideRecovery />` from `attunement/devtools` into it to keep the recovery
(renders nothing when no overrides are stored):

```tsx
errorFallback={(error, retry) => (
  <MyBrandedError error={error} onRetry={retry}>
    {import.meta.env.DEV && <OverrideRecovery />}
  </MyBrandedError>
)}
```

(The DEV gate lets the bundler drop the devtools bytes — ungated it renders
null in production, but ships.) For localized error UIs, build the message
from `error.issues` (`ConfigError` carries the per-key Standard Schema
issues) rather than rendering `error.message` verbatim.

No React? The core is the same thing minus the Provider — await it before
bootstrap (Angular `APP_INITIALIZER`, Vue `main.ts` — [recipes](./docs/recipes.md#other-frameworks)):

```ts
import { attune, fromJson } from "attunement";

export const appConfig = attune({ schema, sources: [fromJson("/app-config.json")] });
await appConfig.load(); // typed, validated, cached
```

Non-React code in a React app uses the same cached load: `await appConfig.load()`
— see [recipes](./docs/recipes.md) for OAuth clients and loggers.

**Local dev:** put `app-config.json` in Vite's `public/` directory — it's
served at `/app-config.json` in dev and copied next to the bundle on build.
In production your deploy pipeline replaces it per environment
([how](./docs/recipes.md#serving-the-config-file-per-environment)).

```
public/app-config.json   → served at /app-config.json
src/config.ts            → attuneReact() + schema
src/main.tsx             → Provider
```

### Zero-request injection (dev/staging)

To skip the fetch entirely in dev, inject config into `index.html` at build/serve time. The Vite plugin wires this up:

```ts
// vite.config.ts
import { attunement } from "attunement/vite";

export default defineConfig({
  plugins: [
    attunement({
      configFile: "config/app-config.json",
      injectKey: "__APP_CONFIG__",  // injects into window at dev, placeholder for deploy
    }),
  ],
});
```

Then add it as a first source:

```tsx
// config.ts
import { fromWindow, fromJson } from "attunement/react";

export const appConfig = attuneReact({
  schema,
  sources: [
    fromWindow("__APP_CONFIG__"),  // dev/staging: window global, zero request
    fromJson("/app-config.json"),  // fallback: fetch from static file
  ],
  onLoad: (config) => { /* ... */ },
});
```

In dev the first source hits; in production the placeholder is replaced by
deploy tooling with the real config object (`envsubst`, sed, Helm templating),
or the window source misses and the fetch fallback runs.
For **production without injection**, omit the `fromWindow` source — fetching
alone is safe and simpler.

### Migrating from a hand-rolled loader

The classic hand-rolled shape gates render with `.then()`:

```tsx
// before
fetchConfig().then((config) => {
  setApiBaseUrl(config.API_URL);
  root.render(<App />);
});
```

Don't keep the `.then()` and swap the loader — that renders the tree only
after the promise resolves, so the Provider has nothing to gate and your
`fallback`/`errorFallback` become dead code. Nothing warns about it; the app
still works. Migrate all three parts:

```tsx
// after: wiring → onLoad, gating → Provider, render is unconditional
export const appConfig = attuneReact({
  schema,
  sources: [fromJson("/app-config.json")],
  onLoad: (config) => setApiBaseUrl(config.API_URL),
});

root.render(
  <appConfig.Provider fallback={<Splash />}>
    <App />
  </appConfig.Provider>
);
```

## API

| Export | Entry | Description |
|---|---|---|
| `attune(options)` → `{ load(), fingerprint(), onReady() }` | `attunement` | Core factory; promise starts at module scope, result cached |
| `attuneReact(options)` → `{ ..., Provider, use() }` | `attunement/react` | Core + React bindings (Suspense + error boundary) |
| `bindReact(attuned)` | `attunement/react` | React binding over an existing core handle (schema in CLI modules, wiring via onReady) |
| `fromJson(url, options?)` | both | JSON fetch source with timeout + retry; defaults to `cache: "no-store"` |
| `fromWindow(key)` | both | `window` global source (injected config, zero request) |
| `merge(...sources)` | both | Combine sources: parallel, shallow merge, later wins |
| `optional(source)` | both | Wrap source: nullish or error → skip, don't fail the chain |
| `ConfigError` | both | Thrown/passed on validation failure; carries per-key issues |
| `safeUrlOrPath(value)` | both | Refinement predicate for URL-shaped values: same-origin path or absolute http(s) URL; rejects protocol-relative and non-http schemes |
| `createTestProvider(config, overrides)` | `attunement/testing` | Synchronous Provider for tests — test-only, onReady never runs |
| `attunement check`, `attunement docs` | bin / `attunement/cli` | Config validation in CI, schema docs; supports `--schema` (Node ≥ 22.18 / tsx) |
| `AttunementDevtools` / `attunementDevtoolsPlugin(config, options)` | `attunement/devtools` | Dev override panel — dev-only, gate the import; options: `{ storageKey?, fields? }` |
| `fromOverrides(storageKey?)` | `attunement/devtools` | Override source (localStorage + `?config.KEY=value` URL bootstrap); registers the error-fallback recovery |
| `OverrideRecovery` | `attunement/devtools` | "Clear overrides and reload" block for custom errorFallbacks; renders nothing without overrides |
| `attunement({ configFile?, injectKey? })` | `attunement/vite` | Vite plugin — reload on change, HTML injection; build-time only |

Types flow from the schema — you never write generics.

### Config fingerprint

Which config was this session actually running? `fingerprint()` resolves to a
stable hash of the validated config (key-order independent), plus `_version` /
`_generatedAt` when your deploy pipeline stamps them into the raw config file
(they don't need to be in the schema). Also passed to `onLoad` as the second
argument:

```ts
onLoad: (config, { hash, version }) => {
  Sentry.setTag("config", version ?? hash);
},
```

## Testing

Components under test get config synchronously — no fetch, no Suspense,
no mocking:

```tsx
import { createTestProvider } from "attunement/testing";
import { appConfig } from "./config";

const TestProvider = createTestProvider(appConfig, {
  API_URL: "http://localhost:9999", // merged over schema defaults
});

render(<TestProvider><UserList /></TestProvider>);
```

Overrides are validated against your schema — a typo fails the test at setup
with a named key, not three asserts later.

**Important:** `onReady()` callbacks do not run under `createTestProvider` —
only `onLoad` is called. If a callback under test depends on wiring registered
via `onReady()`, register it in the test directly:

```tsx
beforeEach(() => {
  appConfig.onReady(() => {
    // setup wiring
  });
});
```

For this reason, keep `onReady` callbacks in their own modules and import them
eagerly from your main entry point so they register during config init.

## How it works

- Loading starts when `attuneReact()` is called (module scope), in parallel
  with the rest of your app booting — by first paint the config is usually
  already there.
- `Provider` shows `fallback` until config is loaded and valid; with
  `fromWindow` (config injected into `index.html`) it resolves so fast the
  fallback never appears.
- Invalid config → `ConfigError` in your `errorFallback` instead of a white
  page, with per-key issues and a did-you-mean for typos:
  `API_URL: Required (did you mean "API_URl"?)`.
- The loaded config is deep-frozen — accidental mutation throws instead of
  silently desyncing the app. Need a mutable copy? `structuredClone(config)`.

## Sources

Sources are tried in order; the first one that yields data wins. Returning
`undefined`/`null` or throwing falls through to the next; if none succeeds you
get a `ConfigError` listing what each source said.

| Source | What it does | Typical use |
|---|---|---|
| `fromWindow(key)` | Reads `window[key]` | Config injected into `index.html` at deploy — zero extra request |
| `fromJson(url, options?)` | Fetches and parses JSON | `app-config.json` served next to the bundle |
| `merge(...sources)` | Runs sources in parallel, shallow-merges results (later wins) | Base config + per-environment overrides file |

`fromJson` retries network errors, timeouts and 5xx with exponential backoff —
defaults: 8 s per-attempt timeout, 2 retries, 300 ms base backoff; 4xx fails
immediately. Tune via `fromJson(url, { timeoutMs, retries, backoffMs, ...fetchInit })`.

A custom source is a one-liner (`() => unknown | Promise<unknown>`), and each
`attune()` call is an independent instance — e.g. a separately deployed
maintenance flag next to the main config
([kill-switch recipe](./docs/recipes.md#second-config-instance-kill-switch)).


## Vite plugin

Optional — Vite's `public/` directory covers the basics; the plugin adds
reload-on-change and the HTML inject. Specified in `vite.config.ts`:

```ts
import { attunement } from "attunement/vite";

export default defineConfig({
  plugins: [
    attunement({
      configFile: "config/app-config.json",  // default: "config/app-config.json"
      injectKey: "__APP_CONFIG__",           // optional: inject window global
    }),
  ],
});
```

**Reload on change:** Dev server watches the config file and triggers
a **full page reload** on any edit — config module edits full-reload by design
(config-dependent wiring would be in an inconsistent state if only the
callback ran).

**HTML injection** (when `injectKey` is set):
- Dev: injects the real config object into `window[key]` in `index.html`
- Build: injects a placeholder string for your deploy pipeline to replace

Astro and other Vite-based frameworks pass it through the `vite` key of their
own config.

## Devtools

Dev-only override panel generated from your schema — enum → select,
boolean → checkbox. For now this works with zod object schemas only (3 or
4): Standard Schema has no introspection API yet, so the field form is
built by reading zod's internals. Other libraries currently get a "schema
is not introspectable" notice instead of the form; support may widen as
the ecosystem grows. Works standalone or as a TanStack Devtools plugin:

```tsx
// config.ts — let overrides participate in loading (dev only, merged over real config)
import { fromOverrides } from "attunement/devtools";

const devOverrides = import.meta.env.DEV ? [fromOverrides()] : [];

export const appConfig = attuneReact({
  schema,
  sources: [merge(fromJson("/app-config.json"), ...devOverrides)],
});
```

```tsx
// App.tsx — the whole lazy() belongs INSIDE the DEV gate. A DEV gate around
// the render alone removes the call, not the import; and an ungated
// lazy(() => import(...)) still emits (and deploys) the devtools chunk —
// the gate must make the dynamic import itself unreachable in builds.
import { lazy } from "react";

const AttunementDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("attunement/devtools").then((m) => ({ default: m.AttunementDevtools }))
    )
  : () => null;

{import.meta.env.DEV && <AttunementDevtools config={appConfig} />}
```

As a TanStack Devtools plugin instead — same rule, keep the
`attunement/devtools` import behind the same dynamic boundary as your
`<TanStackDevtools>` setup:

```tsx
<TanStackDevtools plugins={[attunementDevtoolsPlugin(appConfig, { storageKey: "my_config_overrides" })]} />
```

The standalone widget sits bottom-right by default; pass
`position="bottom-left"` (or `top-*`) when TanStack Query devtools or
react-scan already live there. Plugin options: `storageKey` (localStorage key
for overrides), `fields` (override introspected field list — for Valibot or
ArkType schemas where introspection isn't yet supported).

Overrides live in localStorage, validated by the schema on load like any other
config; saving reloads the page (config loads once per page load, so a reload
is how changes apply). `?config.KEY=value` in the URL bootstraps an override —
handy for sharing a repro link. If a shared override breaks the load, the
error fallback offers "Clear overrides and reload", which clears storage and
strips the `config.*` params so the link can't reseed itself. (The default
fallback's recovery *strings* live in the react entry — a few hundred inert
bytes in production; all override logic stays in `attunement/devtools` and
never registers there.)

## CI check

Broken config should fail the pipeline, not the boot. `attunement check`
validates config files against the same schema the app uses:

```sh
attunement check --schema src/config-schema.ts config/*.json --diff
```

- Validation failures print the same per-key, did-you-mean errors as at runtime
- `--diff` fails when files disagree on top-level keys (key added to prod,
  forgotten in stage)
- `--strict` exits 1 on secret hygiene warnings (keys named like credentials:
  `*_SECRET`, `*_TOKEN`, `*_API_KEY`, or values looking like generated secrets)
- `--print-fingerprint` outputs `<file> <hash> [version]` per file (for deploy logs)
- `attunement docs --schema ...` renders a markdown table of keys, types,
  defaults and `.describe()` descriptions (zod schemas)

`--schema` takes any module exporting the schema (`schema` or default export);
`.ts` works directly on Node ≥ 22.18 (tsx for older Node). **Schema module
must use relative imports only** — it's loaded standalone by the CLI and
cannot pull in app code.

### Schema organization (CLI + React)

If your app also has non-React CLI tooling (build, migration, admin tasks), split the config in three files:

```ts
// src/config-schema.ts — schema only, zero imports except zod
import { z } from "zod";
export const schema = z.object({
  API_URL: z.string(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]),
});

// src/config.ts — core handle, same module scope as main.tsx/cli.ts
import { attune } from "attunement";
import { schema } from "./config-schema";
export const appConfig = attune({ schema, sources: [fromJson("/app-config.json")] });

// src/config.react.tsx — React bindings (you don't need this yet)
import { bindReact } from "attunement/react";
import { appConfig } from "./config";
export const AppConfig = bindReact(appConfig);  // independent context if multiple bindings needed
```

**Let inference flow:** avoid annotating the handle (`const c: Attuned<Config> = ...`);
it erases the schema type and `use()` degrades to unknown. Let TypeScript infer
from the `attune()` / `bindReact()` call.

## Recipes

[docs/recipes.md](./docs/recipes.md): config outside the React tree (OAuth,
loggers), all-strings config from env-var substitution, serving the file per
environment (Helm, nginx `envsubst`, CDN), second instance as a kill switch.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). Releases
via changesets; changelog on
[GitHub Releases](https://github.com/wraithyy/attunement/releases).

## License

[MIT](./LICENSE) © Josef Kvapil
