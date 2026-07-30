import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { attune, ConfigError, fromJson, fromWindow } from "./index.js";

const schema = z.object({
  API_URL: z.string(),
  LOG_LEVEL: z.enum(["debug", "info", "warn"]).default("warn"),
});

describe("attune", () => {
  it("loads and validates config from first source", async () => {
    const config = await attune({
      schema,
      sources: [() => ({ API_URL: "https://api.example.com" })],
    }).load();

    expect(config).toEqual({
      API_URL: "https://api.example.com",
      LOG_LEVEL: "warn",
    });
  });

  it("falls through nullish and throwing sources", async () => {
    const config = await attune({
      schema,
      sources: [
        () => null,
        () => {
          throw new Error("boom");
        },
        () => ({ API_URL: "https://fallback.example.com" }),
      ],
    }).load();

    expect(config.API_URL).toBe("https://fallback.example.com");
  });

  it("rejects with ConfigError listing all source failures", async () => {
    const promise = attune({
      schema,
      sources: [
        () => null,
        () => {
          throw new Error("network down");
        },
      ],
    }).load();

    await expect(promise).rejects.toThrow(ConfigError);
    await expect(promise).rejects.toThrow("network down");
  });

  it("rejects with ConfigError on invalid config, naming the key", async () => {
    const promise = attune({
      schema,
      sources: [() => ({ API_URL: 42 })],
    }).load();

    await expect(promise).rejects.toThrow(ConfigError);
    await expect(promise).rejects.toThrow("API_URL");
  });

  it("caches — repeated load() returns the same promise, source runs once", async () => {
    const source = vi.fn(() => ({ API_URL: "https://api.example.com" }));
    const attuned = attune({ schema, sources: [source] });

    expect(attuned.load()).toBe(attuned.load());
    await attuned.load();
    expect(source).toHaveBeenCalledTimes(1);
  });

  it("runs onLoad with validated config before load() resolves", async () => {
    const seen: string[] = [];

    await attune({
      schema,
      sources: [() => ({ API_URL: "https://api.example.com" })],
      onLoad: (config) => {
        seen.push(config.API_URL, config.LOG_LEVEL);
      },
    }).load();

    expect(seen).toEqual(["https://api.example.com", "warn"]);
  });

  it("rejects when onLoad throws", async () => {
    const promise = attune({
      schema,
      sources: [() => ({ API_URL: "https://api.example.com" })],
      onLoad: () => {
        throw new Error("bootstrap failed");
      },
    }).load();

    await expect(promise).rejects.toThrow("bootstrap failed");
  });
});

describe("fromWindow", () => {
  it("reads a global, nullish when absent", () => {
    const key = "__ATTUNEMENT_TEST__";
    expect(fromWindow(key)()).toBeUndefined();

    (globalThis as Record<string, unknown>)[key] = { API_URL: "x" };
    expect(fromWindow(key)()).toEqual({ API_URL: "x" });
    delete (globalThis as Record<string, unknown>)[key];
  });
});

describe("fromJson", () => {
  it("fetches and parses JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ API_URL: "x" })))
    );

    expect(await fromJson("/app-config.json")()).toEqual({ API_URL: "x" });
    vi.unstubAllGlobals();
  });

  it("throws on non-2xx with url and status in message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 }))
    );

    await expect(fromJson("/app-config.json")()).rejects.toThrow(
      "/app-config.json: HTTP 503"
    );
    vi.unstubAllGlobals();
  });
});
