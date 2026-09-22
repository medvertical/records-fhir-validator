/**
 * Compares slicing declarations for StructureDefinitions that claim
 * structuredefinition-compliesWithProfile conformance.
 */

import {
  indexSlicingParents,
  type DiscriminatorValue,
  type SliceRecord,
} from './complies-with-slicing-index.js';

export { indexSlicingParents } from './complies-with-slicing-index.js';

interface SlicingDiff {
  rulesMismatchPath?: string;
  rulesMismatchBase?: string;
  rulesMismatchDerived?: string;
  missingRequiredSlices: SliceRecord[];
  extraInClosedSlices: SliceRecord[];
}

export function diffSlicing(
  baseElements: unknown,
  derivedElements: unknown,
): SlicingDiff[] {
  const baseParents = indexSlicingParents(baseElements);
  const derivedParents = indexSlicingParents(derivedElements);
  const diffs: SlicingDiff[] = [];

  for (const [parentPath, baseParent] of baseParents) {
    const derivedParent = derivedParents.get(parentPath);
    const diff: SlicingDiff = {
      missingRequiredSlices: [],
      extraInClosedSlices: [],
    };

    if (
      derivedParent
      && isLooserSlicingRule(baseParent.rules, derivedParent.rules)
    ) {
      diff.rulesMismatchPath = parentPath;
      diff.rulesMismatchBase = baseParent.rules;
      diff.rulesMismatchDerived = derivedParent.rules;
    }

    const closedRules = baseParent.rules === 'closed';
    for (const baseSlice of baseParent.slices) {
      const required = closedRules || (baseSlice.min ?? 0) >= 1;
      if (!required) continue;
      const match = derivedParent?.slices.find(derivedSlice =>
        slicesMatch(baseSlice, derivedSlice)
      );
      if (!match) diff.missingRequiredSlices.push(baseSlice);
    }

    if (closedRules && derivedParent && !diff.rulesMismatchPath) {
      for (const derivedSlice of derivedParent.slices) {
        const match = baseParent.slices.find(baseSlice =>
          slicesMatch(baseSlice, derivedSlice)
        );
        if (!match) diff.extraInClosedSlices.push(derivedSlice);
      }
    }

    diffs.push(diff);
  }

  return diffs;
}

function slicesMatch(base: SliceRecord, derived: SliceRecord): boolean {
  if (base.discriminatorCount !== derived.discriminatorCount) return false;
  if (base.discriminatorCount === 0) {
    return base.sliceName === derived.sliceName;
  }

  const baseComplete =
    base.discriminatorValues.length === base.discriminatorCount;
  const derivedComplete =
    derived.discriminatorValues.length === derived.discriminatorCount;
  if (!baseComplete || !derivedComplete) {
    const neitherHasEvidence =
      base.discriminatorValues.length === 0
      && derived.discriminatorValues.length === 0;
    return neitherHasEvidence && base.sliceName === derived.sliceName;
  }

  return base.discriminatorValues.every(baseValue =>
    derived.discriminatorValues.some(derivedValue =>
      discriminatorValuesEqual(baseValue, derivedValue)
    )
  );
}

function discriminatorValuesEqual(
  first: DiscriminatorValue,
  second: DiscriminatorValue,
): boolean {
  return first.type === second.type
    && first.path === second.path
    && first.fhirType === second.fhirType
    && first.value === second.value;
}

function isLooserSlicingRule(
  baseRule: string | undefined,
  derivedRule: string | undefined,
): boolean {
  if (!derivedRule || !baseRule) return false;
  if (baseRule === 'closed') return derivedRule !== 'closed';
  if (baseRule === 'openAtEnd') return derivedRule === 'open';
  return false;
}

export function describeMissingRequiredSlice(slice: SliceRecord): string {
  const discriminator = slice.discriminatorValues[0];
  if (!discriminator) {
    return `Mismatch in slicing at ${slice.id}: no slice found`;
  }
  return `Mismatch in slicing at ${slice.id}: no slice found for the discriminator ${discriminator.type}:${discriminator.path} with the values ${discriminator.fhirType}Type[${discriminator.value}]`;
}

export function describeExtraSlice(parentPath: string, slice: SliceRecord): string {
  return `Mismatch in slicing at ${parentPath}: extra slice '${slice.sliceName}' not found in the claimed profile`;
}

export function describeRulesMismatch(diff: SlicingDiff): string {
  return `Mismatch in slicing rules at ${diff.rulesMismatchPath}: '${diff.rulesMismatchDerived}' when the claimed profile has '${diff.rulesMismatchBase}'`;
}
