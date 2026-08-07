---
"attunement": patch
---

Validation error messages drop the "you didn't say the magic word" easter egg
in production builds — custom errorFallbacks render `error.message` to end
users, and a broken deploy is not a dev-only situation. Dev builds and the
CLI keep it. For localized error UIs, build from `ConfigError.issues`
instead of `error.message`. Docs: `OverrideRecovery` usage is shown
DEV-gated (ungated renders null in production but ships the devtools bytes).
