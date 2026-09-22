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
import { logger } from '../logger.js';
import { BoundedLruCache } from '../cache/bounded-lru-cache.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';

// `ucum-lhc` ships only a CJS entry point (`source-cjs/ucumPkg.js`) and
// exports a singleton factory. Under ESM the plain `require` keyword is
// undefined, so we build a real CJS-style `require` via `createRequire`.
const cjsRequire = createRequire(import.meta.url);

export const UCUM_SYSTEM_URL = 'http://unitsofmeasure.org';

export interface UcumValidationResult {
  valid: boolean;
  message?: string;
  /**
   * Correction suggested by ucum-lhc's own engine for an invalid code
   * (e.g. `mmHg` → `mm[Hg]`). Generalises beyond the curated static table.
   */
  suggestion?: { code: string; display?: string };
}

interface UcumLhcUtils {
  validateUnitString(code: string, includeSuggestions: boolean): unknown;
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
export class UcumCodeValidator {
  private readonly codeCache = new BoundedLruCache<string, UcumValidationResult>(2_000);
  private ucumUtils: UcumLhcUtils | null = null;
  private initFailed = false;

  validate(code: string | undefined | null): UcumValidationResult {
    if (code === undefined || code === null || code === '') return { valid: true };
    const cached = this.codeCache.get(code);
    if (cached) return cached;

    const utils = this.getUcumUtils();
    if (!utils) {
      const result = { valid: true };
      this.codeCache.set(code, result);
      return result;
    }

    let result: UcumValidationResult;
    try {
      const parsed = asRecord(utils.validateUnitString(normalizeAnnotationSpaces(code), true));
      if (parsed?.status === 'valid') {
        result = { valid: true };
      } else {
        const msg = Array.isArray(parsed?.msg) && typeof parsed.msg[0] === 'string'
          ? parsed.msg[0]
          : `'${code}' is not a valid UCUM expression`;
        result = { valid: false, message: msg, suggestion: extractUcumLhcSuggestion(parsed, code, utils) };
      }
    } catch (err) {
      logger.debug('[UcumValidator] validateUnitString threw', {
        codeLength: code.length,
        ...validationFailureMetadata(err),
      });
      result = { valid: true };
    }

    this.codeCache.set(code, result);
    return result;
  }

  clear(): void {
    this.codeCache.clear();
  }

  private getUcumUtils(): UcumLhcUtils | null {
    if (this.initFailed) return null;
    if (this.ucumUtils) return this.ucumUtils;
    try {
      const moduleValue: unknown = cjsRequire('@lhncbc/ucum-lhc');
      const factory = asPropertyBag(asPropertyBag(moduleValue)?.UcumLhcUtils);
      if (typeof factory?.getInstance !== 'function') {
        throw new TypeError('UCUM module does not expose UcumLhcUtils.getInstance');
      }
      const instance: unknown = factory.getInstance.call(factory);
      if (!isUcumLhcUtils(instance)) {
        throw new TypeError('UCUM utility instance does not expose validateUnitString');
      }
      this.ucumUtils = instance;
      return this.ucumUtils;
    } catch (err) {
      this.initFailed = true;
      logger.warn(
        '[UcumValidator] @lhncbc/ucum-lhc not available, UCUM validation disabled',
        validationFailureMetadata(err),
      );
      return null;
    }
  }
}

/**
 * Pull the top correction out of ucum-lhc's `suggestions` payload. Shape:
 * `[{ invalidUnit, units: [[code, display, ...], ...] }]`. Suggestions can
 * describe a single atom, so reconstruct and validate the complete expression.
 */
function extractUcumLhcSuggestion(
  parsed: unknown,
  originalCode: string,
  utils: UcumLhcUtils,
): { code: string; display?: string } | undefined {
  const normalizedCode = asRecord(parsed)?.ucumCode;
  // Parser diagnostics can name only the bad atom (HPF), while ucumCode
  // preserves the whole expression (/[HPF]), including denominators.
  if (typeof normalizedCode === 'string' && normalizedCode !== originalCode
    && isValidCorrection(normalizedCode, utils)) {
    const annotations = originalCode.match(/\{[^{}]*\}/g) ?? [];
    let annotationIndex = 0;
    return { code: normalizedCode.replace(/\{[^{}]*\}/g, match => annotations[annotationIndex++] ?? match) };
  }
  const suggestions = asRecord(parsed)?.suggestions;
  let candidate = originalCode;
  let display: string | undefined;
  for (const entry of Array.isArray(suggestions) ? suggestions : []) {
    const suggestion = asRecord(entry);
    const firstUnit = Array.isArray(suggestion?.units) ? suggestion.units[0] : undefined;
    if (typeof suggestion?.invalidUnit !== 'string' || !Array.isArray(firstUnit)) continue;
    // ucum-lhc suggests m[IU]/L for the atom mIU, even in mIU/dL. The
    // denominator comes from the original expression, never the suggestion.
    const replacement = suggestion.invalidUnit === 'mIU' ? 'm[IU]' : firstUnit[0];
    if (typeof replacement !== 'string' || !isUnitAtom(replacement)) continue;
    candidate = replaceUcumAtom(candidate, suggestion.invalidUnit, replacement);
    if (candidate === replacement && replacement === firstUnit[0] && typeof firstUnit[1] === 'string') {
      display = firstUnit[1];
    }
  }
  const messages = asRecord(parsed)?.msg;
  for (const message of Array.isArray(messages) ? messages : []) {
    if (typeof message !== 'string') continue;
    const correction = message.match(/^(\S+) is not a valid unit expression[^\n]*\nDid you mean\s+(\S+)/);
    if (correction && isUnitAtom(correction[2])) {
      candidate = replaceUcumAtom(candidate, correction[1], correction[2]);
    }
  }
  return candidate !== originalCode && isValidCorrection(candidate, utils)
    ? { code: candidate, ...(display ? { display } : {}) }
    : undefined;
}

function isUnitAtom(code: string): boolean {
  return code.length > 0 && !/[./(){}\s]/.test(code.replace(/\[[^\]]*\]/g, 'unit'));
}

