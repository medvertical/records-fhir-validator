/**
 * compliesWithProfile — derived StructureDefinition compliance check.
 *
 * When an SD carries the `structuredefinition-compliesWithProfile` extension,
 * it claims that every constraint of the named parent profile is at least as
 * strictly carried by this derived profile. Java enforces this with one
 * `business-rule` error per detected non-compliance:
 *
 *   "This profile does not comply with claimed profile '<url>' because:
 *    The min value of '0' on the path Patient.name does not comply with the
 *    value '1' from the claimed profile"
 *
 * Records emits the same diagnostics for the conformance fixture set:
 * cardinality (loosened min, widened max, max=0 forcing effective min=0),
 * missing constraints, weakened binding strength, ValueSet inequality
 * for required/extensible bindings (cw-binding-superset, conservative
 * URL-equality heuristic — full expansion intersection is upstream
 * follow-up), slicing rule and presence mismatches, and CodeableConcept
 * pattern/fixed conflicts. The snapshot generator-driven cw-slice-adds
 * remains pending.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import type { StructureDefinition } from '../core/structure-definition-types.js';
import type { StructureDefinitionLoader } from '../core/structure-definition-loader.js';
import { createValidationIssue } from '../issues/index.js';
import { createProfileUnreadable } from '../issues/profile-completeness-issues.js';
import {
  codeableConceptComplies,
  formatCodeableConcept,
} from './complies-with-codeable-concepts.js';
import {
  diffSlicing,
  describeMissingRequiredSlice,
  describeExtraSlice,
  describeRulesMismatch,
} from './complies-with-slicing.js';
import {
  formatCodeList,
  resolveLocalValueSetCodes,
} from './complies-with-valueset.js';

const COMPLIES_WITH_EXT_URL =
  'http://hl7.org/fhir/StructureDefinition/structuredefinition-compliesWithProfile';

const BINDING_STRENGTH_RANK: Record<string, number> = {
  required: 4,
  extensible: 3,
  preferred: 2,
  example: 1,
};

interface DiffElement {
  id?: string;
  path?: string;
  min?: number;
  max?: string;
  binding?: { strength?: string; valueSet?: string };
  constraint?: Array<{ key?: string; expression?: string }>;
  [k: string]: unknown;
}

type ObjectRecord = Record<string, unknown>;

export class CompliesWithValidator {
  constructor(private sdLoader: StructureDefinitionLoader) {}

  async validate(
    sd: unknown,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): Promise<ValidationIssue[]> {
    if (!isObjectRecord(sd) || sd.resourceType !== 'StructureDefinition') return [];
    const claimed = extractClaimedProfileUrls(sd);
    if (claimed.length === 0) return [];

    const issues: ValidationIssue[] = [];
    for (const url of claimed) {
      const loaded = await this.loadClaimedProfile(url, fhirVersion);
      if (loaded.loadFailure) issues.push(loaded.loadFailure);
      if (!loaded.structureDef) continue;
      issues.push(...checkCompliance(sd, loaded.structureDef, url));
    }
    return issues;
  }

  /**
   * A claim this validator cannot load is not a claim it can clear. The loader
   * answers `null` when the profile is absent, so a throw is a different
   * outcome and must not silently drop the compliance check.
   */
  private async loadClaimedProfile(
    url: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<{ structureDef: StructureDefinition | null; loadFailure?: ValidationIssue }> {
    try {
      return { structureDef: await this.sdLoader.loadProfile(url, fhirVersion) };
    } catch (error: unknown) {
      return {
        structureDef: null,
        loadFailure: createProfileUnreadable({
          profileUrl: url,
          resourceType: 'StructureDefinition',
          reason: 'claimed-profile',
          error,
        }),
      };
    }
  }
}

function extractClaimedProfileUrls(sd: ObjectRecord): string[] {
  const urls = new Set<string>();
  const extensions = Array.isArray(sd.extension) ? sd.extension : [];
  for (const ext of extensions) {
    if (isObjectRecord(ext) &&
        ext.url === COMPLIES_WITH_EXT_URL &&
        typeof ext.valueCanonical === 'string') {
      const canonical = ext.valueCanonical;
      if (canonical) urls.add(canonical);
    }
  }
  return [...urls];
}

