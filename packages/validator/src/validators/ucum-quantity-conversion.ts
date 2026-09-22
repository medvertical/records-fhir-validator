/**
 * UCUM Quantity Conversion
 * ------------------------
 *
 * Expresses a Quantity value in another commensurable UCUM unit, so two bounds
 * written on different scales (`1 g` and `500 mg`) can be ordered. `ucum-lhc`
 * builds its unit tables on first use, so the singleton stays lazy — a resource
 * whose bounds already share a unit never pays for it.
 */

import { createRequire } from 'module';
import { logger } from '../logger.js';
import { BoundedLruCache } from '../cache/bounded-lru-cache.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';

// `ucum-lhc` ships only a CJS entry point; under ESM `require` is undefined.
const cjsRequire = createRequire(import.meta.url);

interface UcumLhcConversionUtils {
  convertUnitTo(fromCode: string, value: number, toCode: string): unknown;
}

/** Affine, because `[degF]` → `Cel` is not a pure factor. */
type UnitConversion = { scale: number; offset: number };

const conversions = new BoundedLruCache<string, UnitConversion | null>(256);
let conversionUtils: UcumLhcConversionUtils | null | undefined;

/**
 * Express `value`, given in `fromCode`, in `toCode`. Returns null when the two
 * units are not commensurable or when ucum-lhc is unavailable: the caller then
 * has no basis for an ordering and must not report one.
 */
export function convertUcumValue(value: number, fromCode: string, toCode: string): number | null {
    if (fromCode === toCode) return value;
    const conversion = resolveConversion(fromCode, toCode);
    return conversion ? conversion.scale * value + conversion.offset : null;
}

/** Test seam: the lazy singleton and its cache must not leak between cases. */
export function resetUcumConversionCache(): void {
    conversions.clear();
    conversionUtils = undefined;
}

function resolveConversion(fromCode: string, toCode: string): UnitConversion | null {
    const key = `${fromCode}|${toCode}`;
    const cached = conversions.get(key);
    if (cached !== undefined) return cached;

    const offset = convertOnce(fromCode, 0, toCode);
    const atOne = convertOnce(fromCode, 1, toCode);
    const scale = offset !== null && atOne !== null ? atOne - offset : 0;
    // A non-positive scale would invert the ordering; no UCUM unit does that,
    // so treating it as incomparable is safer than trusting the arithmetic.
    const conversion = offset !== null && scale > 0 ? { scale, offset } : null;
    conversions.set(key, conversion);
    return conversion;
}

function convertOnce(fromCode: string, value: number, toCode: string): number | null {
    const utils = getConversionUtils();
    if (!utils) return null;
    try {
        const result = asRecord(utils.convertUnitTo(fromCode, value, toCode));
        if (result?.status !== 'succeeded') return null;
        const converted = result.toVal;
        return typeof converted === 'number' && Number.isFinite(converted) ? converted : null;
    } catch (error) {
        logger.debug('[UcumConversion] convertUnitTo threw', validationFailureMetadata(error));
        return null;
    }
}

function getConversionUtils(): UcumLhcConversionUtils | null {
    if (conversionUtils !== undefined) return conversionUtils;
    try {
        const factory = asPropertyBag(asPropertyBag(cjsRequire('@lhncbc/ucum-lhc'))?.UcumLhcUtils);
        if (typeof factory?.getInstance !== 'function') {
            throw new TypeError('UCUM module does not expose UcumLhcUtils.getInstance');
        }
        const instance: unknown = factory.getInstance.call(factory);
        conversionUtils = typeof asRecord(instance)?.convertUnitTo === 'function'
            ? instance as UcumLhcConversionUtils
            : null;
    } catch (error) {
        logger.debug('[UcumConversion] ucum-lhc is unavailable', validationFailureMetadata(error));
        conversionUtils = null;
    }
    return conversionUtils;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

// `UcumLhcUtils` is a class, so the factory lookup has to accept a function.
function asPropertyBag(value: unknown): Record<string, unknown> | undefined {
    return (typeof value === 'object' && value !== null) || typeof value === 'function'
        ? value as Record<string, unknown>
        : undefined;
}