function replaceUcumAtom(expression: string, invalidAtom: string, replacement: string): string {
  return expression.replace(/\{[^{}]*\}|(?:\[[^\]]*\]|[^./(){}[\]])+/g, token => {
    if (token.startsWith('{')) return token;
    if (token === invalidAtom) return replacement;
    const exponent = token.slice(invalidAtom.length);
    return token.startsWith(invalidAtom) && /^[+-]?\d+$/.test(exponent)
      ? replacement + exponent : token;
  });
}

function isValidCorrection(code: string, utils: UcumLhcUtils): boolean {
  try {
    return asRecord(utils.validateUnitString(normalizeAnnotationSpaces(code), false))?.status === 'valid';
  } catch {
    // Failure while checking a suggestion must not turn the original invalid
    // expression into the validator's fail-open result.
    return false;
  }
}

function isUcumLhcUtils(value: unknown): value is UcumLhcUtils {
  return typeof asRecord(value)?.validateUnitString === 'function';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asPropertyBag(value: unknown): Record<string, unknown> | undefined {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? value as Record<string, unknown>
    : undefined;
}

export function ucumCodeHasAnnotation(code: string | undefined | null): boolean {
  return typeof code === 'string' && /\{[^{}]*\}/.test(code);
}

/**
 * ucum-lhc enforces the strict UCUM annotation grammar (chars 33-126), but
 * the HL7 reference validator accepts spaces inside `{...}` and official IG
 * examples rely on that (e.g. `{keer per dag inhaleren}` in hl7.fhir.eu.hdr).
 * Annotations carry no semantics, so spaces are masked before parsing;
 * every other annotation character still reaches ucum-lhc unchanged.
 */
function normalizeAnnotationSpaces(code: string): string {
  if (!code.includes('{')) return code;
  return code.replace(/\{[^{}]*\}/g, annotation => annotation.replace(/ /g, '_'));
}

/**
 * Convenience: check whether a Quantity-shaped value carries a UCUM code
 * that the validator should evaluate. FHIR profiles can declare
 * `system` implicitly, but we deliberately require it to be present and
 * equal to the UCUM URL — a quantity without a system is a different
 * kind of problem (tracked by structural validation, not terminology).
 */
export function quantityUsesUcum(value: unknown): value is { system: string; code: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const quantity = value as Record<string, unknown>;
  return (
    quantity.system === UCUM_SYSTEM_URL &&
    typeof quantity.code === 'string'
  );
}
