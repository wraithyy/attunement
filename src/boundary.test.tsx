// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { attuneReact, ConfigError, overridesRegistry } from "./react.js";
import { fromOverrides, OverrideRecovery } from "./devtools.js";
import { Component, type ReactNode } from "react";

beforeEach(() => {
  overridesRegistry().length = 0; // registry lives on globalThis — isolate tests
  localStorage.clear();
});

const schema = z.object({ API_URL: z.string() });

function makeConfig(sources: Parameters<typeof attuneReact>[0]["sources"]) {
  return attuneReact({ schema, sources });
}

class OuterBoundary extends Component<
  { children: ReactNode; seen: (e: Error) => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      this.props.seen(this.state.error);
      return <p>outer caught</p>;
    }
    return this.props.children;
  }
}

async function render(ui: ReactNode) {
  const el = document.createElement("div");
  const root = createRoot(el);
  // boundary errors log noisily via console.error — keep test output clean
  const silence = vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () => root.render(ui));
  silence.mockRestore();
  return el;
}

describe("ConfigBoundary", () => {
  it("renders the default fallback with a working Retry on config failure", async () => {
    const config = makeConfig([() => Promise.reject(new Error("outage"))]);
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });

    const el = await render(
      <config.Provider>
        <span>never</span>
      </config.Provider>
    );

    expect(el.textContent).toContain("Configuration failed to load.");
    const button = el.querySelector("button");
    expect(button?.textContent).toBe("Retry");
    await act(async () => button?.click());
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("calls onError once with the ConfigError", async () => {
    const config = makeConfig([() => Promise.reject(new Error("outage"))]);
    const onError = vi.fn();

    await render(
      <config.Provider errorFallback={null} onError={onError}>
        <span>never</span>
      </config.Provider>
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(ConfigError);
  });

  it("passes retry to a function errorFallback", async () => {
    const config = makeConfig([() => Promise.reject(new Error("outage"))]);
    let gotRetry: unknown;

    const el = await render(
      <config.Provider
        errorFallback={(error, retry) => {
          gotRetry = retry;
          return <i>{error.name}</i>;
        }}
      >
        <span>never</span>
      </config.Provider>
    );

    expect(el.textContent).toBe("ConfigError");
    expect(typeof gotRetry).toBe("function");
  });

  it("offers 'Clear overrides and reload' when a fromOverrides handler reports overrides — custom storageKey included", async () => {
    // custom key: regression for the hardcoded-default-key gap (report #3 F2)
    localStorage.setItem("custom:overrides", JSON.stringify({ MAX: "abc" }));
    fromOverrides("custom:overrides");
    const config = makeConfig([() => Promise.reject(new Error("outage"))]);
    const reload = vi.fn();
    const originalLocation = location;
    vi.stubGlobal("location", { ...originalLocation, href: originalLocation.href, reload });

    const el = await render(
      <config.Provider>
        <span>never</span>
      </config.Provider>
    );

    expect(el.textContent).toContain("Dev overrides are active");
    expect(el.textContent).toContain('MAX = "abc"');
    const clear = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.startsWith("Clear overrides")
    );
    await act(async () => clear?.click());
    expect(localStorage.getItem("custom:overrides")).toBeNull();
    expect(reload).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("clearing also strips config.* params from the URL (report #3 F1)", async () => {
    localStorage.setItem("attunement:overrides", JSON.stringify({ MAX: "abc" }));
    fromOverrides();
    const config = makeConfig([() => Promise.reject(new Error("outage"))]);
    const reload = vi.fn();
    history.replaceState(null, "", "/form?config.MAX=abc&other=1");
    // keep the real origin — jsdom rejects replaceState to a foreign one
    vi.stubGlobal("location", { href: document.URL, reload });

    const el = await render(
      <config.Provider>
        <span>never</span>
      </config.Provider>
    );
    const clear = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.startsWith("Clear overrides")
    );
    await act(async () => clear?.click());

    // the URL bootstrap must not reseed storage on the reload
    expect(window.history.state).toBeNull();
    expect(document.location.pathname + document.location.search).toBe("/form?other=1");
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("shows no overrides block when no handler reports any", async () => {
    fromOverrides();
    const config = makeConfig([() => Promise.reject(new Error("outage"))]);
    const el = await render(
      <config.Provider>
        <span>never</span>
      </config.Provider>
    );
    expect(el.textContent).not.toContain("Dev overrides");
  });

  it("OverrideRecovery renders the same recovery for custom fallbacks, null without overrides", async () => {
    const empty = await render(<OverrideRecovery />);
    expect(empty.textContent).toBe("");

    localStorage.setItem("attunement:overrides", JSON.stringify({ K: 1 }));
    fromOverrides();
    const el = await render(<OverrideRecovery />);
    expect(el.textContent).toContain("Dev overrides are active");
    expect(el.textContent).toContain("K = 1");
  });

  it("rethrows app bugs to the outer boundary instead of masking them", async () => {
    const config = makeConfig([() => ({ API_URL: "https://x" })]);
    const outerSaw = vi.fn();
    const configOnError = vi.fn();

    function Buggy(): ReactNode {
      throw new Error("app bug");
    }

    const el = await render(
      <OuterBoundary seen={outerSaw}>
        <config.Provider onError={configOnError}>
          <Buggy />
        </config.Provider>
      </OuterBoundary>
    );

    expect(el.textContent).toBe("outer caught");
    expect(outerSaw).toHaveBeenCalledWith(
      expect.objectContaining({ message: "app bug" })
    );
    // the app bug is not the config boundary's business
    expect(configOnError).not.toHaveBeenCalled();
  });
});
