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
  /** zod 3: "ZodBoolean", "ZodDefault"... */
  typeName?: string;
  /** zod 4: "boolean", "default"... */
  type?: string;
  innerType?: ZodLikeField;
  /** zod 3 ZodEffects (preprocess/refine) wraps here */
  schema?: ZodLikeField;
  /** zod 4 pipe (preprocess/stringbool): out is the result type */
  out?: ZodLikeField;
  /** zod 3: thunk; zod 4: plain value */
  defaultValue?: (() => unknown) | unknown;
  /** zod 3 enum literals */
  values?: unknown[];
  /** zod 4 enum literals (key → value) */
  entries?: Record<string, unknown>;
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
  while (true) {
    const def = current._def;
    if (!def) break;
    const inner = def.innerType ?? def.schema ?? def.out;
    if (!inner) break;
    if (def.typeName === "ZodDefault" || def.type === "default") {
      defaultValue =
        typeof def.defaultValue === "function" ? def.defaultValue() : def.defaultValue;
    }
    current = inner;
  }
  return { inner: current, defaultValue };
}

// zod 3 typeName and zod 4 lowercase type, same map
const TYPE_NAMES: Record<string, FieldInfo["type"]> = {
  ZodString: "string",
  ZodNumber: "number",
  ZodBoolean: "boolean",
  ZodObject: "object",
  ZodArray: "array",
  ZodEnum: "enum",
  string: "string",
  number: "number",
  boolean: "boolean",
  object: "object",
  array: "array",
  enum: "enum",
};

/** One introspected top-level schema field. */
export interface FieldInfo {
  key: string;
  type: "string" | "number" | "boolean" | "enum" | "object" | "array" | "unknown";
  /** Enum literals, present when type === "enum". */
  values?: unknown[];
  defaultValue?: unknown;
  description: string;
}

/**
 * @internal Introspect a zod object schema's top-level fields (duck-typed,
 * no zod import — other Standard Schema libraries don't expose structure).
 * Shared by `docsTable` and the devtools panel form.
 */
export function introspectShape(schema: unknown): FieldInfo[] {
  const shape = (schema as { shape?: Record<string, ZodLikeField> }).shape;
  if (!shape || typeof shape !== "object") {
    throw new Error(
      "attunement: cannot introspect this schema — a zod object schema (with .shape) is required"
    );
  }

  return Object.entries(shape).map(([key, field]) => {
    const { inner, defaultValue } = unwrap(field);
    const def = inner._def;
    const type = TYPE_NAMES[def?.typeName ?? def?.type ?? ""] ?? "unknown";
    const values =
      def?.values ?? (def?.entries ? Object.values(def.entries) : []);
    return {
      key,
      type,
      ...(type === "enum" ? { values } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      description: field.description ?? inner.description ?? "",
    };
  });
}

/**
 * Markdown table of keys, types, defaults and `.describe()` descriptions.
 * Requires a zod object schema — see `introspectShape`.
 */
export function docsTable(schema: unknown): string {
  const rows = introspectShape(schema).map((field) => {
    const type =
      field.type === "enum"
        ? (field.values ?? []).map((v) => JSON.stringify(v)).join(" \\| ")
        : field.type;
    const def =
      field.defaultValue === undefined
        ? "—"
        : `\`${JSON.stringify(field.defaultValue)}\``;
    return `| \`${field.key}\` | \`${type}\` | ${def} | ${field.description} |`;
  });

  return [
    "| Key | Type | Default | Description |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}
