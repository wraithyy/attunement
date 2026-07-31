---
"attunement": patch
---

`attunementDevtoolsPlugin`'s return type now declares `render: ReactElement` instead of `ReactNode` — `ReactNode` includes `undefined`, which the TanStack Devtools shell's `TanStackDevtoolsReactPlugin.render` (`JSX.Element | (...) => JSX.Element`) rejects. The panel always renders a real element, so the wider type was never earning its keep.
