/**
 * FHIRPath collection-unsafe type-operator rewrite
 * -------------------------------------------------
 *
 * fhirpath.js (with a FHIR model loaded) throws
 *   "Expected singleton on left side of 'as'" / "...of 'is'"
 * whenever the `as` / `is` type operators are applied to a collection — e.g.
 * `component.value as Quantity`, where `component` repeats. The throw lands in
 * the constraint executor's catch block, so the constraint is silently skipped
 * (reported only as an informational evaluation-error). This is gap P-4:
 * `as`/`is` on non-singleton collections.
 *
 * Both operators have collection-safe equivalents that are identical for the
 * singleton case the operators were designed for:
 *
 * - `X as T`  →  `X.ofType(T)`        — filter to items of the type. For a
 *   singleton this returns the item if it matches (else empty), exactly like
 *   `as`.
 * - `X is T`  →  `X.all($this is T)`  — true iff every item is of the type.
 *   For a singleton (and for empty) this is exactly `X is T`; for a collection
 *   it is a sensible total semantics instead of a throw.
 *
 * `.type()` is left alone — it already works on collections.
 */

// Operand immediately preceding ` as ` / ` is `: `$this`, a closing paren of a
// grouped expression, or a dotted path. The path alternative carries a
// negative lookbehind so it starts at a token boundary — without it the path
// would match `this` inside `$this`. Type specifier: a simple FHIR type name
// (namespaced `System.String` forms are intentionally left alone).
const PATH = String.raw`(?<![\w$.])[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*`;
const TYPE = String.raw`([A-Za-z][A-Za-z0-9]*)\b`;

const AS_OPERATOR = new RegExp(`(\\$this|\\)|${PATH})\\s+as\\s+${TYPE}`, 'g');
// `is` excludes a `$this` operand: a bare `$this is T` only occurs inside an
// already-singleton context (`.all(...)`, `.where(...)`, or a choice-element
// constraint handled upstream), so wrapping it would be redundant noise.
const IS_OPERATOR = new RegExp(`(\\)|${PATH})\\s+is\\s+${TYPE}`, 'g');

export function rewriteCollectionTypeOperators(expression: string): string {
    if (!expression) return expression;
    let rewritten = expression;
    if (/\bas\b/.test(rewritten)) {
        rewritten = rewritten.replace(AS_OPERATOR, (_m, operand: string, type: string) =>
            `${operand}.ofType(${type})`,
        );
    }
    if (/\bis\b/.test(rewritten)) {
        rewritten = rewritten.replace(IS_OPERATOR, (_m, operand: string, type: string) =>
            `${operand}.all($this is ${type})`,
        );
    }
    return rewritten;
}
