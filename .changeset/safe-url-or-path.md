---
"attunement": minor
---

New `safeUrlOrPath` predicate: refinement for config values that become
network targets — accepts same-origin paths and absolute http(s) URLs,
rejects protocol-relative URLs (`//evil`, `/\evil`), non-http schemes and
bare hostnames. Compose it via `.refine(safeUrlOrPath, ...)` with any
Standard Schema library. Plus hardening recipes: build-id cache-busting,
environment-dependent validation (`buildSchema({ isProd })` + superRefine),
and a localized error fallback built from `ConfigError.issues`.
