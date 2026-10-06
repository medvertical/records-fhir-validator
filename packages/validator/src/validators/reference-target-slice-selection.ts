import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ElementDefinition, StructureDefinition } from '../core/structure-definition-types.js';
import type { ProfileReferenceSource } from '../core/profile-reference-authority.js';
import { getValidationTargets } from '../business-rules/element-validation-targets.js';
import { createValidationIssue } from '../issues/index.js';
import { extractSlicingInfo } from './slice-info-extractor.js';
import { assessElementSliceMembership } from './slicing-match-policy.js';
import { usesResolvedCodeDiscrimination } from './slice-resolved-code-discriminator.js';
import type { ReferenceResolver } from './slice-types.js';

/** Selected definition and occurrence identities belong only to this reference pass. */
export async function prepareReferenceTargetSliceSelections(
  resource: Record<string, unknown>,
  profile: StructureDefinition,
  resolveReference: ReferenceResolver,
  loadDefinition: (url: string, source: ProfileReferenceSource) => Promise<StructureDefinition | null>,
  onIncomplete?: (issue: ValidationIssue) => void,
): Promise<ReadonlyMap<ElementDefinition, ReadonlySet<string>>> {
  const selections = new Map<ElementDefinition, Set<string>>();
  const elements = profile.snapshot?.element ?? [];
  const counts = new Map<string, number>();
  for (const element of elements) if (element.id) counts.set(element.id, (counts.get(element.id) ?? 0) + 1);
  for (const base of elements) {
    if (!base.id || !usesResolvedCodeDiscrimination(base.slicing?.discriminator ?? [])) continue;
    const siblings = elements.filter(element => element.path === base.path && element.sliceName
      && element.id === `${base.id}:${element.sliceName}`);
    if (!siblings.some(element => element.type?.some(type => type.code === 'Reference' && type.targetProfile?.length))) continue;
    for (const sibling of siblings) selections.set(sibling, new Set());
    const targets = getValidationTargets(resource, base.path);
    let info: Awaited<ReturnType<typeof extractSlicingInfo>> = null;
    if (counts.get(base.id) === 1 && siblings.every(element => counts.get(element.id!) === 1)) {
      info = await extractSlicingInfo(base.path, profile,
        url => loadDefinition(url, profile), null, base.id, loadDefinition);
    }
    for (const target of targets) {
      const proof = info && info.slices.length === siblings.length
        ? assessElementSliceMembership(target.value, info.slices, info.slicing, resolveReference) : undefined;
      if (proof?.state === 'matched') {
        for (const sibling of siblings) {
          if (proof.matchedSlices.some(slice => slice.sliceName === sibling.sliceName)) selections.get(sibling)!.add(target.fullPath);
        }
      }
      if (!proof || proof.state === 'unknown' || proof.state === 'ambiguous' || proof.unknownSlices.length) {
        onIncomplete?.(createValidationIssue({
          code: 'profile-slice-validation-incomplete', path: target.fullPath,
          resourceType: String(resource.resourceType), profile: profile.url,
          severityOverride: 'information',
          customMessage: 'Reference target profile selection could not be established from the slice discriminator.',
          details: { reason: 'unverified-reference-slice-selection', validationComplete: false,
            validationStatus: 'incomplete', slicingElementId: base.id },
        }));
      }
    }
  }
  return selections;
}
