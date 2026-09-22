import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { convertUcumValue } from './ucum-quantity-conversion.js';

const UCUM_SYSTEM = 'http://unitsofmeasure.org';

/**
 * `rng-2` and `ratrng-2` ("low SHALL have a lower value than high") are out of
 * reach of the generic FHIRPath path on every version, in two different ways:
 * R5+ states them with `lowBoundary()`, which fhirpath.js rejects for Quantity
 * input, and R4's plain `low <= high` answers `true` for two unit-less
 * Quantities. An inverted range therefore goes unreported either way, so the
 * bounds are compared here instead.
 */

type BoundedPair = { constraintKey: string; low: string; high: string };

const BOUNDED_TYPES: Record<string, BoundedPair> = {
    Range: { constraintKey: 'rng-2', low: 'low', high: 'high' },
    RatioRange: { constraintKey: 'ratrng-2', low: 'lowNumerator', high: 'highNumerator' },
};

/** The keys this module owns; the generic evaluator reads them so the two cannot drift. */
export const RANGE_BOUND_CONSTRAINT_KEYS = Object.values(BOUNDED_TYPES).map(pair => pair.constraintKey);

export function isRangeBoundType(typeCode: string): boolean {
    return typeCode in BOUNDED_TYPES;
}

export function checkRangeBounds(
    value: unknown,
    basePath: string,
    typeCode: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
): ValidationIssue | null {
    const bounds = BOUNDED_TYPES[typeCode];
    if (!bounds) return null;
    const range = asRecord(value);
    if (!range) return null;

    const low = asOrderedQuantity(range[bounds.low]);
    const high = asOrderedQuantity(range[bounds.high]);
    if (!low || !high) return null;
    if (!isBackwards(low, high, fhirVersion)) return null;

    return createValidationIssue({
        code: 'profile-constraint-violation',
        path: basePath,
        resourceType: typeCode,
        customMessage:
            `${bounds.constraintKey} violation at ${basePath}: ${typeCode}.${bounds.low} ` +
            `(${describe(low)}) is greater than ${typeCode}.${bounds.high} (${describe(high)}).`,
        severityOverride: 'error',
        details: {
            constraintKey: bounds.constraintKey,
            low: low.value,
            high: high.value,
            ...unitDetail(low),
        },
    });
}

type OrderedQuantity = {
    value: number;
    unit?: string;
    code?: string;
    system?: string;
};

function asOrderedQuantity(value: unknown): OrderedQuantity | null {
    const quantity = asRecord(value);
    if (!quantity) return null;
    // A comparator leaves the bound open-ended, so the pair carries no order.
    if (quantity.comparator !== undefined) return null;
    if (typeof quantity.value !== 'number' || !Number.isFinite(quantity.value)) return null;
    return {
        value: quantity.value,
        unit: typeof quantity.unit === 'string' ? quantity.unit : undefined,
        code: typeof quantity.code === 'string' ? quantity.code : undefined,
        system: typeof quantity.system === 'string' ? quantity.system : undefined,
    };
}

/**
 * R4 compares the values as written. R5 restated the rule over precision
 * boundaries, so there `1.5` and `1.4` no longer conflict — their intervals
 * still touch.
 */
function isBackwards(
    low: OrderedQuantity,
    high: OrderedQuantity,
    fhirVersion: 'R4' | 'R5' | 'R6',
): boolean {
    const lowBound = fhirVersion === 'R4' ? low.value : low.value - halfUnitInLastPlace(low.value);
    const highBound = fhirVersion === 'R4' ? high.value : high.value + halfUnitInLastPlace(high.value);
    const comparableHighBound = onLowScale(highBound, high, low);
    return comparableHighBound !== null && lowBound > comparableHighBound;
}

/**
 * The spec orders the bounds through `comparable()`, which accepts any
 * UCUM-convertible pair. A pair that carries no UCUM code is only comparable
 * when the two unit labels are identical — guessing at a free-text unit would
 * risk turning a valid range into an error.
 */
function onLowScale(
    value: number,
    from: OrderedQuantity,
    low: OrderedQuantity,
): number | null {
    if (isUcum(from) && isUcum(low)) {
        return convertUcumValue(value, from.code!, low.code!);
    }
    if (from.code !== undefined || low.code !== undefined) {
        return from.code === low.code && from.system === low.system ? value : null;
    }
    return from.unit === low.unit ? value : null;
}

function isUcum(quantity: OrderedQuantity): boolean {
    return quantity.system === UCUM_SYSTEM && quantity.code !== undefined;
}

/**
 * JSON parsing drops a written trailing zero, so `1.50` is measured as `1.5`
 * and gets the wider interval. Widening only ever withholds a finding, which
 * is the safe direction for a rule that has never fired.
 */
function halfUnitInLastPlace(value: number): number {
    const text = Math.abs(value).toString();
    if (!/^\d+(?:\.\d+)?$/.test(text)) return 0;
    const point = text.indexOf('.');
    const decimals = point < 0 ? 0 : text.length - point - 1;
    return 0.5 * 10 ** -decimals;
}

function unitDetail(quantity: OrderedQuantity): { unit?: string } {
    const unit = quantity.unit ?? quantity.code;
    return unit === undefined ? {} : { unit };
}

function describe(quantity: OrderedQuantity): string {
    const unit = quantity.unit ?? quantity.code;
    return unit ? `${quantity.value} ${unit}` : String(quantity.value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}
