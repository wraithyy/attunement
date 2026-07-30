# attunement

> Typed, validated runtime config for SPAs. The app attunes to its environment before first render.

[![npm](https://img.shields.io/npm/v/attunement)](https://www.npmjs.com/package/attunement)
[![CI](https://github.com/wraithyy/attunement/actions/workflows/ci.yml/badge.svg)](https://github.com/wraithyy/attunement/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/attunement)](./LICENSE)
![gzip size](https://img.shields.io/bundlejs/size/attunement)

- **One build, any environment** — config loads at runtime; changing an API URL is a redeploy, not a rebuild
- **Schema-first** — types, validation and defaults from one definition, via [Standard Schema](https://standardschema.dev) (Zod, Valibot, ArkType)
- **Race-free** — React renders only after config is loaded and valid; components never see `undefined`
- **Test-ready** — `createTestProvider` gives components config synchronously, no fetch, no mocks
- **Tiny** — zero dependencies, ~1 kB core, tree-shakable ESM
- **Framework-agnostic core** — React 19 adapter included, plain `load()` everywhere else; multiple independent instances per app

Pre-1.0: the API is small and settling — minor versions may still move it.
Roadmap and design notes in [docs/plan.md](./docs/plan.md).

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

| | Runtime (no rebuild) | Schema validation | Blocks render until ready |
|---|:---:|:---:|:---:|
| **attunement** | ✅ | ✅ any Standard Schema | ✅ Suspense gate |
| `import.meta.env` / [import-meta-env](https://github.com/runtime-env/import-meta-env) | ❌ build-time | ❌ (generated types only) | — |
| hand-rolled `window._env_` + `envsubst` | ✅ | ❌ unless you write it | ❌ script-order luck |
| `runtime-env-cra`, `react-inject-env` | ✅ | ❌ | ❌ (both unmaintained for years) |
| ConfigCat / Unleash / LaunchDarkly | ✅ | flag-level only | SDK-specific |

Feature-flag services solve a different problem (targeting, rollout,
experimentation) — a `Source` can wrap their SDK if you use both.

## Install

```sh
pnpm add attunement   # or npm / yarn
```

Browser SPAs only (no SSR — config lives server-side there). The React adapter
needs React 19+; the zero-dependency core runs anywhere with `fetch`.

## Quick start

```tsx
// config.ts — module scope, so the fetch starts with the app, not with a render
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
    setApiBaseUrl(config.API_URL); // runs before first render
  },
});
```

```tsx
// main.tsx
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

Non-React code uses the same cached load: `await appConfig.load()` — see
[recipes](./docs/recipes.md) for OAuth clients and loggers.

**Local dev:** put `app-config.json` in Vite's `public/` directory — it's
served at `/app-config.json` in dev and copied next to the bundle on build.
In production your deploy pipeline replaces it per environment
([how](./docs/recipes.md#serving-the-config-file-per-environment)).

```
public/app-config.json   → served at /app-config.json
src/config.ts            → attuneReact() + schema
src/main.tsx             → Provider
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

`fromJson` retries network errors, timeouts and 5xx with exponential backoff —
defaults: 8 s per-attempt timeout, 2 retries, 300 ms base backoff; 4xx fails
immediately. Tune via `fromJson(url, { timeoutMs, retries, backoffMs, ...fetchInit })`.

A custom source is a one-liner (`() => unknown | Promise<unknown>`), and each
`attune()` call is an independent instance — see the
[kill-switch recipe](./docs/recipes.md#second-config-instance-kill-switch).

## API

| Export | Entry | Description |
|---|---|---|
| `attune(options)` | `attunement` | Core factory → `{ load() }`; promise starts immediately, result is cached |
| `attuneReact(options)` | `attunement/react` | Core + `{ Provider, use() }` (Suspense + error boundary) |
| `fromJson(url, options?)` | both | JSON fetch source with timeout + retry |
| `fromWindow(key)` | both | `window` global source |
| `ConfigError` | both | Thrown/passed on validation failure; carries per-key issues |
| `createTestProvider(config, overrides)` | `attunement/testing` | Synchronous Provider for tests |

Types flow from the schema — you never write generics.

## Recipes

[docs/recipes.md](./docs/recipes.md): config outside the React tree (OAuth,
loggers), all-strings config from env-var substitution, serving the file per
environment (Helm, nginx `envsubst`, CDN), second instance as a kill switch.

## Contributing

Issues and PRs welcome — run `pnpm test && pnpm typecheck && pnpm build`
before pushing. Releases via changesets; changelog on
[GitHub Releases](https://github.com/wraithyy/attunement/releases).

## License

[MIT](./LICENSE) © Josef Kvapil
