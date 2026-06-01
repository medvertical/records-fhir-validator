/**
 * UCUM Validator
 * --------------
 *
 * Thin wrapper around `@lhncbc/ucum-lhc` to validate Unified Code for
 * Units of Measure (UCUM) expressions that appear in FHIR `Quantity`
 * (and its specialisations: `SimpleQuantity`, `Age`, `Duration`,
 * `Distance`, `Count`, `Money`, …) `code` fields when the `system`
 * is `http://unitsofmeasure.org`.
 *
 * The `ucum-lhc` package has to build its unit tables on first use
 * which is ~100-300 ms. We initialise the singleton lazily so the
 * validator startup is not penalised when no UCUM codes are present.
 *
 * This closes the Phase A corpus miss for
 * `observation-ucum-code-rewritten.json` — Records used to only
 * check CodeableConcept/Coding elements, which left
 * `Quantity.code` silently unvalidated.
 */

import { createRequire } from 'module';
import { logger } from '../logger';

// `ucum-lhc` ships only a CJS entry point (`source-cjs/ucumPkg.js`) and
// exports a singleton factory. Under ESM the plain `require` keyword is
// undefined, so we build a real CJS-style `require` via `createRequire`.
const cjsRequire = createRequire(import.meta.url);

export const UCUM_SYSTEM_URL = 'http://unitsofmeasure.org';

interface UcumValidationResult {
  valid: boolean;
  message?: string;
  /**
   * Correction suggested by ucum-lhc's own engine for an invalid code
   * (e.g. `mmHg` → `mm[Hg]`). Generalises beyond the curated static table.
   */
  suggestion?: { code: string; display?: string };
}

/**
 * Cached result per UCUM expression so a bundle full of
 * `mg/dL` quantities doesn't hit the UnitString parser over and over.
 */
const codeCache = new Map<string, UcumValidationResult>();

let ucumUtilsSingleton: any = null;
let initFailed = false;

function getUcumUtils(): any | null {
  if (initFailed) return null;
  if (ucumUtilsSingleton) return ucumUtilsSingleton;
  try {
    // `ucum-lhc` is CJS and expensive to load — do it lazily.
    const { UcumLhcUtils } = cjsRequire('@lhncbc/ucum-lhc');
    ucumUtilsSingleton = UcumLhcUtils.getInstance();
    return ucumUtilsSingleton;
  } catch (err) {
    initFailed = true;
    logger.warn(
      '[UcumValidator] @lhncbc/ucum-lhc not available, UCUM validation disabled',
      { err: err instanceof Error ? err.message : String(err) },
    );
    return null;
  }
}

/**
 * Validate a single UCUM expression.
 *
 * Returns `{ valid: true }` if the code parses as a valid UCUM
 * expression (including composed units like `mg/dL`, `10*3/uL`), or
 * `{ valid: false, message }` otherwise.
 *
 * Empty / falsy input is treated as valid — callers are expected to
 * pre-filter for presence because "no UCUM code" is a different bug
 * than "invalid UCUM code".
 */
export function validateUcumCode(code: string | undefined | null): UcumValidationResult {
  if (code === undefined || code === null || code === '') {
    return { valid: true };
  }
  const cached = codeCache.get(code);
  if (cached) return cached;

  const utils = getUcumUtils();
  if (!utils) {
    // If the library is unavailable we cannot make a negative claim.
    // Record a pass so we don't false-positive; a warning was already
    // logged at init time.
    const result = { valid: true };
    codeCache.set(code, result);
    return result;
  }

  let result: UcumValidationResult;
  try {
    // `suggest = true` makes ucum-lhc propose corrections for invalid codes.
    const parsed = utils.validateUnitString(code, true);
    if (parsed && parsed.status === 'valid') {
      result = { valid: true };
    } else {
      const msg = Array.isArray(parsed?.msg) && parsed.msg.length > 0
        ? parsed.msg[0]
        : `'${code}' is not a valid UCUM expression`;
      result = { valid: false, message: msg, suggestion: extractUcumLhcSuggestion(parsed) };
    }
  } catch (err) {
    // Library threw — fail open, log for diagnosis.
    logger.debug(`[UcumValidator] validateUnitString threw on '${code}':`, err);
    result = { valid: true };
  }

  codeCache.set(code, result);
  return result;
}

/**
 * Pull the top correction out of ucum-lhc's `suggestions` payload. Shape:
 * `[{ invalidUnit, units: [[code, display, ...], ...] }]`. Returns the first
 * suggested unit, or undefined when the engine offers none.
 */
function extractUcumLhcSuggestion(parsed: any): { code: string; display?: string } | undefined {
  const units = parsed?.suggestions?.[0]?.units;
  if (!Array.isArray(units) || units.length === 0) return undefined;
  const [code, display] = units[0];
  if (typeof code !== 'string' || code.length === 0) return undefined;
  return typeof display === 'string' && display.length > 0 ? { code, display } : { code };
}

export function ucumCodeHasAnnotation(code: string | undefined | null): boolean {
  return typeof code === 'string' && /\{[^{}]*\}/.test(code);
}

/**
 * Convenience: check whether a Quantity-shaped value carries a UCUM code
 * that the validator should evaluate. FHIR profiles can declare
 * `system` implicitly, but we deliberately require it to be present and
 * equal to the UCUM URL — a quantity without a system is a different
 * kind of problem (tracked by structural validation, not terminology).
 */
export function quantityUsesUcum(value: unknown): value is { system: string; code: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as any).system === UCUM_SYSTEM_URL &&
    typeof (value as any).code === 'string'
  );
}
