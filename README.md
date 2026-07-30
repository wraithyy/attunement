# attunement

> Typed, validated runtime config for SPAs. The app attunes to its environment before first render.

[![npm](https://img.shields.io/npm/v/attunement)](https://www.npmjs.com/package/attunement)
[![CI](https://github.com/wraithyy/attunement/actions/workflows/ci.yml/badge.svg)](https://github.com/wraithyy/attunement/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/attunement)](./LICENSE)
![gzip size](https://img.shields.io/bundlejs/size/attunement)

- **One build, any environment** — config loads at runtime, not at build time
- **Schema-first** — types, validation and defaults from one definition, via [Standard Schema](https://standardschema.dev) (Zod, Valibot, ArkType — your pick)
- **Race-free** — loading starts at module scope, React suspends until config is ready; components never see `undefined`
- **Tiny & tree-shakable** — zero dependencies, ~1 kB core, ESM only
- **Framework-agnostic core** — React adapter included, the core is plain TypeScript

## Why

Build once, deploy anywhere. A SPA built with `import.meta.env` bakes its
configuration into the bundle — every environment needs its own build, and
changing a URL means a rebuild and a full release. That breaks the basic CI/CD
contract: **the artifact you tested is the artifact you ship**.

Runtime config inverts this: one built artifact, and everything
environment-specific lives next to the deployment — API base URL, log level,
OAuth client ids, feature flags, limits. Ops changes a JSON file, not your CI
pipeline.

The catch is that runtime config arrives *at runtime* — untyped, unvalidated,
and racing your first render. attunement closes that gap: define a schema once
and get types, validation, defaults and a render gate from a single definition.

## Install

```sh
pnpm add attunement
# or npm install / yarn add
```

React adapter needs React 19+ (it builds on `use()`). The core has no
dependencies and works anywhere.

## Usage

```tsx
// config.ts — module scope, so the fetch races your bundle
import { z } from "zod";
import { attuneReact, fromWindow, fromJson } from "attunement/react";
import { setApiBaseUrl } from "./api";

export const appConfig = attuneReact({
  schema: z.object({
    API_URL: z.string(),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("warn"),
  }),
  sources: [fromWindow("__APP_CONFIG__"), fromJson("/app-config.json")],
  onLoad: (config) => {
    setApiBaseUrl(config.API_URL); // runs before first render, no race
  },
});
```

```tsx
// main.tsx — no async bootstrap
createRoot(el).render(
  <appConfig.Provider fallback={<Splash />} errorFallback={(e) => <ConfigError error={e} />}>
    <App />
  </appConfig.Provider>
);
```

```tsx
// anywhere under Provider — synchronous, fully typed, never undefined
const { API_URL } = appConfig.use();
```

Non-React code uses the same cached load: `await appConfig.load()`.

## How it solves the race

- `attuneReact()` starts loading **at module evaluation**, parallel to the rest
  of your bundle — no render-time waterfall.
- `Provider` suspends until config resolves; children never render without it.
- With `fromWindow` (config injected into `index.html` at deploy) resolution is
  a microtask — the fallback never even flashes.
- Invalid config → `ConfigError` with per-key issues → your `errorFallback`
  instead of a white page.

## Sources

Sources are tried in order; the first one that yields data wins.

| Source | What it does | Typical use |
|---|---|---|
| `fromWindow(key)` | Reads `window[key]` | Config injected into `index.html` at deploy — zero extra request |
| `fromJson(url)` | Fetches and parses JSON | `app-config.json` served next to the bundle |

A source is just `() => unknown \| Promise<unknown>`. Returning
`undefined`/`null` or throwing falls through to the next source; if none
succeeds you get a `ConfigError` listing what each source said. Writing your
own is a one-liner.

Multiple independent configs per app are fine — each `attune()` call is its own
instance with its own sources and cache (e.g. a polled `shutdown.json` kill
switch next to the main config).

## API

| Export | Entry | Description |
|---|---|---|
| `attune(options)` | `attunement` | Core factory → `{ load() }`; promise starts immediately, result is cached |
| `attuneReact(options)` | `attunement/react` | Core + `{ Provider, use() }` (Suspense + error boundary) |
| `fromJson(url)` | both | JSON fetch source |
| `fromWindow(key)` | both | `window` global source |
| `ConfigError` | both | Thrown/passed on validation failure; carries per-key issues |

Types flow from the schema — you never write generics.

## Framework-agnostic core

```ts
import { attune, fromJson } from "attunement";

const config = await attune({ schema, sources: [fromJson("/app-config.json")] }).load();
```

## License

[MIT](./LICENSE) © Josef Kvapil
