---
"attunement": patch
---

Devtools panel rows no longer stretch to the full TanStack Devtools shell
height. The shell applies `> * > * { height: 100% }` to plugin content, which
blew each field row up to ~400px; rows, buttons and the note now pin
`height: auto` inline.
