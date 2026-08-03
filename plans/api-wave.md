# API wave — field report P3, P10, P11, P12/P13 + panel round 2

## Context

Field report (untracked field report) identified structural issues that need API
additions, not docs: module cycles around `onLoad` (P3), config module as a
React/CLI choke point (P10), no path out of a rejected load (P11), test
provider ergonomics (P12/P13). All additive — one minor release.

Validated twice by a 6-persona panel (junior/medior/senior FE, fullstack/ops,
library author, React specialist): round 1 on the planned API, round 2 on the
whole concept. Verdict: architecture unanimously sound; all features ship;
round-2 additions folded in below. Ponytail audit: repo lean, minor cuts
folded into tasks.

Decisions (grilled 2026-07-31 + panel):

- **One callback queue, two names.** `onReady(cb)` is the mechanism;
  `options.onLoad` becomes sugar for a callback registered first. Same
  machinery, same guarantees — never two execution tiers. `onLoad` name
  stays (no deprecation).
- **onReady late registration:** run immediately via the cached promise +
  `console.warn` in DEV. Late-callback errors must surface loudly in prod
  too (unhandled rejection is fine, silence is not); on an already-rejected
  load, late callbacks no-op.
- **onReady errors** (timely registration): reject the load promise — broken
  render-critical wiring should hit `errorFallback`, not render a broken
  tree. Docs must give the counter-recipe for non-critical wiring
  (analytics: try/catch inside the callback, or `.load().then()`).
