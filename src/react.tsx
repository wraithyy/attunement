import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  Component,
  createContext,
  Suspense,
  use,
  type Context,
  type ReactNode,
} from "react";
import { attune, ConfigError, DEV, type AttuneOptions, type Attuned } from "./index.js";

export * from "./index.js";

export interface ProviderProps {
  children: ReactNode;
  /** Shown while config loads. With fromWindow it never appears. */
  fallback?: ReactNode;
  /**
   * Shown when no source succeeds or validation fails. Defaults to a minimal
   * "Configuration failed to load." block (error details in dev only);
   * pass null to render nothing. `retry` recovers by any means — currently
   * a full page reload.
   */
  errorFallback?: ReactNode | ((error: Error, retry: () => void) => ReactNode);
  /**
   * Reporting hook (Sentry etc.) — called once per caught config error.
   * Fires only for ConfigError; other render errors are rethrown to your own
   * boundary and are its business to report.
   */
  onError?: (error: Error) => void;
}

export interface AttunedReact<
  T,
  S extends StandardSchemaV1 = StandardSchemaV1,
> extends Attuned<T, S> {
  Provider: (props: ProviderProps) => ReactNode;
  /** Config, guaranteed loaded — only renders under Provider. */
  use: () => T;
  /** @internal wiring for attunement/testing — not public API */
  _ctx: Context<T | null>;
}

interface BoundaryProps {
  fallback: ProviderProps["errorFallback"];
  onError: ProviderProps["onError"];
  children: ReactNode;
}

const retry = () => location.reload();

/**
 * Default errorFallback: names the failure instead of a white page. The
 * message (config keys, source URLs) is dev-only — it doesn't belong in
 * front of end users.
 */
function DefaultErrorFallback({ error }: { error: Error }) {
  return (
    <div role="alert" style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <strong>Configuration failed to load.</strong>{" "}
      <button onClick={retry}>Retry</button>
      {DEV && (
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{error.message}</pre>
      )}
    </div>
  );
}

class ConfigBoundary extends Component<
  BoundaryProps,
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (error instanceof ConfigError) {
      this.props.onError?.(error);
    }
  }

  render() {
    const { error } = this.state;
    if (error) {
      // only config failures belong to this boundary — an app bug rendering
      // as "Configuration failed to load" is a 3am misdiagnosis
      if (!(error instanceof ConfigError)) throw error;
      const { fallback } = this.props;
      if (fallback === undefined) return <DefaultErrorFallback error={error} />;
      return typeof fallback === "function" ? fallback(error, retry) : fallback;
    }
    return this.props.children;
  }
}

/**
 * React binding over an existing core handle — for apps that keep the schema
 * and loader in React-free modules (CLI check imports, wiring via onReady).
 * Most apps want `attuneReact()` instead; this is the same thing split in
 * two. Each call creates an independent binding (own context) over the same
 * shared load — use() only works under its own Provider.
 *
 * Let inference flow: annotating the handle (`const c: Attuned<Config> =`)
 * erases the schema type and use() degrades to unknown.
 */
export function bindReact<S extends StandardSchemaV1>(
  attuned: Attuned<StandardSchemaV1.InferOutput<S>, S>
): AttunedReact<StandardSchemaV1.InferOutput<S>, S> {
  type T = StandardSchemaV1.InferOutput<S>;

  const Ctx = createContext<T | null>(null);

  function Resolved({ children }: { children: ReactNode }) {
    const config = use(attuned.load());
    return <Ctx value={config}>{children}</Ctx>;
  }

  function Provider({ children, fallback, errorFallback, onError }: ProviderProps) {
    return (
      <ConfigBoundary fallback={errorFallback} onError={onError}>
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

  return { ...attuned, Provider, use: useConfig, _ctx: Ctx };
}

/**
 * attune() + React bindings. Call at module scope — config fetch starts
 * immediately, Provider suspends until it resolves, use() is then synchronous.
 */
export function attuneReact<S extends StandardSchemaV1>(
  options: AttuneOptions<S>
): AttunedReact<StandardSchemaV1.InferOutput<S>, S> {
  return bindReact(attune(options));
}