function checkCompliance(
  derived: ObjectRecord,
  base: StructureDefinition,
  claimedUrl: string,
): ValidationIssue[] {
  const baseElements = getStructureDefinitionElements(base);
  const derivedElements = getStructureDefinitionElements(derived);

  const baseById = indexById(baseElements);
  const derivedById = indexById(derivedElements);

  const reasons: string[] = [];

  for (const [id, baseElem] of baseById) {
    const derivedElem = derivedById.get(id);
    const reportPath = baseElem.id || baseElem.path || '';
    reasons.push(...cardinalityReasons(reportPath, baseElem, derivedElem));
    reasons.push(...constraintReasons(baseElem, derivedElem));
    reasons.push(...bindingStrengthReasons(reportPath, baseElem, derivedElem));
    reasons.push(...bindingValueSetReasons(reportPath, baseElem, derivedElem, base, derived));
    reasons.push(...patternFixedReasons(reportPath, baseElem, derivedElem));
  }

  for (const slicingDiff of diffSlicing(baseElements, derivedElements)) {
    if (slicingDiff.rulesMismatchPath) {
      reasons.push(describeRulesMismatch(slicingDiff));
    }
    for (const missing of slicingDiff.missingRequiredSlices) {
      reasons.push(describeMissingRequiredSlice(missing));
    }
    if (slicingDiff.extraInClosedSlices.length > 0) {
      const parent = slicingDiff.extraInClosedSlices[0].parentPath;
      for (const extra of slicingDiff.extraInClosedSlices) {
        reasons.push(describeExtraSlice(parent, extra));
      }
    }
  }

  if (reasons.length === 0) return [];
  // Java emits a single OperationOutcome.issue per claimed profile, with
  // every reason joined by " and ".
  return [buildIssue(claimedUrl, reasons.join(' and '))];
}

function indexById(elements: DiffElement[]): Map<string, DiffElement> {
  const map = new Map<string, DiffElement>();
  for (const el of elements) {
    const key = typeof el.id === 'string'
      ? el.id
      : typeof el.path === 'string' ? el.path : undefined;
    if (!key) continue;
    if (!map.has(key)) map.set(key, el);
  }
  return map;
}

function cardinalityReasons(
  path: string,
  base: DiffElement,
  derived: DiffElement | undefined,
): string[] {
  const out: string[] = [];
  if (typeof base.min === 'number') {
    // max="0" prohibits the element, which forces the effective min to 0
    // even when the derived differential omits an explicit min override.
    const derivedMin = derived?.max === '0'
      ? 0
      : (typeof derived?.min === 'number' ? derived.min : undefined);
    if (derivedMin !== undefined && derivedMin < base.min) {
      out.push(
        `The min value of '${derivedMin}' on the path ${path} does not comply with the value '${base.min}' from the claimed profile`,
      );
    }
  }
  if (typeof base.max === 'string' && base.max.length > 0) {
    const derivedMax = typeof derived?.max === 'string' ? derived.max : undefined;
    if (derivedMax !== undefined && !isMaxAtLeastAsTight(derivedMax, base.max)) {
      out.push(
        `The max value of '${derivedMax}' on the path ${path} does not comply with the value '${base.max}' from the claimed profile`,
      );
    }
  }
  return out;
}

function isMaxAtLeastAsTight(derivedMax: string, baseMax: string): boolean {
  if (baseMax === '*') return true;
  const baseN = parseInt(baseMax, 10);
  if (Number.isNaN(baseN)) return true;
  if (derivedMax === '*') return false;
  const derivedN = parseInt(derivedMax, 10);
  if (Number.isNaN(derivedN)) return false;
  return derivedN <= baseN;
}

function constraintReasons(
  base: DiffElement,
  derived: DiffElement | undefined,
): string[] {
  if (!Array.isArray(base.constraint) || base.constraint.length === 0) return [];
  const derivedKeys = new Set(
    (derived?.constraint || []).map((c) => c?.key).filter(Boolean) as string[],
  );
  const out: string[] = [];
  for (const c of base.constraint) {
    if (!c?.key || derivedKeys.has(c.key)) continue;
    const label = c.expression || c.key;
    out.push(`The constraint '${label}' is defined in the claimed profile, but missing`);
  }
  return out;
}

