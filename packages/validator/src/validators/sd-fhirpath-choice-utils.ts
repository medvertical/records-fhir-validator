const CHOICE_BASES = [
    'value', 'effective', 'onset', 'abatement', 'deceased', 'multipleBirth',
    'defaultValue', 'medication', 'reported', 'occurrence', 'timing',
    'product', 'serviced', 'location', 'allowed', 'used',
    'rate', 'born', 'age',
];

/**
 * FHIR primitive type codes. Choice property names capitalise the first
 * letter of the type (`valueString`, `valueDateTime`); these are the
 * lower-cased forms used in FHIRPath `as`/`ofType` expressions.
 */
const FHIR_PRIMITIVE_TYPES = new Set([
    'base64Binary', 'boolean', 'canonical', 'code', 'date', 'dateTime',
    'decimal', 'id', 'instant', 'integer', 'integer64', 'markdown', 'oid',
    'positiveInt', 'string', 'time', 'unsignedInt', 'uri', 'url', 'uuid',
]);

export interface ChoiceTypeCastResolution {
    /** Skip the constraint entirely (fail open) — concrete type matches no cast. */
    skip: boolean;
    /** Expression to evaluate (cast may be stripped when it is a verified no-op). */
    expression: string;
}

/**
 * Resolve how a constraint that narrows a polymorphic `value[x]` via
 * `as`/`ofType` should be handled, given the instance's concrete type.
 *
 * fhirpath.js cannot type a bare choice value without a model annotation, so
 * `($this as dateTime)` returns empty even when the instance *is* a dateTime,
 * silently dropping the check. Two outcomes:
 *
 * - Concrete type matches none of the cast targets → skip (Java does the same;
 *   evaluating would turn a type-guard into a spurious violation).
 * - Concrete type matches the single cast target → strip the cast (it is a
 *   verified no-op: `$this as dateTime` ≡ `$this` when `$this` is a dateTime),
 *   so the rest of the expression actually evaluates.
 *
 * Mixed-target expressions (`(value as Quantity) or (value as string)`) are
 * left untouched to avoid unsafe rewrites.
 */
export function resolveChoiceTypeCast(expression: string, matched: any): ChoiceTypeCastResolution {
    const unchanged: ChoiceTypeCastResolution = { skip: false, expression };
    if (!matched?.element?.path?.includes('[x]')) return unchanged;

    const castTargets = extractCastTargets(expression);
    if (castTargets.length === 0) return unchanged;

    const concreteType =
        deriveChoiceTypeFromConcretePath(matched) ?? inferChoiceRuntimeType(matched.data);
    if (!concreteType) return unchanged;

    if (!castTargets.includes(concreteType)) {
        return { skip: true, expression };
    }

    // Concrete type matches. Strip the (now-redundant) cast only when it is the
    // sole distinct target, so a single type-guard invariant evaluates instead
    // of collapsing to empty. Mixed targets stay as-is.
    const distinctTargets = new Set(castTargets);
    if (distinctTargets.size === 1) {
        return { skip: false, expression: stripCast(expression, concreteType) };
    }
    return unchanged;
}

/**
 * Remove `<operand> as Type` / `<operand>.ofType(Type)` narrowing for a cast
 * whose target equals the instance's concrete type, leaving the operand.
 */
function stripCast(expression: string, type: string): string {
    const escaped = type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return expression
        .replace(new RegExp(`\\s+as\\s+${escaped}\\b`, 'g'), '')
        .replace(new RegExp(`\\.ofType\\(\\s*${escaped}\\s*\\)`, 'g'), '');
}

/**
 * Collect the type names referenced by `... as Type` and `.ofType(Type)`
 * in a FHIRPath expression. `is` is intentionally excluded: it yields a
 * boolean (`false` on mismatch) rather than an empty collection, so it does
 * not produce the spurious-violation pattern that warrants skipping.
 */
function extractCastTargets(expression: string): string[] {
    const targets: string[] = [];
    const asPattern = /\bas\s+([A-Za-z][A-Za-z0-9]*)/g;
    const ofTypePattern = /\bofType\s*\(\s*([A-Za-z][A-Za-z0-9]*)\s*\)/g;
    for (const pattern of [asPattern, ofTypePattern]) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(expression)) !== null) {
            targets.push(match[1]);
        }
    }
    return targets;
}

/**
 * Derive the concrete choice type from the matched element's resource path.
 * The element matcher records the concrete property (`Observation.valueQuantity`)
 * as `resourcePath` while the SD path stays polymorphic (`Observation.value[x]`),
 * so the suffix is an unambiguous type discriminator — robust where the
 * structural `inferChoiceRuntimeType` heuristic is blind (primitives, Coding,
 * Identifier, Range, Money, …).
 */
export function deriveChoiceTypeFromConcretePath(matched: any): string | null {
    const resourcePath: string | undefined = matched?.resourcePath;
    const sdPath: string | undefined = matched?.element?.path;
    if (!resourcePath || !sdPath) return null;

    const concreteProp = lastSegment(resourcePath).replace(/\[\d+\]$/, '');
    const polymorphicSegment = lastSegment(sdPath);
    if (!polymorphicSegment.endsWith('[x]')) return null;

    const base = polymorphicSegment.slice(0, -'[x]'.length);
    if (!CHOICE_BASES.includes(base)) return null;
    if (!concreteProp.startsWith(base) || concreteProp.length <= base.length) return null;

    const suffix = concreteProp.slice(base.length);
    const primitiveCandidate = suffix.charAt(0).toLowerCase() + suffix.slice(1);
    return FHIR_PRIMITIVE_TYPES.has(primitiveCandidate) ? primitiveCandidate : suffix;
}

function lastSegment(path: string): string {
    const dot = path.lastIndexOf('.');
    return dot >= 0 ? path.slice(dot + 1) : path;
}

export function prepareElementContext(context: any, expression: string): any {
    if (Array.isArray(context)) {
        return context.map(item => prepareElementContext(item, expression));
    }

    if (!context || typeof context !== 'object' || context.resourceType) {
        return context;
    }

    const keys = Object.keys(context);
    let normalized: any | undefined;

    for (const base of CHOICE_BASES) {
        if (!new RegExp(`\\b${base}\\b`).test(expression)) continue;
        if (context[base] !== undefined) continue;

        const concreteKey = keys.find(key =>
            key.startsWith(base) &&
            key.length > base.length &&
            key[base.length] === key[base.length].toUpperCase()
        );

        if (concreteKey) {
            normalized ??= { ...context };
            normalized[base] = context[concreteKey];
        }
    }

    return normalized ?? context;
}

function inferChoiceRuntimeType(value: any): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'decimal';
    if (typeof value !== 'object') return null;
    if ('start' in value || 'end' in value) return 'Period';
    if ('value' in value && ('unit' in value || 'code' in value || 'system' in value)) return 'Quantity';
    if ('coding' in value || 'text' in value) return 'CodeableConcept';
    if ('reference' in value) return 'Reference';
    return null;
}
