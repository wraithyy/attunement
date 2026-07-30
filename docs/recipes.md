# Recipes

Patterns that don't belong in the README's critical path but come up in real
apps.

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
