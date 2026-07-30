import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { attune, ConfigError, fromJson, fromWindow, merge } from "./index.js";

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

  it("suggests the nearest raw key on validation failure (did-you-mean)", async () => {
    const promise = attune({
      schema,
      sources: [() => ({ API_URl: "https://api.example.com" })],
    }).load();

    await expect(promise).rejects.toThrow('did you mean "API_URl"?');
  });

  it("deep-freezes the loaded config", async () => {
    const config = await attune({
      schema: z.object({
        API_URL: z.string(),
        FLAGS: z.object({ beta: z.boolean() }),
      }),
      sources: [() => ({ API_URL: "x", FLAGS: { beta: true } })],
    }).load();

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.FLAGS)).toBe(true);
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

describe("merge", () => {
  it("shallow-merges all source results, later sources win", async () => {
    const source = merge(
      () => ({ API_URL: "https://base.example.com", LOG_LEVEL: "info" }),
      () => ({ API_URL: "https://env.example.com" })
    );

    expect(await source()).toEqual({
      API_URL: "https://env.example.com",
      LOG_LEVEL: "info",
    });
  });

  it("merge order follows call order, not resolution order", async () => {
    const slow = () =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ API_URL: "https://slow-base.example.com" }), 20)
      );
    const fast = () => ({ API_URL: "https://fast-override.example.com" });

    // fast resolves first but is specified last — it must still win
    expect(await merge(slow, fast)()).toEqual({
      API_URL: "https://fast-override.example.com",
    });
  });

  it("skips nullish parts, nullish when all parts are nullish", async () => {
    expect(
      await merge(() => undefined, () => ({ API_URL: "x" }), () => null)()
    ).toEqual({ API_URL: "x" });
    expect(await merge(() => undefined, () => null)()).toBeUndefined();
  });

  it("propagates a throwing part (so the source chain can fall through)", async () => {
    const source = merge(() => ({ API_URL: "x" }), () => {
      throw new Error("overrides down");
    });

    await expect(source()).rejects.toThrow("overrides down");
  });

  it("validates the merged result through attune", async () => {
    const config = await attune({
      schema,
      sources: [
        merge(
          () => ({ API_URL: "https://base.example.com" }),
          () => ({ LOG_LEVEL: "debug" })
        ),
      ],
    }).load();

    expect(config).toEqual({
      API_URL: "https://base.example.com",
      LOG_LEVEL: "debug",
    });
  });
});

describe("dependent configs", () => {
  it("a source can await another attuned instance", async () => {
    const base = attune({
      schema: z.object({ FEATURES_URL: z.string() }),
      sources: [() => ({ FEATURES_URL: "/features.json" })],
    });
    const features = attune({
      schema: z.object({ BETA: z.boolean().default(false) }),
      sources: [async () => ({ BETA: (await base.load()).FEATURES_URL === "/features.json" })],
    });

    expect((await features.load()).BETA).toBe(true);
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

    await expect(fromJson("/app-config.json", { retries: 0 })()).rejects.toThrow(
      "/app-config.json: HTTP 503"
    );
    vi.unstubAllGlobals();
  });

  it("retries 5xx and network errors until a source succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 503 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ API_URL: "x" })));
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await fromJson("/app-config.json", { retries: 2, backoffMs: 0 })()
    ).toEqual({ API_URL: "x" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it("does not retry 4xx", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fromJson("/app-config.json", { retries: 3, backoffMs: 0 })()
    ).rejects.toThrow("HTTP 404");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("reports attempt count when retries are exhausted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 }))
    );

    await expect(
      fromJson("/app-config.json", { retries: 2, backoffMs: 0 })()
    ).rejects.toThrow("3 attempts");
    vi.unstubAllGlobals();
  });

  it("retries when the body read fails after headers arrived", async () => {
    const brokenBody = {
      ok: true,
      json: () => Promise.reject(new TypeError("network error during body read")),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(brokenBody)
      .mockResolvedValueOnce(new Response(JSON.stringify({ API_URL: "x" })));
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await fromJson("/app-config.json", { retries: 1, backoffMs: 0 })()
    ).toEqual({ API_URL: "x" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("does not retry when the caller's own signal aborted", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_: string, init: RequestInit) => {
      controller.abort();
      return Promise.reject(init.signal?.reason ?? new Error("aborted"));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fromJson("/app-config.json", {
        retries: 3,
        backoffMs: 0,
        signal: controller.signal,
      })()
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("aborts an attempt after timeoutMs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason)
            );
          })
      )
    );

    await expect(
      fromJson("/app-config.json", { timeoutMs: 10, retries: 0 })()
    ).rejects.toThrow(/timeout|timed out/i);
    vi.unstubAllGlobals();
  });
});
