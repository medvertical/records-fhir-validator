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

import type { ValidationIssue } from '../types';
import type { StructureDefinition } from '../core/structure-definition-types';
import type { StructureDefinitionLoader } from '../core/structure-definition-loader';
import { createValidationIssue } from '../issues';
import {
  diffSlicing,
  describeMissingRequiredSlice,
  describeExtraSlice,
  describeRulesMismatch,
} from './complies-with-slicing';

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

export class CompliesWithValidator {
  constructor(private sdLoader: StructureDefinitionLoader) {}

  async validate(
    sd: any,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): Promise<ValidationIssue[]> {
    if (sd?.resourceType !== 'StructureDefinition') return [];
    const claimed = extractClaimedProfileUrls(sd);
    if (claimed.length === 0) return [];

    const issues: ValidationIssue[] = [];
    for (const url of claimed) {
      const baseSd = await this.loadClaimedProfile(url, fhirVersion);
      if (!baseSd) continue;
      issues.push(...checkCompliance(sd, baseSd, url));
    }
    return issues;
  }

  private async loadClaimedProfile(
    url: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<StructureDefinition | null> {
    try {
      return await this.sdLoader.loadProfile(url, fhirVersion);
    } catch {
      return null;
    }
  }
}

function extractClaimedProfileUrls(sd: any): string[] {
  const urls: string[] = [];
  for (const ext of sd?.extension || []) {
    if (ext?.url === COMPLIES_WITH_EXT_URL && typeof ext.valueCanonical === 'string') {
      urls.push(ext.valueCanonical.split('|')[0]);
    }
  }
  return urls;
}

function checkCompliance(derived: any, base: any, claimedUrl: string): ValidationIssue[] {
  const baseElements: any[] = base?.snapshot?.element || base?.differential?.element || [];
  const derivedElements: any[] = derived?.snapshot?.element || derived?.differential?.element || [];

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

function indexById(elements: any[]): Map<string, DiffElement> {
  const map = new Map<string, DiffElement>();
  for (const el of elements) {
    const key = el?.id || el?.path;
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
  baseSd: any,
  derivedSd: any,
): string[] {
  const baseStrength = base.binding?.strength;
  const baseValueSet = base.binding?.valueSet;
  const derivedValueSet = derived?.binding?.valueSet;
  if (!baseStrength || !baseValueSet || !derivedValueSet) return [];
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

function resolveLocalValueSetCodes(valueSetRef: string, sd: any): Set<string> | null {
  const ref = valueSetRef.split('|')[0];
  const contained = Array.isArray(sd?.contained) ? sd.contained : [];
  const valueSet = contained.find((item: any) =>
    item?.resourceType === 'ValueSet' && (
      (ref.startsWith('#') && item.id === ref.slice(1)) ||
      item.url === ref
    )
  );
  if (!valueSet) return null;
  return extractSimpleValueSetCodes(valueSet);
}

function extractSimpleValueSetCodes(valueSet: any): Set<string> | null {
  const codes = new Set<string>();
  const add = (system: string | undefined, code: string | undefined): void => {
    if (!code) return;
    codes.add(system ? `${system}|${code}` : code);
  };

  const visitContains = (items: any[]): void => {
    for (const item of items) {
      add(item?.system, item?.code);
      if (Array.isArray(item?.contains)) visitContains(item.contains);
    }
  };

  if (Array.isArray(valueSet?.expansion?.contains)) {
    visitContains(valueSet.expansion.contains);
  }

  for (const include of valueSet?.compose?.include ?? []) {
    if (Array.isArray(include?.filter) && include.filter.length > 0) return null;
    if (Array.isArray(include?.valueSet) && include.valueSet.length > 0) return null;
    if (!Array.isArray(include?.concept)) return null;
    for (const concept of include.concept) {
      add(include.system, concept?.code);
    }
  }

  return codes.size > 0 ? codes : null;
}

function formatCodeList(codes: string[]): string {
  return codes
    .map(code => code.includes('|') ? code.split('|').slice(1).join('|') : code)
    .sort()
    .join(', ');
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
    (base as any).patternCodeableConcept || (base as any).fixedCodeableConcept;
  const derivedPattern =
    (derived as any).patternCodeableConcept || (derived as any).fixedCodeableConcept;
  if (!basePattern || !derivedPattern) return [];
  if (codeableConceptComplies(derivedPattern, basePattern)) return [];
  return [`The pattern value of '${formatCodeableConcept(derivedPattern)}' on the path ${path} does not comply with the value '${formatCodeableConcept(basePattern)}' from the claimed profile`];
}

function codeableConceptComplies(derived: any, base: any): boolean {
  const baseCodings = Array.isArray(base?.coding) ? base.coding : [];
  const derivedCodings = Array.isArray(derived?.coding) ? derived.coding : [];
  for (const baseCoding of baseCodings) {
    const ok = derivedCodings.some((d: any) => codingMatches(d, baseCoding));
    if (!ok) return false;
  }
  return true;
}

function codingMatches(derived: any, base: any): boolean {
  if (base?.system && derived?.system !== base.system) return false;
  if (base?.code && derived?.code !== base.code) return false;
  if (base?.version && derived?.version !== base.version) return false;
  return true;
}

function formatCodeableConcept(cc: any): string {
  const codings = Array.isArray(cc?.coding) ? cc.coding : [];
  return `[${codings.map(formatCoding).join(', ')}]`;
}

function formatCoding(c: any): string {
  const system = c?.system || '';
  const version = c?.version ? `|${c.version}` : '';
  const code = c?.code || '';
  return `${system}${version}#${code}`;
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
