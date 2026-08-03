import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { attune, merge } from "./index.js";
import {
  attunementDevtoolsPlugin,
  clearOverrides,
  fromOverrides,
  readOverrides,
  writeOverrides,
} from "./devtools.js";

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

function stubLocation(search: string) {
  vi.stubGlobal("location", { search });
}

afterEach(() => vi.unstubAllGlobals());

describe("fromOverrides", () => {
  it("reads overrides from localStorage", async () => {
    stubStorage({ "attunement:overrides": JSON.stringify({ LOG_LEVEL: "debug" }) });
    stubLocation("");

    expect(await fromOverrides()()).toEqual({ LOG_LEVEL: "debug" });
  });

  it("bootstraps ?config.KEY=value URL params into overrides (JSON-parsed, string fallback)", async () => {
    const store = stubStorage();
    stubLocation("?config.LOG_LEVEL=debug&config.MAX=5&other=x");

    expect(await fromOverrides()()).toEqual({ LOG_LEVEL: "debug", MAX: 5 });
    // persisted, so the override survives navigation without the param
    expect(JSON.parse(store.get("attunement:overrides") ?? "{}")).toEqual({
      LOG_LEVEL: "debug",
      MAX: 5,
    });
  });

  it("ignores prototype-polluting URL keys", async () => {
    stubStorage();
    stubLocation('?config.__proto__={"polluted":1}&config.SAFE=1');

    expect(await fromOverrides()()).toEqual({ SAFE: 1 });
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("URL params win over stored overrides; nullish when there are none", async () => {
    stubStorage({ "attunement:overrides": JSON.stringify({ MAX: 1 }) });
    stubLocation("?config.MAX=2");
    expect(await fromOverrides()()).toEqual({ MAX: 2 });

    stubStorage();
    stubLocation("");
    expect(await fromOverrides()()).toBeUndefined();
  });

  it("merges over the app source and validates the result", async () => {
    stubStorage({ "attunement:overrides": JSON.stringify({ LOG_LEVEL: "debug" }) });
    stubLocation("");

    const config = await attune({
      schema: z.object({
        API_URL: z.string(),
        LOG_LEVEL: z.enum(["debug", "info", "warn"]).default("warn"),
      }),
      sources: [merge(() => ({ API_URL: "https://x" }), fromOverrides())],
    }).load();

    expect(config).toEqual({ API_URL: "https://x", LOG_LEVEL: "debug" });
  });
});

describe("overrides storage helpers", () => {
  it("write/read/clear round-trip with a custom key", () => {
    stubStorage();
    writeOverrides({ A: 1 }, "custom");
    expect(readOverrides("custom")).toEqual({ A: 1 });
    clearOverrides("custom");
    expect(readOverrides("custom")).toEqual({});
  });
});

describe("attunementDevtoolsPlugin", () => {
  // regression: DevtoolsProps must accept the CORE handle — AttunedReact is
  // invariant in T (its context), so a typed React handle used to fail tsc,
  // and bindReact users had to export a bound handle just for devtools
  it("accepts a typed core attune() handle", () => {
    const core = attune({
      schema: z.object({
        API_URL: z.string(),
        LOG_LEVEL: z.enum(["debug", "info", "warn"]).default("warn"),
      }),
      sources: [() => new Promise<never>(() => {})],
    });

    const plugin = attunementDevtoolsPlugin(core);
    expect(plugin.name).toBe("Attunement");
  });
});
