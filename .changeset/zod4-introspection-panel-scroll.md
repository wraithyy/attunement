---
"attunement": patch
---

Fix devtools panel for Zod 4 schemas and overflowing content:

- Schema introspection (`introspectShape`, `docsTable`, devtools form) now reads
  both Zod 3 (`_def.typeName`, enum `values`, default thunk) and Zod 4
  (`_def.type`, enum `entries`, plain default value) internals. With Zod 4,
  booleans render as checkboxes and enums as populated selects again instead of
  falling back to plain text inputs.
- The panel scrolls its own overflow (`max-height` + `overflow-y: auto`), so all
  fields and the Save/Clear buttons stay reachable inside the TanStack Devtools
  shell's fixed-height, `overflow: hidden` container — and the standalone
  floating widget caps at 70vh.
