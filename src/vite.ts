import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

export interface AttunementViteOptions {
  /** Config file served in dev and injected into index.html. Default "config/app-config.json". */
  configFile?: string;
  /** URL the file is served at in dev. Default "/app-config.json". */
  url?: string;
  /**
   * Inject `<script>window[key] = <config>;</script>` into index.html for
   * fromWindow deploys. Dev gets the real file content; the build gets
   * `buildPlaceholder` for the deploy pipeline to replace. Off by default.
   */
  injectKey?: string | false;
  /** Raw JS injected as the value in builds. Default `"__ATTUNEMENT_CONFIG__"` (a string literal placeholder). */
  buildPlaceholder?: string;
}

/**
 * Vite plugin: serves the config file on the dev server (full reload when it
 * changes) and optionally injects it into index.html for fromWindow.
 *
 *   // vite.config.ts
 *   import { attunement } from "attunement/vite";
 *   export default defineConfig({ plugins: [attunement()] });
 */
export function attunement(options: AttunementViteOptions = {}): Plugin {
  const {
    configFile = "config/app-config.json",
    url = "/app-config.json",
    injectKey = false,
    buildPlaceholder = '"__ATTUNEMENT_CONFIG__"',
  } = options;

  let configPath = resolve(configFile);

  return {
    name: "attunement",

    configResolved(config) {
      configPath = resolve(config.root, configFile);
    },

    configureServer(server) {
      server.watcher.add(configPath);
      server.watcher.on("change", (file) => {
        if (file === configPath) {
          server.ws.send({ type: "full-reload" });
        }
      });

      server.middlewares.use(url, (_req, res) => {
        try {
          const body = readFileSync(configPath);
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(body);
        } catch {
          res.statusCode = 404;
          res.end(`attunement: ${configFile} not found`);
        }
      });
    },

    transformIndexHtml(_html, ctx) {
      if (injectKey === false) return;
      // ctx.server is only present on the dev server; builds get the placeholder
      const value = ctx.server
        ? readFileSync(configPath, "utf8")
        : buildPlaceholder;
      return [
        {
          tag: "script",
          children: `window.${injectKey} = ${value};`,
          injectTo: "head-prepend",
        },
      ];
    },
  };
}
