import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { attune, ConfigError, fromJson, fromWindow, merge, optional } from "./index.js";

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

describe("onReady", () => {
  const source = () => ({ API_URL: "https://x" });

  it("runs onLoad first, then onReady callbacks in registration order, before load() resolves", async () => {
    const order: string[] = [];
    const handle = attune({
      schema,
      sources: [source],
      onLoad: () => {
        order.push("onLoad");
      },
    });
    handle.onReady(() => {
      order.push("ready-1");
    });
    handle.onReady(() => {
      order.push("ready-2");
    });

    await handle.load();
    expect(order).toEqual(["onLoad", "ready-1", "ready-2"]);
  });

  it("receives config and fingerprint", async () => {
    const handle = attune({ schema, sources: [source] });
    const cb = vi.fn();
    handle.onReady(cb);

    await handle.load();
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ API_URL: "https://x" }),
      expect.objectContaining({ hash: expect.any(String) })
    );
  });

  it("a callback error rejects the load as ConfigError", async () => {
    const handle = attune({ schema, sources: [source] });
    handle.onReady(() => {
      throw new Error("router exploded");
    });

    await expect(handle.load()).rejects.toBeInstanceOf(ConfigError);
    await expect(handle.load()).rejects.toThrow(/router exploded/);
  });

  it("drains callbacks registered while another callback awaits", async () => {
    const order: string[] = [];
    const handle = attune({ schema, sources: [source] });
    handle.onReady(async () => {
      order.push("outer");
      await Promise.resolve();
      handle.onReady(() => {
        order.push("nested");
      });
    });

    await handle.load();
    expect(order).toEqual(["outer", "nested"]);
  });

  it("late registration runs immediately and warns in DEV", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handle = attune({ schema, sources: [source] });
    await handle.load();

    const cb = vi.fn();
    handle.onReady(cb);
    await Promise.resolve(); // late callbacks run in a microtask

    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ API_URL: "https://x" }),
      expect.anything()
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("onReady"));
    warn.mockRestore();
  });

  it("late registration on a rejected load is a no-op", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handle = attune({ schema, sources: [() => null] });
    await handle.load().catch(() => {});

    const cb = vi.fn();
    handle.onReady(cb);
    await new Promise((r) => setTimeout(r, 0));

    expect(cb).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("optional", () => {
  it("turns a throwing source into undefined so merge falls through", async () => {
    const merged = merge(
      () => ({ API_URL: "https://base" }),
      optional(() => {
        throw new Error("404");
      })
    );

    await expect(merged()).resolves.toEqual({ API_URL: "https://base" });
  });

  it("passes successful values through", async () => {
    await expect(optional(() => ({ K: 1 }))()).resolves.toEqual({ K: 1 });
  });
});

describe("fingerprint", () => {
  it("hashes the validated config, stable across key order", async () => {
    const a = await attune({
      schema,
      sources: [() => ({ API_URL: "https://x", LOG_LEVEL: "debug" })],
    }).fingerprint();
    const b = await attune({
      schema,
      sources: [() => ({ LOG_LEVEL: "debug", API_URL: "https://x" })],
    }).fingerprint();

    expect(a.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(a.hash).toBe(b.hash);
  });

  it("differs when values differ", async () => {
    const a = await attune({
      schema,
      sources: [() => ({ API_URL: "https://x" })],
    }).fingerprint();
    const b = await attune({
      schema,
      sources: [() => ({ API_URL: "https://y" })],
    }).fingerprint();

    expect(a.hash).not.toBe(b.hash);
  });

  it("picks _version and _generatedAt off the raw config", async () => {
    const loose = z.object({ API_URL: z.string() });
    const fingerprint = await attune({
      schema: loose,
      sources: [
        () => ({
          API_URL: "https://x",
          _version: "1.2.3",
          _generatedAt: "2026-07-31T10:00:00Z",
        }),
      ],
    }).fingerprint();

    expect(fingerprint.version).toBe("1.2.3");
    expect(fingerprint.generatedAt).toBe("2026-07-31T10:00:00Z");
  });

  it("omits meta keys when the raw config has none", async () => {
    const fingerprint = await attune({
      schema,
      sources: [() => ({ API_URL: "https://x" })],
    }).fingerprint();

    expect(fingerprint.version).toBeUndefined();
    expect(fingerprint.generatedAt).toBeUndefined();
  });

  it("passes the fingerprint to onLoad", async () => {
    const onLoad = vi.fn();
    await attune({
      schema,
      sources: [() => ({ API_URL: "https://x", _version: "7" })],
      onLoad,
    }).load();

    expect(onLoad).toHaveBeenCalledWith(
      expect.objectContaining({ API_URL: "https://x" }),
      expect.objectContaining({ hash: expect.any(String), version: "7" })
    );
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

  it("defaults cache: no-store, overridable via init", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await fromJson("/c.json")();
    expect(fetchMock).toHaveBeenCalledWith(
      "/c.json",
      expect.objectContaining({ cache: "no-store" })
    );

    await fromJson("/c.json", { cache: "default" })();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/c.json",
      expect.objectContaining({ cache: "default" })
    );
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