function bindingStrengthReasons(
  path: string,
  base: DiffElement,
  derived: DiffElement | undefined,
): string[] {
  const baseStrength = base.binding?.strength;
  const derivedStrength = derived?.binding?.strength;
  if (!baseStrength || !derivedStrength) return [];
  const baseRank = BINDING_STRENGTH_RANK[baseStrength];
  const derivedRank = BINDING_STRENGTH_RANK[derivedStrength];
  if (!baseRank || !derivedRank) return [];
  if (derivedRank >= baseRank) return [];
  return [`The binding.strength value of '${derivedStrength.toUpperCase()}' on the path ${path} does not comply with the value '${baseStrength.toUpperCase()}' from the claimed profile`];
}

/**
 * Binding-valueSet compliance check (cw-binding-superset / subset).
 *
 * Java's full check intersects the two ValueSet expansions and rejects
 * when the derived expansion contains codes not in the base expansion.
 * For inline/contained ValueSets with simple concept lists, Records can
 * make that subset decision directly. If either side needs full expansion
 * (filters, compose imports, entire CodeSystems), it falls back to the
 * conservative URL inequality signal.
 */
function bindingValueSetReasons(
  path: string,
  base: DiffElement,
  derived: DiffElement | undefined,
  baseSd: StructureDefinition,
  derivedSd: ObjectRecord,
): string[] {
  const baseStrength = base.binding?.strength;
  const baseValueSet = base.binding?.valueSet;
  const derivedValueSet = derived?.binding?.valueSet;
  if (!baseStrength || !baseValueSet || !derivedValueSet) return [];
  if (derived?.binding?.strength !== baseStrength) return [];
  // Only enforce on bindings strong enough to constrain the instance.
  if (baseStrength !== 'required' && baseStrength !== 'extensible') return [];
  // Strip version anchors (`|<version>`) so `vs|1.0.0` and `vs|2.0.0`
  // count as the same canonical for compliance purposes.
  const baseCanonical = baseValueSet.split('|')[0];
  const derivedCanonical = derivedValueSet.split('|')[0];
  if (baseCanonical === derivedCanonical) return [];

  const baseCodes = resolveLocalValueSetCodes(baseValueSet, baseSd);
  const derivedCodes = resolveLocalValueSetCodes(derivedValueSet, derivedSd);
  if (baseCodes && derivedCodes) {
    const extraCodes = [...derivedCodes].filter(code => !baseCodes.has(code));
    if (extraCodes.length === 0) return [];
    return [`The valueSet ${derivedValueSet} includes codes not allowed in the claimed profile which has value set ${baseValueSet} (codes: ${formatCodeList(extraCodes)})`];
  }

  return [`The binding.valueSet value of '${derivedValueSet}' on the path ${path} does not comply with the value '${baseValueSet}' from the claimed profile`];
}

function patternFixedReasons(
  path: string,
  base: DiffElement,
  derived: DiffElement | undefined,
): string[] {
  if (!derived) return [];
  // Only CodeableConcept pattern/fixed comparisons are needed for the
  // current conformance fixtures; other types fall through silently.
  const basePattern =
    base.patternCodeableConcept ?? base.fixedCodeableConcept;
  const derivedPattern =
    derived.patternCodeableConcept ?? derived.fixedCodeableConcept;
  if (!basePattern || !derivedPattern) return [];
  if (codeableConceptComplies(derivedPattern, basePattern)) return [];
  return [`The pattern value of '${formatCodeableConcept(derivedPattern)}' on the path ${path} does not comply with the value '${formatCodeableConcept(basePattern)}' from the claimed profile`];
}

function buildIssue(claimedUrl: string, reason: string): ValidationIssue {
  return createValidationIssue({
    code: 'sd-complies-with-violation',
    path: 'StructureDefinition',
    resourceType: 'StructureDefinition',
    customMessage:
      `This profile does not comply with claimed profile '${claimedUrl}' because: ${reason}`,
    severityOverride: 'error',
  });
}

function getStructureDefinitionElements(sd: unknown): DiffElement[] {
  if (!isObjectRecord(sd)) return [];
  const snapshot = isObjectRecord(sd.snapshot) ? sd.snapshot : null;
  const differential = isObjectRecord(sd.differential) ? sd.differential : null;
  const elements = Array.isArray(snapshot?.element)
    ? snapshot.element
    : Array.isArray(differential?.element) ? differential.element : [];
  return elements.filter(isObjectRecord);
}

function isObjectRecord(value: unknown): value is ObjectRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
