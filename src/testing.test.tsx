import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";
import { attuneReact, ConfigError } from "./react.js";
import { createTestProvider } from "./testing.js";

const appConfig = attuneReact({
  schema: z.object({
    API_URL: z.string(),
    LOG_LEVEL: z.enum(["debug", "info", "warn"]).default("warn"),
  }),
  // never resolves — tests must not depend on the real load
  sources: [() => new Promise<never>(() => {})],
});

function Show() {
  const { API_URL, LOG_LEVEL } = appConfig.use();
  return (
    <span>
      {API_URL}:{LOG_LEVEL}
    </span>
  );
}

describe("createTestProvider", () => {
  it("provides overrides merged over schema defaults, synchronously", () => {
    const TestProvider = createTestProvider(appConfig, {
      API_URL: "https://test.example.com",
    });

    expect(
      renderToStaticMarkup(
        <TestProvider>
          <Show />
        </TestProvider>
      )
    ).toBe("<span>https://test.example.com:warn</span>");
  });

  it("throws ConfigError eagerly on invalid overrides, naming the key", () => {
    expect(() => createTestProvider(appConfig, {})).toThrow(ConfigError);
    expect(() => createTestProvider(appConfig, {})).toThrow("API_URL");
  });
});
