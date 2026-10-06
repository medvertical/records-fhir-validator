import {
    isConcreteChoiceProperty,
    splitConcreteChoiceProperty,
} from '../core/fhir-choice-property.js';
import { getFhirPathModel } from '../core/fhirpath-context.js';

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

/** Whether a property base names a choice element; undefined when unknown. */
export type ChoiceElementLookup = (base: string) => boolean | undefined;

export function prepareElementContext(
    context: unknown,
    expression: string,
    isChoiceElement: ChoiceElementLookup = () => undefined,
): unknown {
    return prepareElementContextValue(context, expression, isChoiceElement, new WeakMap<object, unknown>());
}

function prepareElementContextValue(
    context: unknown,
    expression: string,
    isChoiceElement: ChoiceElementLookup,
    visited: WeakMap<object, unknown>,
): unknown {
    if (Array.isArray(context)) {
        const existing = visited.get(context);
        if (existing !== undefined) return existing;

        const normalizedItems: unknown[] = [];
        visited.set(context, normalizedItems);
        for (const item of context) {
            normalizedItems.push(prepareElementContextValue(item, expression, isChoiceElement, visited));
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
        if (context[base] !== undefined || isChoiceElement(base) === false) continue;
        normalized ??= { ...context };
        normalized[base] = context[concreteKey];
    }
    // A choice value can exist through its sidecar alone (`_valueBoolean`
    // carrying a data-absent-reason); fhirpath.js reads `_value` as that.
    for (const key of keys) {
        const choice = key.startsWith('_') ? splitConcreteChoiceProperty(key.slice(1)) : null;
        if (!choice) continue;
        const base = choice.baseName;
        if (!new RegExp(`\\b${base}\\b`).test(expression)) continue;
        if (context[`_${base}`] !== undefined || isChoiceElement(base) === false) continue;
        normalized ??= { ...context };
        normalized[`_${base}`] = context[key];
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

/**
 * A complex datatype reached as raw JSON (`Questionnaire.useContext[0]`)
 * carries no type for fhirpath.js, so a type test on one of its choices
 * (sdc-uc-1: `value is CodeableConcept`) fails even when the JSON key says
 * `valueCodeableConcept`. Named as a pseudo-resource of its datatype, the
 * model types the choice again. Only a context whose datatype declares that
 * choice is renamed; everything else keeps the plain normalization.
 */
export function typeChoiceContext(
    context: unknown,
    expression: string,
    path: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
): unknown {
    if (!isObjectRecord(context) || typeof context.resourceType === 'string') return context;
    const typedBases = Object.keys(context)
        .map(key => splitConcreteChoiceProperty(key)?.baseName)
        .filter((base): base is string => typeof base === 'string'
            && new RegExp(`\\b${base}\\s+(?:is|as)\\s+[A-Za-z]|\\b${base}\\s*\\.\\s*(?:ofType|is|as)\\s*\\(`).test(expression));
    if (typedBases.length === 0) return context;
    const model = getFhirPathModel(fhirVersion);
    const datatype = (model.path2Type as Record<string, string | undefined>)[definitionPathOf(path)];
    const choices = model.choiceTypePaths as Record<string, string[] | undefined>;
    if (!datatype || !typedBases.every(base => choices[`${datatype}.${base}`])) return context;
    return { resourceType: datatype, ...context };
}

/**
 * Which property bases of the element at `path` the FHIRPath model knows as
 * choices. On a TestScript assert, `responseCode` is an element of its own,
 * not `response[x]` typed code, so tst-5 must not count it twice. A path the
 * model does not know (a slice, a nested item) keeps the lenient reading.
 */
export function choiceElementsAt(path: string, fhirVersion: 'R4' | 'R5' | 'R6'): ChoiceElementLookup {
    const model = getFhirPathModel(fhirVersion);
    const types = model.path2Type as Record<string, string | undefined>;
    const choices = model.choiceTypePaths as Record<string, string[] | undefined>;
    const definitionPath = followContentReferences(
        definitionPathOf(path),
        model.pathsDefinedElsewhere as Record<string, string | undefined>,
    );
    const owners = [definitionPath, types[definitionPath]].filter((owner): owner is string => Boolean(owner));
    return base => {
        if (owners.some(owner => choices[`${owner}.${base}`])) return true;
        if (owners.some(owner => types[`${owner}.${base}`])) return false;
        return undefined;
    };
}

/**
 * An element defined by content reference (`TestScript.test.action.assert` is
 * `TestScript.setup.action.assert`) has its children only under the path it
 * refers to; without following it, `response` looks undefined and takes
 * `responseCode` as a choice alias.
 */
function followContentReferences(path: string, definedElsewhere: Record<string, string | undefined>): string {
    let current = path;
    for (let hop = 0; hop < 8; hop += 1) {
        const segments = current.split('.');
        const end = segments.findLastIndex((_, index) => definedElsewhere[segments.slice(0, index + 1).join('.')] !== undefined);
        if (end < 0) return current;
        current = [definedElsewhere[segments.slice(0, end + 1).join('.')], ...segments.slice(end + 1)].join('.');
    }
    return current;
}

// `Bundle.entry[0].resource/*Patient/p*/.address[0]` reads as `Patient.address`.
function definitionPathOf(path: string): string {
    const markers = [...path.matchAll(/\/\*([A-Za-z]+)(?:\/[^*]*)?\*\//g)];
    const last = markers.at(-1);
    const local = last?.index === undefined ? path : `${last[1]}${path.slice(last.index + last[0].length)}`;
    return local.replace(/\[[^\]]*\]/g, '');
}

