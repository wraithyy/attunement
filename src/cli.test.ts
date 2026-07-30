import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkConfig, diffKeys, docsTable, secretFindings } from "./cli.js";

const schema = z.object({
  API_URL: z.string().describe("Backend base URL"),
  LOG_LEVEL: z.enum(["debug", "info", "warn"]).default("warn").describe("Log verbosity"),
  MAX_PHOTOS: z.coerce.number().int().default(30),
  ENABLE_MOCKING: z.boolean().optional(),
});

describe("checkConfig", () => {
  it("passes a valid config", async () => {
    const result = await checkConfig(schema, { API_URL: "https://x" });
    expect(result.ok).toBe(true);
  });

  it("fails with per-key issues and did-you-mean", async () => {
    const result = await checkConfig(schema, { API_URl: "https://x" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("API_URL");
    expect(result.message).toContain('did you mean "API_URl"?');
  });
});

describe("diffKeys", () => {
  it("reports keys missing per file against the union", () => {
    const missing = diffKeys([
      { file: "prod.json", raw: { API_URL: "x", FLAG: true } },
      { file: "stage.json", raw: { API_URL: "y" } },
    ]);

    expect(missing).toEqual([{ file: "stage.json", key: "FLAG" }]);
  });

  it("empty when key sets agree", () => {
    expect(
      diffKeys([
        { file: "a.json", raw: { K: 1 } },
        { file: "b.json", raw: { K: 2 } },
      ])
    ).toEqual([]);
  });
});

describe("secretFindings", () => {
  it("flags suspicious key names", () => {
    const found = secretFindings({
      OAUTH_CLIENT_SECRET: "hello",
      API_TOKEN: "x",
      SAFE_LIMIT: 5,
    });

    const keys = found.map((f) => f.key);
    expect(keys).toContain("OAUTH_CLIENT_SECRET");
    expect(keys).toContain("API_TOKEN");
    expect(keys).not.toContain("SAFE_LIMIT");
  });

  it("flags high-entropy string values regardless of name", () => {
    const found = secretFindings({
      INNOCENT: "sk-9fB2xQ7pLm4vN8dK1jH6tR3wZ5yC0aEu",
      URL: "https://api.example.com/v1",
    });

    expect(found.map((f) => f.key)).toContain("INNOCENT");
    expect(found.map((f) => f.key)).not.toContain("URL");
  });
});

describe("docsTable", () => {
  it("renders a markdown table from a zod object schema", () => {
    const table = docsTable(schema);

    expect(table).toContain("| Key | Type | Default | Description |");
    expect(table).toContain("| `API_URL` | `string` | — | Backend base URL |");
    expect(table).toContain('| `LOG_LEVEL` | `"debug" \\| "info" \\| "warn"` | `"warn"` | Log verbosity |');
    expect(table).toContain("| `MAX_PHOTOS` | `number` | `30` |  |");
    expect(table).toContain("| `ENABLE_MOCKING` | `boolean` | — |  |");
  });

  it("throws a helpful error for non-introspectable schemas", () => {
    const opaque = { "~standard": { validate: () => ({ value: {} }) } };
    // duck-typed introspection needs a zod-like .shape
    expect(() => docsTable(opaque)).toThrow(/introspect/i);
  });
});
