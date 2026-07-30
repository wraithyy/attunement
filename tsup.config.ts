import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", react: "src/react.tsx", testing: "src/testing.tsx" },
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["react"],
});
