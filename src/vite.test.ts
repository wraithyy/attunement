import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attunement } from "./vite.js";

function fixture(content = '{"API_URL":"https://dev.example.com"}') {
  const dir = mkdtempSync(join(tmpdir(), "attunement-vite-"));
  const file = join(dir, "app-config.json");
  writeFileSync(file, content);
  return { dir, file };
}

// hooks are plain functions on the plugin object; call them like vite would
type HookFn = (...args: unknown[]) => unknown;
function hook(plugin: Record<string, unknown>, name: string): HookFn {
  const h = plugin[name];
  // vite hooks may be {handler} objects; ours are plain functions
  return h as HookFn;
}

describe("attunement vite plugin", () => {
  it("injects real config into html in dev, placeholder in build", () => {
    const { dir } = fixture();
    const plugin = attunement({
      configFile: "app-config.json",
      injectKey: "__APP_CONFIG__",
    }) as unknown as Record<string, unknown>;
    hook(plugin, "configResolved")({ root: dir });

    const dev = hook(plugin, "transformIndexHtml")("<html/>", { server: {} });
    expect(dev).toEqual([
      {
        tag: "script",
        children: 'window.__APP_CONFIG__ = {"API_URL":"https://dev.example.com"};',
        injectTo: "head-prepend",
      },
    ]);

    const build = hook(plugin, "transformIndexHtml")("<html/>", {});
    expect(build).toEqual([
      {
        tag: "script",
        children: 'window.__APP_CONFIG__ = "__ATTUNEMENT_CONFIG__";',
        injectTo: "head-prepend",
      },
    ]);
  });

  it("injects nothing when injectKey is off", () => {
    const plugin = attunement() as unknown as Record<string, unknown>;
    expect(hook(plugin, "transformIndexHtml")("<html/>", {})).toBeUndefined();
  });

  it("serves the config file and full-reloads on change", () => {
    const { dir, file } = fixture();
    const plugin = attunement({ configFile: "app-config.json" }) as unknown as Record<string, unknown>;
    hook(plugin, "configResolved")({ root: dir });

    const middlewares: { route: string; handler: (req: unknown, res: unknown) => void }[] = [];
    const sent: unknown[] = [];
    const changeHandlers: ((file: string) => void)[] = [];
    hook(plugin, "configureServer")({
      watcher: {
        add: () => {},
        on: (_event: string, cb: (file: string) => void) => changeHandlers.push(cb),
      },
      ws: { send: (msg: unknown) => sent.push(msg) },
      middlewares: {
        use: (route: string, handler: (req: unknown, res: unknown) => void) =>
          middlewares.push({ route, handler }),
      },
    });

    // serve
    const headers: Record<string, string> = {};
    let body = "";
    middlewares[0]?.handler(
      {},
      {
        setHeader: (k: string, v: string) => (headers[k] = v),
        end: (b: Buffer | string) => (body = b.toString()),
      }
    );
    expect(middlewares[0]?.route).toBe("/app-config.json");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(body)).toEqual({ API_URL: "https://dev.example.com" });

    // reload on change of the config file, not on other files
    changeHandlers.forEach((cb) => cb(join(dir, "other.json")));
    expect(sent).toEqual([]);
    changeHandlers.forEach((cb) => cb(file));
    expect(sent).toEqual([{ type: "full-reload" }]);
  });
});