- **bindReact:** new export; `attuneReact(options)` stays as the convenience
  wrapper and the primary documented shape (junior/medior/library author
  overruled senior's bindReact-first). No deprecation.
- **P11 retry:** `retry: () => void` (required param), passed to function
  `errorFallback` as 2nd arg + Retry button in the default fallback.
  Contract wording in the type docs: "recovers by any means; currently a
  full page reload." No cache-dropping `reload()`.
- **ConfigBoundary scope** (round 2): rethrow errors that aren't
  `ConfigError` — the boundary must not misdiagnose app bugs as config
  failures; add `onError?: (error: Error) => void` on ProviderProps for
  Sentry-style reporting.
- **fromJson defaults** (round 2): `cache: "no-store"` by default — a
  CDN-cached stale config is the worst incident this library can cause, and
  it makes Retry a loop. Overridable via RequestInit as before.
- **Types** (round 2): `@standard-schema/spec` moves to `dependencies`
  (types-only, zero runtime) — public d.ts imports it; consumers without a
  transitive copy get TS2307.
- **P12/P13 testing:** no new API. Baseline fixture is userland spread;
  async schemas stay sync-only with a clearer error + documented caveat.

## Requirements

1. `onReady(cb)` on the core handle: single queue shared with `onLoad`,
   callbacks awaited in registration order before `load()` resolves.
   Callback errors reject the load. Post-resolve registration: invoke
   immediately, DEV warn, errors surface, no-op on rejected load.
2. `bindReact(attuned)` in `attunement/react`: React binding over an existing
   core handle. Requires `_schema` on the core handle. Each `bindReact` call
   is an independent binding (own context) over the same shared load —
   document, don't guard.
3. `errorFallback(error, retry)`; default fallback gets a Retry button;
   boundary rethrows non-ConfigError; `onError` prop.
4. Core extras: `optional(source)` export (recipe → API), `cache: "no-store"`
   default in fromJson, spec package in dependencies.
5. Devtools/CLI extras: `fields?: FieldInfo[]` override on DevtoolsProps and
   docsTable (Valibot / zod-5 escape hatch, no plugin system); `check
   --strict` (secret warnings fail the job); `check --print-fingerprint`
   (hash + version per file for deploy logs); `"use client"` banner on React
   entries.
6. Docs: three-file layout, onReady rules, testing patterns, caching
   contract, quick-start cleanup (no dead fromWindow), HMR note.

## Risks

- **`_schema` generic threading** — defaulted generic compiles unchanged for
  annotations, but the new required property breaks hand-built mocks —
  changelog note required.
- **Inference footgun** — annotating the handle erases `S`; `bindReact` then
  infers `unknown`. Docs: "let inference flow."
- **Queue draining** — callbacks can be registered while another callback
  awaits. Drain with an index loop, set the resolved flag only after the
  drain settles; clear the array afterwards (GC). Test nested registration.
- **DEV detection** — dotted `process.env.NODE_ENV` literal OR
  `import.meta.env?.DEV` (fixed in react.tsx; hoist to a shared `@internal`
  const in index.ts when core needs it — ponytail audit).
- **no-store default** — behavior change for existing users (more origin
  hits); changeset must call it out with the opt-out
  (`fromJson(url, { cache: "default" })`).
- Rejected ideas, do not resurrect:
  - P1 mount-order DEV warning (false-positives with fast sources)
  - WeakMap/symbol for `_schema` (dual-package hazard; inference needs the
    property)
  - memoization guard on double `bindReact` (docs sentence suffices)
  - `Source` AbortSignal parameter — adding a callback parameter later is
    semver-safe (old sources ignore extra args); YAGNI now
  - renames `merge` → `mergeSources`, vite `attunement()` → other (churn
    without gain; vite export is the `react()`-style idiom)
  - core `onError` option (document `appConfig.load().catch(report)` at
    module scope instead)
  - `onLoad` name deprecation
  - pluggable introspection interface (the `fields` param is the out)
  - `check --format json`/junit (real value, next wave)
  - privatizing `attunement/cli` entry (kept — `checkConfig` is useful
    programmatically; `introspectShape` already `@internal`)

## Tasks

## Task 1.1: onReady + unified callback queue in attune()
- **Agent**: tdd-guide
- **Files**: src/index.ts, src/index.test.ts
- **Depends on**: none
- **Acceptance**: pnpm test — onLoad runs first, then onReady in registration
  order, all before load() resolves; callback error rejects load; callback
  registering another callback during its await is drained before resolve;
  late registration runs immediately + DEV warns; late callback on rejected
  load no-ops; late callback error not swallowed; registry cleared after
  flush; receives (config, fingerprint).
- **Prompt seed**: Replace direct `await options.onLoad?.()` with a queue:
  options.onLoad enqueued first, `onReady(cb)` appends. Drain by index
  inside the load chain, flag resolved after the drain, clear the array.
  Post-resolve onReady: invoke via cached promise, console.warn in DEV
  (hoist shared `@internal DEV` const, dotted process.env.NODE_ENV +
  import.meta.env?.DEV), skip when load rejected. Tests first.

## Task 1.2: Expose _schema on the core handle
- **Agent**: build-error-resolver (mechanical)
- **Files**: src/index.ts, src/react.tsx, src/devtools.tsx, src/testing.tsx
- **Depends on**: none
- **Acceptance**: pnpm typecheck — Attuned<T, S = StandardSchemaV1> carries
  `_schema: S` (`@internal`); AttunedReact inherits it; devtools/testing
  compile unchanged.
- **Prompt seed**: Move `_schema` from AttunedReact down to Attuned
  (defaulted second generic). attune() stores options.schema on the handle.

## Task 1.3: Core extras — optional(), no-store, spec dependency, hygiene
- **Agent**: tdd-guide
- **Files**: src/index.ts, src/index.test.ts, package.json, CLAUDE.md
- **Depends on**: none
- **Acceptance**: pnpm test — `optional(source)` exported (nullish → skip,
  matching the recipe semantics) with tests; fromJson defaults
  `cache: "no-store"` (overridable, test asserts fetch init); package.json
  moves @standard-schema/spec to dependencies; `Source` type written
  honestly (`() => unknown | Promise<unknown>` collapses — use the real
  shape); globalThis cast in fromWindow gets its justifying comment;
  CLAUDE.md "core ~100 lines" corrected to reality.
- **Prompt seed**: Promote the `optional()` recipe to an export next to
  merge(). Add `cache: "no-store"` to fromJson's fetch defaults (RequestInit
  spread must still override). Move the spec package to dependencies.

## Task 2.1: bindReact(attuned)
- **Agent**: react-expert
- **Files**: src/react.tsx, src/react.test.tsx (create if missing)
- **Depends on**: 1.2
- **Acceptance**: pnpm test + typecheck — attuneReact === bindReact(attune());
  S inferred from `_schema` (no user generics); devtools plugin accepts a
  bindReact result; two bindings over one handle = independent contexts,
  shared load (tested).
- **Prompt seed**: Extract the binding body into
  `bindReact<S>(attuned: Attuned<InferOutput<S>, S>): AttunedReact<...>` —
  `_schema` is the inference site. attuneReact = bindReact(attune(options)).
  JSDoc: independent binding per call; use() only under its own Provider.

## Task 2.2: ConfigBoundary — retry, ConfigError-only, onError
- **Agent**: react-expert
- **Files**: src/react.tsx, react test file
- **Depends on**: none
- **Acceptance**: pnpm typecheck + test — errorFallback fn form
  `(error: Error, retry: () => void) => ReactNode` (required param, one-arg
  fns stay assignable); DefaultErrorFallback has a Retry button (test stubs
  location.reload); boundary rethrows non-ConfigError to outer boundaries
  (tested); ProviderProps gains `onError?: (error: Error) => void` called
  from componentDidCatch.
