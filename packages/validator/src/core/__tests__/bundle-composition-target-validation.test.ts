import { describe, expect, it, vi } from 'vitest';
import { validateBundleCompositionTargets } from '../bundle-composition-target-validation';
import { buildBundleDocumentContextIssues } from '../bundle-document-context';
import type { BundleDocumentContextChildResult } from '../bundle-document-context-types';
import type { ValidationIssue } from '@records-fhir/validation-types';

const base = 'http://hl7.org/fhir/StructureDefinition/Observation';
const strict = 'http://example.org/StructureDefinition/observation-with-value';
const missingValue: ValidationIssue = { severity: 'error', aspect: 'structural',
  code: 'structural-cardinality-min', path: 'Observation.valueQuantity', message: 'Missing required value' };

function fixture(profiles: string[], declared = base, issues: ValidationIssue[] = []) {
  const observation = { resourceType: 'Observation', id: 'obs', meta: { profile: [declared] }, status: 'final' };
  const composition = { resourceType: 'Composition', id: 'comp',
    section: [{ entry: [{ reference: 'urn:uuid:obs' }] }] };
  const bundle = { resourceType: 'Bundle', type: 'document', entry: [
    { fullUrl: 'urn:uuid:comp', resource: composition }, { fullUrl: 'urn:uuid:obs', resource: observation },
  ] };
  const children: BundleDocumentContextChildResult[] = [
    { index: 0, resourceType: 'Composition', entryResource: composition, issues: [], structureDef: {
      resourceType: 'StructureDefinition', url: 'http://example.org/StructureDefinition/composition', type: 'Composition',
      snapshot: { element: [{ path: 'Composition.section.entry', type: [{ code: 'Reference', targetProfile: profiles }] }] },
    } },
    { index: 1, resourceType: 'Observation', entryResource: observation, issues, validatedProfile: declared },
  ];
  return { bundle, children, observation };
}

describe('Composition target profile validation', () => {
  it('enforces a constrained reference even when the target does not declare that profile', async () => {
    const { bundle, children, observation } = fixture([strict]);
    const before = structuredClone(observation);
    const validate = vi.fn(async () => ({ issues: [missingValue], resourceType: 'Observation', value: [missingValue] }));
    const additional = await validateBundleCompositionTargets(bundle, children, validate);
    expect(validate).toHaveBeenCalledWith(expect.objectContaining({ meta: { profile: [strict] } }), strict);
    expect(additional[0].assessment.issues).toEqual([missingValue]);
    expect(buildBundleDocumentContextIssues(bundle, children)).toContainEqual(expect.objectContaining({
      ruleId: 'profile-targetprofile-match-failed',
    }));
    expect(observation).toEqual(before);
  });

  it('accepts an allowed base alternative while retaining the declared-profile defect', async () => {
    const { bundle, children, observation } = fixture([strict, base], strict, [missingValue]);
    const validate = vi.fn(async (resource: Record<string, unknown>) => {
      expect(resource.meta).toEqual({ profile: [base] });
      return { issues: [], resourceType: 'Observation', value: [] };
    });
    await validateBundleCompositionTargets(bundle, children, validate);
    expect(validate).toHaveBeenCalledOnce();
    expect(buildBundleDocumentContextIssues(bundle, children)).toEqual([]);
    expect(children[1].issues).toEqual([missingValue]);
    expect(observation.meta.profile).toEqual([strict]);
  });

  it('still fails the reference when the base alternative also fails', async () => {
    const { bundle, children } = fixture([strict, base], strict, [missingValue]);
    const baseIssue = { ...missingValue, path: 'Observation.status' };
    await validateBundleCompositionTargets(bundle, children, async () => ({
      issues: [baseIssue], resourceType: 'Observation', value: [baseIssue],
    }));
    expect(buildBundleDocumentContextIssues(bundle, children)).toContainEqual(expect.objectContaining({
      severity: 'error', ruleId: 'profile-targetprofile-match-failed',
    }));
  });

  it('ignores alternatives for another resource type and reuses a validated matching profile', async () => {
    const other = 'http://example.org/StructureDefinition/procedure';
    const { bundle, children } = fixture([other, strict], strict, [missingValue]);
    const validate = vi.fn(async () => ({ issues: [], resourceType: 'Procedure', value: [] }));
    await validateBundleCompositionTargets(bundle, children, validate);
    expect(validate).toHaveBeenCalledOnce();
    expect(buildBundleDocumentContextIssues(bundle, children)).toContainEqual(expect.objectContaining({
      ruleId: 'profile-targetprofile-match-failed',
    }));
  });

  it('checks a repeated reference once and does not impose profiles on unrelated entries', async () => {
    const { bundle, children } = fixture([strict]);
    const sections = children[0].entryResource.section as Array<{ entry: Array<{ reference: string }> }>;
    sections[0].entry.push({ reference: 'urn:uuid:obs' });
    children.push({ index: 2, entryResource: { resourceType: 'Device' }, resourceType: 'Device', issues: [] });
    const validate = vi.fn(async () => ({ issues: [], resourceType: 'Observation', value: [] }));
    const additional = await validateBundleCompositionTargets(bundle, children, validate);
    expect(validate).toHaveBeenCalledOnce();
    expect(additional).toHaveLength(1);
  });

  it('does not attribute a probe type mismatch to the original target metadata', async () => {
    const { bundle, children } = fixture(['http://example.org/StructureDefinition/procedure']);
    const mismatch = { ...missingValue, code: 'structural-resource-type-mismatch', path: 'Observation.meta.profile' };
    const additional = await validateBundleCompositionTargets(bundle, children, async () => ({
      issues: [mismatch], value: [mismatch],
    }));
    expect(additional).toEqual([]);
    expect(buildBundleDocumentContextIssues(bundle, children)).toEqual([]);
  });
});
