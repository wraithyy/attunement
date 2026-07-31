# Recipes

Patterns that don't belong in the README's critical path but come up in real
apps.

- [Outside the React tree](#outside-the-react-tree) — OAuth clients, loggers, lazy services
- [All-strings config (env-var substitution)](#all-strings-config-env-var-substitution) — coercion recipe
- [Serving the config file per environment](#serving-the-config-file-per-environment) — Helm, nginx `envsubst`, CDN
- [Where to put app-config.json (per dev setup)](#where-to-put-app-configjson-per-dev-setup) — Vite, Angular, CRA, Astro
- [Other frameworks](#other-frameworks) — Angular `APP_INITIALIZER`, Vue provide/inject
- [Config check in the pipeline](#config-check-in-the-pipeline) — `attunement check` in CI
- [Base + overrides (merged configs)](#base--overrides-merged-configs) — `merge`, optional override file
- [Separate schemas](#separate-schemas) — compose vs. separate instances
- [Dependent configs](#dependent-configs-config-bs-url-lives-in-config-a) — config B's URL from config A, [module federation caveats](#module-federation-caveats)
- [Second config instance (kill switch)](#second-config-instance-kill-switch)

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

## Serving the config file per environment

Anything that can drop a JSON file next to the bundle (or inject a `<script>`
into `index.html`) works:

- **Kubernetes/Helm**: template `app-config.json` from a values file into a
  ConfigMap, mount it into the static-files directory of the serving container.
- **nginx entrypoint**: `envsubst < app-config.template.json >
  /usr/share/nginx/html/app-config.json` before `nginx -g 'daemon off;'`.
  Values arrive as strings — see the coercion recipe above.
- **Plain object storage/CDN**: upload a per-environment `app-config.json`
  next to the bundle in the deploy job.

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
