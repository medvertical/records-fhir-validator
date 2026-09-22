import {
    isConcreteChoiceProperty,
    splitConcreteChoiceProperty,
} from '../core/fhir-choice-property.js';

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

type ObjectRecord = Record<string, unknown>;

interface ChoiceMatchInput {
    element?: unknown;
    resourcePath?: unknown;
    data?: unknown;
}

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
export function resolveChoiceTypeCast(expression: string, matched: unknown): ChoiceTypeCastResolution {
    const unchanged: ChoiceTypeCastResolution = { skip: false, expression };
    const match = toChoiceMatch(matched);
    if (!getElementPath(match)?.includes('[x]')) return unchanged;

    const castTargets = extractCastTargets(expression);
    if (castTargets.length === 0) return unchanged;

    const concreteType =
        deriveChoiceTypeFromConcretePath(match) ?? inferChoiceRuntimeType(match?.data);
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
export function deriveChoiceTypeFromConcretePath(matched: unknown): string | null {
    const match = toChoiceMatch(matched);
    const resourcePath = typeof match?.resourcePath === 'string' ? match.resourcePath : undefined;
    const sdPath = getElementPath(match);
    if (!resourcePath || !sdPath) return null;

    const concreteProp = lastSegment(resourcePath).replace(/\[\d+\]$/, '');
    const polymorphicSegment = lastSegment(sdPath);
    if (!polymorphicSegment.endsWith('[x]')) return null;

    const base = polymorphicSegment.slice(0, -'[x]'.length);
    if (!isConcreteChoiceProperty(concreteProp, base)) return null;

    const suffix = concreteProp.slice(base.length);
    const primitiveCandidate = suffix.charAt(0).toLowerCase() + suffix.slice(1);
    return FHIR_PRIMITIVE_TYPES.has(primitiveCandidate) ? primitiveCandidate : suffix;
}

function lastSegment(path: string): string {
    const dot = path.lastIndexOf('.');
    return dot >= 0 ? path.slice(dot + 1) : path;
}

export function prepareElementContext(context: unknown, expression: string): unknown {
    return prepareElementContextValue(context, expression, new WeakMap<object, unknown>());
}

function prepareElementContextValue(
    context: unknown,
    expression: string,
    visited: WeakMap<object, unknown>,
): unknown {
    if (Array.isArray(context)) {
        const existing = visited.get(context);
        if (existing !== undefined) return existing;

        const normalizedItems: unknown[] = [];
        visited.set(context, normalizedItems);
        for (const item of context) {
            normalizedItems.push(prepareElementContextValue(item, expression, visited));
        }
        return normalizedItems;
    }

    if (!isObjectRecord(context) || typeof context.resourceType === 'string') {
        return context;
    }

    const keys = Object.keys(context);
    let normalized: ObjectRecord | undefined;

    const concreteChoices = keys
        .map(key => ({ key, choice: splitConcreteChoiceProperty(key) }))
        .filter((entry): entry is { key: string; choice: { baseName: string; typeSuffix: string } } =>
            entry.choice !== null
        );
    for (const { key: concreteKey, choice } of concreteChoices) {
        const base = choice.baseName;
        if (!new RegExp(`\\b${base}\\b`).test(expression)) continue;
        if (context[base] !== undefined) continue;
        normalized ??= { ...context };
        normalized[base] = context[concreteKey];
    }

    return normalized ?? context;
}

function inferChoiceRuntimeType(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'decimal';
    if (!isObjectRecord(value)) return null;
    if ('start' in value || 'end' in value) return 'Period';
    if ('value' in value && ('unit' in value || 'code' in value || 'system' in value)) return 'Quantity';
    if ('coding' in value || 'text' in value) return 'CodeableConcept';
    if ('reference' in value) return 'Reference';
    return null;
}

function toChoiceMatch(value: unknown): ChoiceMatchInput | null {
    return isObjectRecord(value) ? value : null;
}

function getElementPath(match: ChoiceMatchInput | null): string | undefined {
    if (!isObjectRecord(match?.element)) return undefined;
    return typeof match.element.path === 'string' ? match.element.path : undefined;
}

function isObjectRecord(value: unknown): value is ObjectRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
