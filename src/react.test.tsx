import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";
import { attune } from "./index.js";
import { bindReact } from "./react.js";
import { createTestProvider } from "./testing.js";

const schema = z.object({
  API_URL: z.string(),
  LOG_LEVEL: z.enum(["debug", "info", "warn"]).default("warn"),
});

const pending = () => new Promise<never>(() => {});

describe("bindReact", () => {
  it("binds React over a core handle — schema types flow without user generics", () => {
    const core = attune({ schema, sources: [pending] });
    const bound = bindReact(core);
    const TestProvider = createTestProvider(bound, { API_URL: "https://x" });

    function Show() {
      // LOG_LEVEL narrows to the enum — compile-time proof of inference
      const { API_URL, LOG_LEVEL } = bound.use();
      return <span>{API_URL}:{LOG_LEVEL}</span>;
    }

    expect(
      renderToStaticMarkup(
        <TestProvider>
          <Show />
        </TestProvider>
      )
    ).toBe("<span>https://x:warn</span>");
  });

  it("shares the load but not the context — use() only works under its own Provider", () => {
    const core = attune({ schema, sources: [pending] });
    const a = bindReact(core);
    const b = bindReact(core);

    expect(a.load()).toBe(b.load()); // one cached load

    const ProvideB = createTestProvider(b, { API_URL: "https://x" });
    function ReadA() {
      a.use();
      return null;
    }

    expect(() =>
      renderToStaticMarkup(
        <ProvideB>
          <ReadA />
        </ProvideB>
      )
    ).toThrow(/outside <Provider>/);
  });
});
