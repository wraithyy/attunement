# attunement

> Typed, validated runtime config for SPAs. The app attunes to its environment before first render.

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
Bring any [Standard Schema](https://standardschema.dev) library: Zod, Valibot,
ArkType.

## Install

```sh
pnpm add attunement
```

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

## Framework-agnostic core

```ts
import { attune, fromJson } from "attunement";

const config = await attune({ schema, sources: [fromJson("/app-config.json")] }).load();
```
