---
"attunement": minor
---

v0.3 — CI story: `attunement` CLI. `check --schema <module> <files...>` validates config files against the app schema (same did-you-mean errors as runtime), `--diff` fails on top-level key drift between environments, secret hygiene warnings (credential-like names, high-entropy values), `docs` renders a markdown table of keys/types/defaults from a zod schema. New `attunement/cli` entry + `attunement` bin.
