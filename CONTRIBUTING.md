# Contributing

Issues and PRs welcome.

## Setup

```sh
pnpm install
pnpm test        # Vitest
pnpm typecheck   # tsc --noEmit
pnpm build       # tsup → dist
```

All three must pass before pushing. Node ≥ 22.18 (the CLI relies on native
TS type stripping), pnpm 10.

## Workflow

- Gitflow: branch from `develop` (`feat/...`, `fix/...`), PR back to
  `develop`. `main` is release-only — `develop` → `main` PRs cut releases.
- Every user-facing change adds a changeset: `pnpm changeset` (patch/minor —
  pre-1.0, no majors). Releases are automated: merging the "Version Packages"
  PR publishes to npm via trusted publishing.
- Tests first for core behavior (source chain, validation, cache, CLI logic);
  React wiring has no coverage requirement.

## Ground rules (see CLAUDE.md for the full version)

- Core (`src/index.ts`) stays zero-dependency and framework-free — no React,
  no zod imports in runtime code (Standard Schema only; zod duck-typing is OK
  where introspection is unavoidable).
- New capability = new entry point (`src/foo.ts` + `tsup.config.ts` +
  `package.json#exports`), not a fatter existing object.
- TypeScript strict, no `any`; a cast needs a comment saying why.
- Error messages name the offending key.
