import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ReactNode } from "react";
import { ConfigError, deepFreeze, formatIssues } from "./index.js";
import type { AttunedReact } from "./react.js";

/**
 * Synchronous Provider for tests: overrides are validated against the app's
 * schema and merged over its defaults — no sources, no fetch, no Suspense.
 *
 *   render(<TestProvider><MyComponent /></TestProvider>)
 *
 * Invalid overrides throw ConfigError immediately, so a typo fails the test
 * at setup, not with an unrelated assertion later.
 */
export function createTestProvider<T, S extends StandardSchemaV1>(
  config: AttunedReact<T, S>,
  overrides: Partial<StandardSchemaV1.InferInput<S>> = {}
): (props: { children: ReactNode }) => ReactNode {
  const result = config._schema["~standard"].validate(overrides);
  if (result instanceof Promise) {
    throw new Error(
      "attunement: async schema validation is not supported in createTestProvider"
    );
  }
  if (result.issues) {
    throw new ConfigError(formatIssues(result.issues, overrides), result.issues);
  }

  // InferOutput<S> and T are the same type by attuneReact construction;
  // the interface just can't prove it here
  const value = deepFreeze(result.value) as T;
  const Ctx = config._ctx;

  return ({ children }) => <Ctx value={value}>{children}</Ctx>;
}
