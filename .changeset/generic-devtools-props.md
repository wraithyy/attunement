---
"attunement": patch
---

Make `DevtoolsProps`/`AttunementDevtoolsPanel`/`AttunementDevtools`/`attunementDevtoolsPlugin` generic over the config shape, so a devtools consumer typed with a concrete schema (e.g. `AttunedReact<RuntimeConfig, typeof schema>`) doesn't need a cast to pass its `attuneReact()` instance in.
