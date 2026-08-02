import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      cli: "src/cli.ts",
      bin: "src/bin.ts",
      vite: "src/vite.ts",
    },
    format: ["esm"],
    dts: true,
    clean: true,
  },
  {
    // React entries are client-only (createContext, class boundary) — the
    // banner keeps them importable in RSC-enabled Vite apps. Core/cli stay
    // external: bundling a second copy would break instanceof ConfigError
    // across entry points.
    entry: {
      react: "src/react.tsx",
      testing: "src/testing.tsx",
      devtools: "src/devtools.tsx",
    },
    format: ["esm"],
    dts: true,
    external: ["react", "./index.js", "./cli.js", "./react.js"],
    banner: { js: '"use client";' },
  },
]);
