import type { StandardSchemaV1 } from "@standard-schema/spec";
import { formatIssues } from "./index.js";

/** Result of validating one config object against the schema. */
export interface CheckResult {
  ok: boolean;
  message?: string;
}

export async function checkConfig(
  schema: StandardSchemaV1,
  raw: unknown
): Promise<CheckResult> {
  const result = await schema["~standard"].validate(raw);
  if (result.issues) {
    return { ok: false, message: formatIssues(result.issues, raw) };
  }
  return { ok: true };
}

/** Keys present in some files but missing in others — the classic prod/stage drift. */
export function diffKeys(
  files: { file: string; raw: Record<string, unknown> }[]
): { file: string; key: string }[] {
  const union = new Set(files.flatMap(({ raw }) => Object.keys(raw)));
  return files.flatMap(({ file, raw }) =>
    [...union].filter((key) => !(key in raw)).map((key) => ({ file, key }))
  );
}

const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY|APIKEY)/i;

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export interface SecretFinding {
  key: string;
  reason: "name" | "entropy";
}

/**
 * SPA config ships to every browser — nothing in it is secret. Flag keys that
 * look like credentials by name, and string values that look like generated
 * secrets (long + high entropy).
 */
export function secretFindings(raw: Record<string, unknown>): SecretFinding[] {
  return Object.entries(raw).flatMap(([key, value]): SecretFinding[] => {
    if (SECRET_NAME.test(key)) return [{ key, reason: "name" }];
    if (
      typeof value === "string" &&
      value.length >= 24 &&
      !value.includes("://") && // URLs are long but not secrets
      shannonEntropy(value) >= 4.2
    ) {
      return [{ key, reason: "entropy" }];
    }
    return [];
  });
}

// --- schema introspection (zod duck-typing, no zod import — runtime code) ---

interface ZodLikeDef {
  typeName?: string;
  innerType?: ZodLikeField;
  defaultValue?: () => unknown;
  values?: unknown[];
}

interface ZodLikeField {
  _def?: ZodLikeDef;
  description?: string;
}

function unwrap(field: ZodLikeField): {
  inner: ZodLikeField;
  defaultValue?: unknown;
} {
  let current = field;
  let defaultValue: unknown;
  while (current._def?.innerType) {
    if (current._def.typeName === "ZodDefault" && current._def.defaultValue) {
      defaultValue = current._def.defaultValue();
    }
    current = current._def.innerType;
  }
  return { inner: current, defaultValue };
}

const TYPE_NAMES: Record<string, string> = {
  ZodString: "string",
  ZodNumber: "number",
  ZodBoolean: "boolean",
  ZodObject: "object",
  ZodArray: "array",
};

function typeLabel(field: ZodLikeField): string {
  const def = field._def;
  if (def?.typeName === "ZodEnum" && def.values) {
    return def.values.map((v) => JSON.stringify(v)).join(" \\| ");
  }
  return TYPE_NAMES[def?.typeName ?? ""] ?? "unknown";
}

/**
 * Markdown table of keys, types, defaults and `.describe()` descriptions.
 * Introspection is zod-shaped (duck-typed `.shape`/`._def`) — other Standard
 * Schema libraries don't expose structure to introspect.
 */
export function docsTable(schema: unknown): string {
  const shape = (schema as { shape?: Record<string, ZodLikeField> }).shape;
  if (!shape || typeof shape !== "object") {
    throw new Error(
      "attunement docs: cannot introspect this schema — a zod object schema (with .shape) is required"
    );
  }

  const rows = Object.entries(shape).map(([key, field]) => {
    const { inner, defaultValue } = unwrap(field);
    const description = field.description ?? inner.description ?? "";
    const def =
      defaultValue === undefined ? "—" : `\`${JSON.stringify(defaultValue)}\``;
    return `| \`${key}\` | \`${typeLabel(inner)}\` | ${def} | ${description} |`;
  });

  return [
    "| Key | Type | Default | Description |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}
