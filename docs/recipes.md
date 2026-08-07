# Recipes

Patterns that don't belong in the README's critical path but come up in real
apps.

- [wiring rule: onLoad vs onReady](#wiring-rule-onload-vs-onready) — the dumb rule
- [Error reporting](#error-reporting) — Sentry, analytics
- [Serving the config file per environment](#serving-the-config-file-per-environment) — Helm, nginx `envsubst`, CDN
- [Outside the React tree](#outside-the-react-tree) — OAuth clients, loggers, lazy services
- [All-strings config (env-var substitution)](#all-strings-config-env-var-substitution) — coercion recipe
- [Where to put app-config.json (per dev setup)](#where-to-put-app-configjson-per-dev-setup) — Vite, Angular, CRA, Astro
- [Other frameworks](#other-frameworks) — Angular `APP_INITIALIZER`, Vue provide/inject
- [Config check in the pipeline](#config-check-in-the-pipeline) — `attunement check` in CI
- [TanStack Router with basepath](#tanstack-router-with-basepath) — onReady routing
- [MSW (Mock Service Worker)](#msw-mock-service-worker) — dev/test mocking
- [Base + overrides (merged configs)](#base--overrides-merged-configs) — `merge`, optional override file
- [Separate schemas](#separate-schemas) — compose vs. separate instances
- [Dependent configs](#dependent-configs-config-bs-url-lives-in-config-a) — config B's URL from config A, [module federation caveats](#module-federation-caveats)
- [Second config instance (kill switch)](#second-config-instance-kill-switch)
- [Testing patterns](#testing-patterns) — baseline fixtures, async schema caveat

## wiring rule: onLoad vs onReady

The dumb rule that avoids import cycles and keeps wiring sequenced:

- **In the config module itself** → `onLoad` (same file as `attuneReact()`)
  ```ts
  // config.ts
  export const appConfig = attuneReact({
    schema,
    sources: [...],
    onLoad: (config) => {
      setApiBaseUrl(config.API_URL);  // run before first render
    },
  });
  ```

- **From another module** (router, i18n, analytics) → `appConfig.onReady()`
  ```ts
  // router.ts — imported by main.tsx, not by config.ts
  import { appConfig } from "./config";
  
  appConfig.onReady((config) => {
    router.update({ context: { apiUrl: config.API_URL } });
  });
  ```

**Critical:** onReady modules must be statically imported by your main entry
(e.g., `main.tsx` or `App.tsx`) so the callback registers during initial load.
Late registration shows a DEV warning and runs immediately, breaking the
before-first-render guarantee.

For non-critical wiring (analytics, logging), catch errors inside the callback:

```ts
// analytics.ts
appConfig.onReady((config) => {
  try {
    initAnalytics(config.ANALYTICS_KEY);
  } catch (error) {
    console.error("Analytics init failed, continuing anyway", error);
  }
});
```

Or skip the guarantee entirely:

```ts
// auth.ts — fires after first render is OK
appConfig.load().then((config) => {
  userManager = new UserManager({ authority: config.OAUTH_AUTHORITY });
});
```

## Error reporting

Log config failures to Sentry, reporting, or metrics:

```ts
// config.ts
import * as Sentry from "@sentry/react";

export const appConfig = attuneReact({
  schema,
  sources: [fromJson("/app-config.json")],
  onLoad: (config) => {
    setApiBaseUrl(config.API_URL);
  },
});

// Surface config load errors at module scope (fires before first render)
appConfig.load().catch((error) => {
  Sentry.captureException(error, {
    tags: { component: "config-load" },
  });
});
```

Then add the `onError` prop to the Provider for boundary-caught errors:

```tsx
// main.tsx
<appConfig.Provider
  fallback={<Splash />}
  errorFallback={(error, retry) => <ConfigErrorUI error={error} onRetry={retry} />}
  onError={(error) => {
    Sentry.captureException(error, { tags: { component: "config-boundary" } });
  }}
>
  <App />
</appConfig.Provider>
```

A custom `errorFallback` replaces the default one — including its dev-override
recovery. Keep it by dropping in `OverrideRecovery` (renders nothing when no
overrides are stored, so it's safe unconditionally):

```tsx
import { OverrideRecovery } from "attunement/devtools";

errorFallback={(error, retry) => (
  <ConfigErrorUI error={error} onRetry={retry}>
    {import.meta.env.DEV && <OverrideRecovery />}
  </ConfigErrorUI>
)}
```

The static import is fine as long as every use sits behind the DEV gate —
the bundler then tree-shakes the devtools code out of production. Ungated it
still renders null in production, just ships the bytes.

## Serving the config file per environment

A stale config cached at the CDN is the worst incident attunement can cause
(makes every retry a loop). The default `cache: "no-store"` skips the CDN cache.

**At your CDN or origin (nginx):**
```nginx
# Every request fetches from origin, zero caching
location /app-config.json {
  add_header Cache-Control "no-store";
}
```

**Injecting values at serve time:**

```bash
# Using envsubst (Kubernetes, docker entrypoint, CI)
export API_URL=https://api.prod.example.com
export LOG_LEVEL=warn
envsubst < /app/config.template.json > /app/config.json
```

```bash
# Using sed (shell only)
sed -e "s|__API_URL__|https://api.prod.example.com|g" \
    -e "s|__LOG_LEVEL__|warn|g" \
    /app/config.template.json > /app/config.json
```

```hcl
# Using Terraform + null_resource
locals {
  config_values = {
    API_URL = var.api_url
    LOG_LEVEL = "warn"
  }
}

resource "null_resource" "config" {
  provisioners "local-exec" {
    command = "envsubst < config.template.json > config.json"
    environment = {
      API_URL = local.config_values.API_URL
      LOG_LEVEL = local.config_values.LOG_LEVEL
    }
  }
}
```

## Outside the React tree

API clients, loggers, OAuth setup — anything that isn't a component reads the
same cached load. Two patterns:

**One-time imperative setup → `onLoad`.** Runs after validation, before first
render:

```ts
onLoad: (config) => {
  setApiBaseUrl(config.API_URL);
  initLogger(config.LOG_LEVEL);
},
```

**Lazily created services → `await load()`.** The promise is shared and cached;
after the first resolution awaiting it is effectively free:

```ts
// auth.ts — config arrives once, UserManager is created once
let userManager: Promise<UserManager> | undefined;

export function getUserManager() {
  userManager ??= appConfig.load().then(
    (c) => new UserManager({
      authority: c.OAUTH_AUTHORITY,
      client_id: c.OAUTH_CLIENT_ID,
      redirect_uri: `${location.origin}/callback`,
    })
  );
  return userManager;
}
```

Avoid exporting config-derived values synchronously at module scope
(`export const oauthConfig = {...}`) — the config may not have arrived yet.
That race is the whole reason this library exists.

## All-strings config (env-var substitution)

If your config file is produced by env-var substitution in CI
(`"MAX_PHOTOS": "$MAX_PHOTOS"`), every value arrives as a string. Let the
schema own the coercion:

```ts
const schema = z.object({
  MAX_PHOTOS: z.coerce.number().int().default(30),
  ENABLE_MOCKING: z
    .preprocess((v) => v === "true" || v === true, z.boolean())
    .default(false),
});
```

`z.coerce.number()` covers numbers; booleans need the one-line preprocess
because `Boolean("false") === true`. Typed JSON keeps working — coercion of an
already-correct type is a no-op.

## Where to put app-config.json (per dev setup)

The file must be served by the dev server at the URL `fromJson` fetches
(`/app-config.json` in all examples). Static-assets directory per setup:

| Setup | Put the file in | Served at |
|---|---|---|
| Vite (React, Vue, vanilla…) | `public/app-config.json` | `/app-config.json` |
| Vite + `attunement/vite` plugin | anywhere (default `config/app-config.json`) | `/app-config.json` + reload on change |
| Angular CLI | `public/app-config.json` (older projects: `src/assets/` + entry in `angular.json#assets`) | `/app-config.json` |
| Create React App | `public/app-config.json` | `/app-config.json` |
| Astro | `public/app-config.json` | `/app-config.json` |

In production it's the same idea: the deploy drops the environment's file next
to `index.html` (see [serving per environment](#serving-the-config-file-per-environment)).

## Other frameworks

The core has no framework concepts — `attune()` gives you a validated, cached
promise; gate your bootstrap on it the way your framework prefers.

**Angular** — `APP_INITIALIZER` delays bootstrap until config resolves:

```ts
// config.ts
export const appConfig = attune({ schema, sources: [fromJson("/app-config.json")] });

// app.config.ts
export const CONFIG = new InjectionToken<Config>("app-config");

providers: [
  provideAppInitializer(() => appConfig.load()),
  { provide: CONFIG, useFactory: () => awaitedConfigValue() },
]
```

where `awaitedConfigValue()` returns the resolved value cached by the
initializer (e.g. store it in a module-level variable inside `onLoad`).

**Vue** — await before mount, share via `provide`/`inject`:

```ts
// main.ts
const config = await appConfig.load();
const app = createApp(App);
app.provide(configKey, config);
app.mount("#app");
```

Components `inject(configKey)` — typed, synchronous, no re-fetch. Vue's async
`setup()` + `<Suspense>` can do the same per-component if you prefer; an
official `/vue` adapter (reactive wrapper + injection helper) lands when
there's demand.

## Config check in the pipeline

Validate every environment's config file on each push — a broken config fails
CI, not the production boot:

```yaml
# .github/workflows/ci.yml
config-check:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 24
    - run: npm ci
    - run: npx attunement check --schema src/config-schema.ts config/*.json --diff
```

Keep the schema in its own module (`src/config-schema.ts` exporting `schema`)
so the CLI can import it without pulling in the app. On GitLab CI the same
command goes into any `script:` block. Secret hygiene warnings show up in the
job log; they don't fail the job.

## TanStack Router with basepath

Config can specify a router basepath (`/app`, `/v2`). Update the router in
`onReady` so the route tree knows its context before first render:

```ts
// router.ts
import { createRouter, RootRoute, Route } from "@tanstack/react-router";
import { appConfig } from "./config";

const rootRoute = new RootRoute();
const indexRoute = new Route({ getParentRoute: () => rootRoute, path: "/" });

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute]),
  context: { basePath: "/" },  // placeholder, set by onReady
});

// Register before first render
appConfig.onReady((config) => {
  router.update({
    context: { basePath: config.ROUTER_BASEPATH },
  });
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

Then use the context in your components:

```tsx
const { basePath } = useRouterContext();
const href = `${basePath}/page`;
```

## MSW (Mock Service Worker)

Use config to control mock server setup in dev/test:

```ts
// config.ts
export const appConfig = attuneReact({
  schema: z.object({
    API_URL: z.string(),
    USE_MOCKS: z.boolean().default(import.meta.env.DEV),
  }),
  sources: [...],
  onLoad: (config) => {
    if (config.USE_MOCKS) {
      // MSW setup fires at module scope after config loads
      void import("./mocks/handlers").then((m) => {
        // start MSW worker
      });
    }
  },
});
```

Or register via `onReady` for non-render-critical setup:

```ts
// mocks/setup.ts
import { appConfig } from "../config";

appConfig.onReady((config) => {
  if (config.USE_MOCKS) {
    // Start MSW worker
  }
});
```

Import the setup module in your main entry so it registers at boot:

```ts
// main.tsx
import "./mocks/setup";  // runs onReady callbacks
import { createRoot } from "react-dom/client";
```

## Base + overrides (merged configs)

`merge` combines sources instead of falling through them: all run in parallel,
results shallow-merge, later sources win. Validation runs once, over the
merged result:

```ts
export const appConfig = attuneReact({
  schema,
  sources: [
    merge(fromJson("/config/base.json"), fromJson("/config/env.json")),
  ],
});
```

If the overrides file is optional, wrap it so a 404 means "no overrides"
instead of failing the merge:

```ts
const optional = (source: Source): Source => () =>
  Promise.resolve(source()).catch(() => undefined);

merge(fromJson("/config/base.json"), optional(fromJson("/config/env.json")))
```

The merge is shallow — a nested section in the override replaces the whole
section. For two configs with separate lifecycles, prefer separate `attune()`
instances over merging.

## Separate schemas

Two schemas ≠ one merged config. Each `attune()` instance owns one schema —
if two config files have independent shapes and consumers, give each its own
instance (see the kill switch below). If they form one logical config, compose
the schema instead and validate the merged result once:

```ts
const schema = z.object({ ...coreSchema.shape, ...featureSchema.shape });
```

## Dependent configs (config B's URL lives in config A)

A `Source` is just an async function, so it can await another instance.
Loading stays eager — B's fetch starts the moment A resolves, not at render
time:

```ts
export const appConfig = attune({ schema: appSchema, sources: [fromJson("/app-config.json")] });

export const featureConfig = attune({
  schema: featureSchema,
  sources: [async () => fromJson((await appConfig.load()).FEATURES_URL)()],
});
```

If A fails, B fails with the same `ConfigError` — surface both through the
same `errorFallback` or handle B's `load()` rejection separately.

### Module federation caveats

The dependent-config pattern is common with module federation (host config
carries remote entry/config URLs). Things that bite:

- **Eager load is only as eager as the module.** `attune()` at module scope of
  a *remote* runs when the remote chunk is loaded, not when the host boots —
  the waterfall becomes host config → remote JS → remote config → render. If
  a remote's config is known upfront, warm it from the host:
  `import("remote/config")` (fire-and-forget) as soon as the host config
  resolves.
- **Share the instance, not the library.** Two copies of attunement cost ~2 kB
  — irrelevant. What matters is the *instance*: a remote cannot read the
  host's Provider (different context). Either the host exposes its config
  handle as a federated module (`host/config`) and remotes import it, or each
  remote owns its config end-to-end. Don't mix per component.
- **Relative URLs resolve against the host origin.** `fromJson("/config.json")`
  inside a remote fetches from the *host's* domain. Remotes served from a
  different origin need absolute URLs — which is exactly what the dependent
  pattern provides (host config hands out full URLs).
- **No timeout on the chain.** `fromJson` timeouts are per fetch; the
  `await appConfig.load()` prefix waits as long as the host config does. If a
  remote must render even when the host config hangs, give it a fallback
  source after the dependent one.
- **Failure isolation.** A remote's `Provider` is its own error boundary —
  a failed remote config degrades that remote, not the host. Keep it that way:
  don't lift a remote's `load()` into the host's critical path.

## Second config instance (kill switch)

Each `attune()` call is independent — own sources, own cache. A separately
deployed `shutdown.json` read at boot:

```ts
export const shutdownConfig = attune({
  schema: z.object({ SHUTDOWN: z.boolean().default(false) }),
  sources: [fromJson("/shutdown.json", { retries: 0 })],
});
```

attunement loads once per instance by design — for mid-session polling, wrap
your own `setInterval` around a plain `fetch`, or reach for a feature-flag
service; that's their job.

## Testing patterns

### Baseline fixture (spread pattern)

Test multiple configs by spreading baseline overrides:

```ts
// config.test.ts
import { createTestProvider } from "attunement/testing";
import { appConfig } from "./config";

const baselineOverrides = {
  API_URL: "http://localhost:9999",
  LOG_LEVEL: "debug" as const,
};

describe("with prod config", () => {
  const TestProvider = createTestProvider(appConfig, baselineOverrides);
  
  it("shows alerts for high-severity logs", () => {
    render(<TestProvider><App /></TestProvider>);
    // ...
  });
});

describe("with disabled analytics", () => {
  const TestProvider = createTestProvider(appConfig, {
    ...baselineOverrides,
    ANALYTICS_ENABLED: false,
  });
  
  it("doesn't init analytics", () => {
    // ...
  });
});
```

### Async schema caveat

`attunement` validates synchronously — schemas must have sync validators.
If you're using a library with async validation (e.g., Zod with `refine` +
async function), call `parseAsync` during a separate setup step, not in the
schema passed to `attune()`:

```ts
// ❌ Don't: async validation in schema passed to attune()
const schema = z.object({
  API_URL: z.string().refine(async (url) => {
    const response = await fetch(url);
    return response.ok;  // async!
  }),
});

// ✅ Do: validate after config loads
const schema = z.object({ API_URL: z.string() });

export const appConfig = attuneReact({
  schema,
  onLoad: async (config) => {
    const response = await fetch(config.API_URL);
    if (!response.ok) throw new Error("API unreachable");
  },
});
```

### Distinguishing config schema from stamped metadata

If your deployment pipeline stamps `_version` into the config file, Zod's
`z.strictObject()` rejects it (extra keys). Use a loose schema and ignore
stamped keys:

```ts
// ❌ Don't: strictObject rejects _version
const schema = z.strictObject({
  API_URL: z.string(),
});

// ✅ Do: schema defines public keys, extras (like _version) are OK
const schema = z.object({
  API_URL: z.string(),
  // _version and _generatedAt are optional, automatically fingerprinted
}).passthrough();  // or just omit passthrough — extra keys are ignored by default
```

The fingerprint includes `_version` and `_generatedAt` automatically if present
in the raw config.
