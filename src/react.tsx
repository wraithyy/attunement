import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  Component,
  createContext,
  Suspense,
  use,
  type Context,
  type ReactNode,
} from "react";
import { attune, type AttuneOptions, type Attuned } from "./index.js";

export * from "./index.js";

export interface ProviderProps {
  children: ReactNode;
  /** Shown while config loads. With fromWindow it never appears. */
  fallback?: ReactNode;
  /** Shown when no source succeeds or validation fails. */
  errorFallback?: ReactNode | ((error: Error) => ReactNode);
}

export interface AttunedReact<
  T,
  S extends StandardSchemaV1 = StandardSchemaV1,
> extends Attuned<T> {
  Provider: (props: ProviderProps) => ReactNode;
  /** Config, guaranteed loaded — only renders under Provider. */
  use: () => T;
  /** @internal wiring for attunement/testing — not public API */
  _ctx: Context<T | null>;
  /** @internal */
  _schema: S;
}

interface BoundaryProps {
  fallback: ProviderProps["errorFallback"];
  children: ReactNode;
}

class ConfigBoundary extends Component<
  BoundaryProps,
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error) {
      const { fallback } = this.props;
      return typeof fallback === "function" ? fallback(error) : (fallback ?? null);
    }
    return this.props.children;
  }
}

/**
 * attune() + React bindings. Call at module scope — config fetch starts
 * immediately, Provider suspends until it resolves, use() is then synchronous.
 */
export function attuneReact<S extends StandardSchemaV1>(
  options: AttuneOptions<S>
): AttunedReact<StandardSchemaV1.InferOutput<S>, S> {
  type T = StandardSchemaV1.InferOutput<S>;

  const attuned = attune(options);
  const Ctx = createContext<T | null>(null);

  function Resolved({ children }: { children: ReactNode }) {
    const config = use(attuned.load());
    return <Ctx value={config}>{children}</Ctx>;
  }

  function Provider({ children, fallback, errorFallback }: ProviderProps) {
    return (
      <ConfigBoundary fallback={errorFallback}>
        <Suspense fallback={fallback}>
          <Resolved>{children}</Resolved>
        </Suspense>
      </ConfigBoundary>
    );
  }

  function useConfig(): T {
    const config = use(Ctx);
    if (config === null) {
      throw new Error("attunement: use() called outside <Provider>");
    }
    return config;
  }

  return { ...attuned, Provider, use: useConfig, _ctx: Ctx, _schema: options.schema };
}
