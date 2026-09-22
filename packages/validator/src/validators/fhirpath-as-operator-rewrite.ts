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
 * - `X as T`  →  `X.ofType(T)`          — filter to items of the type. For a
 *   singleton this returns the item if it matches (else empty), exactly like
 *   `as`.
 * - `X is T`  →  `X.select($this is T)` — type-test each item. For a singleton
 *   this is exactly `X is T`; for a collection every item is tested instead of
 *   a throw. Crucially, empty input stays EMPTY: `is` on empty is empty per
 *   spec, and an `.all()` rewrite would turn it vacuously true — flipping
 *   `who.exists(resolve() is Practitioner) implies ...` constraints into false
 *   positives whenever `resolve()` cannot dereference an external reference.
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
const RESERVED_MEMBER_NAMES = ['div'];

export function rewriteCollectionTypeOperators(expression: string): string {
    if (!expression) return expression;
    const source = rewriteReservedMemberNames(expression);
    let rewritten = '';
    let codeStart = 0;
    for (let index = 0; index < source.length; index++) {
        const char = source[index];
        if (char !== "'" && char !== '`') continue;
        const quoted = readQuotedSegment(source, index, char);
        rewritten += rewriteUnquotedTypeOperators(source.slice(codeStart, index)) + quoted.value;
        index = quoted.endIndex;
        codeStart = index + 1;
    }
    return rewritten + rewriteUnquotedTypeOperators(source.slice(codeStart));
}

function rewriteUnquotedTypeOperators(expression: string): string {
    let rewritten = expression;
    if (/\bas\b/.test(rewritten)) {
        rewritten = rewritten.replace(AS_OPERATOR, (_m, operand: string, type: string) =>
            `${operand}.ofType(${type})`,
        );
    }
    if (/\bis\b/.test(rewritten)) {
        rewritten = rewritten.replace(IS_OPERATOR, (_m, operand: string, type: string) =>
            `${operand}.select($this is ${type})`,
        );
    }
    return rewritten;
}

function rewriteReservedMemberNames(expression: string): string {
    let rewritten = '';
    for (let index = 0; index < expression.length; index++) {
        const char = expression[index];

        if (char === "'" || char === '`') {
            const { value, endIndex } = readQuotedSegment(expression, index, char);
            rewritten += value;
            index = endIndex;
            continue;
        }

        if (char === '.') {
            const replacement = RESERVED_MEMBER_NAMES.find(name =>
                expression.startsWith(name, index + 1) &&
                !isIdentifierCharacter(expression[index + name.length + 1])
            );
            if (replacement) {
                rewritten += `.\`${replacement}\``;
                index += replacement.length;
                continue;
            }
        }

        rewritten += char;
    }
    return rewritten;
}

function readQuotedSegment(
    expression: string,
    startIndex: number,
    quote: "'" | '`',
): { value: string; endIndex: number } {
    let value = quote;
    for (let index = startIndex + 1; index < expression.length; index++) {
        const char = expression[index];
        value += char;
        if (char === '\\') {
            index++;
            if (index < expression.length) value += expression[index];
            continue;
        }
        if (char === quote) {
            return { value, endIndex: index };
        }
    }
    return { value, endIndex: expression.length - 1 };
}

function isIdentifierCharacter(char: string | undefined): boolean {
    return !!char && /[A-Za-z0-9_]/.test(char);
}
