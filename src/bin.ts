#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { checkConfig, diffKeys, docsTable, secretFindings } from "./cli.js";

const USAGE = `attunement — validate runtime config files against your schema

Usage:
  attunement check --schema <module> [--diff] <files...>
  attunement docs  --schema <module>

Options:
  --schema  Path to a module exporting the schema (named export "schema" or default).
            .ts works directly on Node >= 22.18 (native type stripping).
  --diff    Also fail when the files disagree on top-level keys (prod/stage drift).

Exit codes: 0 ok, 1 validation/diff failure, 2 usage error.`;

async function loadSchema(modulePath: string): Promise<StandardSchemaV1> {
  const mod: Record<string, unknown> = await import(
    pathToFileURL(modulePath).href
  );
  const candidate = mod["schema"] ?? mod["default"];
  if (
    !candidate ||
    typeof candidate !== "object" ||
    !("~standard" in candidate)
  ) {
    throw new Error(
      `${modulePath}: expected a Standard Schema as the "schema" or default export`
    );
  }
  // "~standard" presence is the Standard Schema contract check above
  return candidate as StandardSchemaV1;
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  const text = await readFile(file, "utf8");
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("top-level value must be a JSON object");
    }
    // narrowed to a non-null, non-array object right above
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `${file}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      schema: { type: "string" },
      diff: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  const [command, ...files] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  if (!values.schema) {
    console.error("error: --schema <module> is required\n");
    console.log(USAGE);
    return 2;
  }

  const schema = await loadSchema(values.schema);

  if (command === "docs") {
    console.log(docsTable(schema));
    return 0;
  }

  if (command !== "check") {
    console.error(`error: unknown command "${command}"\n`);
    console.log(USAGE);
    return 2;
  }
  if (files.length === 0) {
    console.error("error: check needs at least one config file\n");
    console.log(USAGE);
    return 2;
  }

  let failed = false;
  const loaded: { file: string; raw: Record<string, unknown> }[] = [];

  for (const file of files) {
    const raw = await readJson(file);
    loaded.push({ file, raw });

    const result = await checkConfig(schema, raw);
    if (result.ok) {
      console.log(`ok   ${file}`);
    } else {
      failed = true;
      console.error(`FAIL ${file}\n${result.message}`);
    }

    for (const finding of secretFindings(raw)) {
      console.warn(
        finding.reason === "name"
          ? `warn ${file}: "${finding.key}" looks like a credential by name — SPA config is public`
          : `warn ${file}: "${finding.key}" value looks like a generated secret (high entropy) — SPA config is public`
      );
    }
  }

  if (values.diff && loaded.length > 1) {
    for (const { file, key } of diffKeys(loaded)) {
      failed = true;
      console.error(`DIFF ${file}: missing key "${key}" present in other files`);
    }
  }

  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`error: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
);