- **Prompt seed**: Thread `retry = () => location.reload()`. In
  getDerivedStateFromError keep only ConfigError; rethrow others on render.
  Add componentDidCatch → props.onError. Type-doc retry contract: "recovers
  by any means; currently a full page reload."

## Task 2.3: Devtools/CLI extras — fields override, --strict, --print-fingerprint
- **Agent**: react-expert (devtools) + nodejs-expert (bin) — two small PRs or one
- **Files**: src/devtools.tsx, src/cli.ts, src/bin.ts, src/cli.test.ts
- **Depends on**: none
- **Acceptance**: pnpm test — DevtoolsProps and docsTable accept
  `fields?: FieldInfo[]` bypassing introspection (tested with a fake
  Valibot-like schema); `check --strict` exits 1 on secret findings;
  `check --print-fingerprint` prints `<file> <hash> [version]` per file
  using the same stableStringify/fnv1a as the runtime (extract to cli.ts,
  import in index.ts — no duplication); devtools overrides helpers
  (readOverrides/writeOverrides/clearOverrides) marked `@internal`
  (ponytail audit).
- **Prompt seed**: `fields` param wins over introspectShape when provided.
  Move stableStringify+fnv1a to a shared internal module or export
  `@internal` from index. Wire two flags in bin.ts parseArgs.

## Task 2.4: "use client" banner
- **Agent**: build-error-resolver (mechanical)
- **Files**: tsup.config.ts
- **Depends on**: none
- **Acceptance**: pnpm build — dist/react.js, dist/devtools.js,
  dist/testing.js start with `"use client";` (banner option per entry);
  core/cli/vite/bin unchanged.

## Task 3.1: Docs — three-file layout, onReady rules, caching, quick start
- **Agent**: doc-updater
- **Files**: README.md, docs/recipes.md
- **Depends on**: 1.1, 1.3, 2.1
- **Acceptance**: README/recipes contain, example-first:
  - quick start: fromJson only; fromWindow moves to a combined
    "zero-request injection" section with the Vite plugin + injectKey
    (today's first line is silently dead without it — junior finding)
  - the dumb rule: "wiring in the config module → onLoad; wiring in another
    module → onReady" + analytics counter-recipe (try/catch or
    .load().then())
  - eager-import warning: onReady module must be statically imported by
    main.tsx or the callback registers late
  - "onReady does not run under createTestProvider" — explicit
  - three-file layout INSIDE the CI-check section; bindReact labelled
    "you don't need this yet"; inference footgun ("let inference flow")
  - retry = full page reload, said loudly
  - "Serving the config file" caching contract section: Cache-Control
    no-store at CDN/nginx + exact placeholder-replace one-liners
    (envsubst/sed quoting) — promoted from the Retry footnote
  - error reporting pattern: `appConfig.load().catch(report)` +
    Provider onError
  - TanStack Router basepath + MSW recipes; HMR note (config module edits
    full-reload by design)
  - test baseline spread; async-schema caveat; `z.strictObject` vs stamped
    `_version` caveat; CLI schema module: relative imports only + Node/tsx
    loading note
- **Prompt seed**: Update README (API table, quick start, CI section) and
  recipes per the acceptance list. Terse, example-first, English.

## Task 3.2: Changeset + field report cross-off
- **Agent**: main session
- **Files**: .changeset/*.md, the untracked field report
- **Depends on**: all
- **Acceptance**: minor changeset covering onReady/bindReact/retry/onError/
  optional/no-store/--strict/--print-fingerprint/fields + changelog notes:
  "Attuned hand-built mocks need _schema/onReady", "fromJson now defaults
  cache: no-store (override with { cache: 'default' })"; the field report gets
  "addressed in" notes per item.

## Out of scope

- Cache-dropping `reload()` (retry contract wording keeps the door open)
- `createTestProvider` base/factory API; async schema support in tests
- Deprecating `attuneReact` or the `onLoad` name
- `check --format json`/junit (next wave)
- Vue/Svelte adapters; module-federation dedup story
- Vite plugin build-time JSON Schema emit / build-time check (nice, next wave)
- Everything in Risks → "Rejected ideas"

## Verification

1. `pnpm typecheck && pnpm test && pnpm build`
2. Repro app (scratchpad/repro): wiring via `appConfig.onReady()` from a
   second module — no cycle, runs before first render.
3. Kill the config URL → default fallback shows Retry; click reloads. Throw
   in a child component → outer boundary catches it, not ConfigBoundary.
4. `attunement check --schema` against a schema-only module; `--strict`
   fails on a secret-looking key; `--print-fingerprint` matches the hash the
   running app reports via `fingerprint()`.
5. DEV guard: `vite dev` shows error detail in the default fallback;
   `vite build && preview` hides it.
6. `dist/react.js` starts with `"use client"`.
