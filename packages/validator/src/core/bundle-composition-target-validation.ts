import type { ValidationIssue } from '@records-fhir/validation-types';
import type { BundleDocumentContextChildResult } from './bundle-document-context-types.js';
import {
  buildChildResultReferenceIndex,
  getTargetProfileBlockingIssues,
  visitCompositionSections,
} from './bundle-document-context.js';
import { getCompositionEntryTargetProfiles } from './composition-target-profiles.js';
import { getDeclaredProfiles } from './declared-profile-utils.js';

interface TargetAssessment<T> {
  issues: ValidationIssue[];
  resourceType?: string;
  value?: T;
}

export interface AdditionalTargetValidation<T> {
  child: BundleDocumentContextChildResult;
  assessment: TargetAssessment<T>;
}

/** Assess reference alternatives independently of the target's declared profiles. */
export async function validateBundleCompositionTargets<T>(
  bundle: Record<string, unknown>,
  children: BundleDocumentContextChildResult[],
  validate: (resource: Record<string, unknown>, profile: string) => Promise<TargetAssessment<T>>,
): Promise<AdditionalTargetValidation<T>[]> {
  if (bundle.type !== 'document') return [];
  const byReference = buildChildResultReferenceIndex(Array.isArray(bundle.entry) ? bundle.entry : [], children);
  const cache = new Map<string, TargetAssessment<T>>();
  const additional = new Map<string, AdditionalTargetValidation<T>>();
  for (const composition of children.filter(child => child.resourceType === 'Composition')) {
    const targets: Array<{ child: BundleDocumentContextChildResult; profiles: string[]; path: string }> = [];
    const sections = composition.entryResource.section;
    visitCompositionSections(Array.isArray(sections) ? sections : [], 'section', (section, entry, entryPath) => {
      const child = typeof entry.reference === 'string' ? byReference.get(entry.reference) : undefined;
      if (!child) return;
      const profiles = getCompositionEntryTargetProfiles(composition.structureDef, section)
        ?? getDeclaredProfiles(child.entryResource);
      targets.push({ child, profiles, path: entryPath });
    });
    composition.targetProfileIssues = {};
    for (const target of targets) {
      const { child, profiles } = target;
      if (profiles.length === 0 || profiles.some(profile =>
        profile.split('|')[0] === 'http://hl7.org/fhir/StructureDefinition/Resource',
      )) {
        composition.targetProfileIssues[target.path] = [];
        continue;
      }
      const candidates: Array<{ key: string; assessment: TargetAssessment<T>; blocking: ValidationIssue[] }> = [];
      for (const profile of profiles) {
        const key = `${child.index}|${profile}`;
        let assessment = cache.get(key);
        if (!assessment) {
          assessment = await assessTarget(child, profile, validate);
          cache.set(key, assessment);
        }
        if ((assessment.resourceType && assessment.resourceType !== child.resourceType)
          || assessment.issues.some(issue => issue.code === 'structural-resource-type-mismatch')) continue;
        const blocking = getTargetProfileBlockingIssues(assessment.issues);
        candidates.push({ key, assessment, blocking });
        if (blocking.length === 0) break;
      }
      const selected = candidates.sort((left, right) => left.blocking.length - right.blocking.length)[0];
      composition.targetProfileIssues[target.path] = selected?.blocking ?? [];
      if (selected?.assessment.value !== undefined) {
        additional.set(selected.key, { child, assessment: selected.assessment });
      }
    }
  }
  return [...additional.values()];
}

async function assessTarget<T>(
  child: BundleDocumentContextChildResult,
  profile: string,
  validate: (resource: Record<string, unknown>, profile: string) => Promise<TargetAssessment<T>>,
): Promise<TargetAssessment<T>> {
  const declared = getDeclaredProfiles(child.entryResource);
  if (declared.length <= 1 && child.validatedProfile === profile) {
    return { issues: child.issues, resourceType: child.resourceType };
  }
  if (profile.split('|')[0] === `http://hl7.org/fhir/StructureDefinition/${child.resourceType}`
    && getTargetProfileBlockingIssues(child.issues).length === 0) {
    return { issues: [], resourceType: child.resourceType };
  }
  const projected = structuredClone(child.entryResource);
  const meta = projected.meta && typeof projected.meta === 'object' && !Array.isArray(projected.meta)
    ? projected.meta as Record<string, unknown> : {};
  // A failed declared profile must not invalidate an otherwise conformant alternative.
  projected.meta = { ...meta, profile: [profile] };
  return validate(projected, profile);
}
