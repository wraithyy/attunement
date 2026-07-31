import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react.tsx",
    testing: "src/testing.tsx",
    cli: "src/cli.ts",
    bin: "src/bin.ts",
    devtools: "src/devtools.tsx",
    vite: "src/vite.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["react"],
});
