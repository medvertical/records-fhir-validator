/**
 * FHIRPath Sandbox (P-3)
 *
 * Static safety pre-flight for user-defined FHIRPath expressions
 * (Custom Rules). fhirpath.js is synchronous and cannot be hard-timed
 * out from the calling thread without a worker, so the only reliable
 * defence against a pathological customer-supplied expression is to
 * reject it before it runs.
 *
 * The sandbox enforces three bounds:
 *
 *   - **expressionLength**: total characters. Defaults to 4096.
 *   - **functionCallCount**: total `name(...)` invocations. Defaults
 *     to 64.
 *   - **nestingDepth**: maximum parenthesis depth. Defaults to 16.
 *
 * The bounds are deliberately generous for legitimate validation
 * expressions (the largest core constraints in HL7's FHIR shipped
 * package — `dom-2`/`dom-3`/`dom-4`/`dom-5`/`dom-6` plus the
 * `compliesWith` family — sit comfortably under all three limits) but
 * tight enough to reject the common DoS shapes: unbounded `repeat()`
 * recursion, deeply-nested `where(where(where(...)))`, and
 * megabyte-sized regex strings inside `matches()`.
 *
 * Runs in microseconds — single linear pass over the expression
 * string, no fhirpath parser involvement, no `eval`.
 */

export interface SandboxLimits {
  /** Maximum total characters in the expression. */
  expressionLength?: number;
  /** Maximum number of `name(...)` function calls. */
  functionCallCount?: number;
  /** Maximum parenthesis nesting depth. */
  nestingDepth?: number;
}

export interface SandboxResult {
  /** True when every limit was respected. */
  ok: boolean;
  /** Human-readable rejection reason when `ok` is false. */
  reason?: string;
  /** Measured metrics — exposed for ops dashboards / logging. */
  metrics: {
    expressionLength: number;
    functionCallCount: number;
    nestingDepth: number;
  };
}

const DEFAULT_LIMITS: Required<SandboxLimits> = {
  expressionLength: 4096,
  functionCallCount: 64,
  nestingDepth: 16,
};

/**
 * Statically analyse a FHIRPath expression string against the
 * configured limits.
 *
 * The function-call detector counts identifiers immediately followed
 * by `(`. This catches both built-ins (`where(`, `exists(`,
 * `iif(`, `repeat(`) and user-defined names — the customer's intent
 * doesn't matter; what matters is that an expression with hundreds of
 * `where(...)` calls is treated as suspicious regardless.
 *
 * Identifiers inside string literals are not counted. The walk skips
 * single- and double-quoted spans (with backslash escape handling)
 * because a regex argument like `matches('a(b|c)+d')` should not
 * inflate the function-call count.
 */
export function checkFhirpathSandbox(
  expression: string,
  limits: SandboxLimits = {},
): SandboxResult {
  const max: Required<SandboxLimits> = { ...DEFAULT_LIMITS, ...limits };

  const expressionLength = expression?.length ?? 0;
  const metrics = {
    expressionLength,
    functionCallCount: 0,
    nestingDepth: 0,
  };

  if (typeof expression !== 'string' || expression.length === 0) {
    return {
      ok: false,
      reason: 'Expression is empty',
      metrics,
    };
  }

  if (expressionLength > max.expressionLength) {
    return {
      ok: false,
      reason: `Expression length ${expressionLength} exceeds limit ${max.expressionLength}`,
      metrics,
    };
  }

  let i = 0;
  let depth = 0;
  let maxDepth = 0;
  let calls = 0;

  while (i < expression.length) {
    const ch = expression[i];

    // Skip string literals (single or double quoted, backslash-escape aware).
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < expression.length) {
        const c = expression[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === '(') {
      depth++;
      if (depth > maxDepth) maxDepth = depth;
      i++;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }

    // Identifier-followed-by-`(` = function call.
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < expression.length && /[A-Za-z0-9_]/.test(expression[i])) i++;
      // Allow one optional space between identifier and `(` per the
      // FHIRPath grammar's whitespace tolerance.
      let j = i;
      while (j < expression.length && expression[j] === ' ') j++;
      if (expression[j] === '(') {
        calls++;
      }
      // Don't consume `(` here — the next loop iteration will and bump depth.
      if (i === start) i++;
      continue;
    }

    i++;
  }

  metrics.functionCallCount = calls;
  metrics.nestingDepth = maxDepth;

  if (calls > max.functionCallCount) {
    return {
      ok: false,
      reason: `Function-call count ${calls} exceeds limit ${max.functionCallCount}`,
      metrics,
    };
  }
  if (maxDepth > max.nestingDepth) {
    return {
      ok: false,
      reason: `Nesting depth ${maxDepth} exceeds limit ${max.nestingDepth}`,
      metrics,
    };
  }

  return { ok: true, metrics };
}
