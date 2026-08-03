---
"attunement": patch
---

Field report #2 fixes:

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
