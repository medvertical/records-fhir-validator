import { describe, expect, it } from 'vitest';
import { getBundleEntryRequiredProfile } from '../bundle-entry-slice-definitions';
import { buildBundleEntrySliceConformanceIssues } from '../bundle-entry-slice-conformance';
import type { SlicingDefinition, StructureDefinition } from '../structure-definition-types';
import type { ValidationIssue } from '@records-fhir/validation-types';

const deviceProfile = 'http://example.org/StructureDefinition/device-with-patient';
const child = { index: 0, resourceType: 'Device', entryResource: { resourceType: 'Device', id: 'device' } };

function bundleProfile(min: number, rules: SlicingDefinition['rules'], profileDiscriminator = true): StructureDefinition {
  return {
    resourceType: 'StructureDefinition', url: 'http://example.org/StructureDefinition/device-bundle', type: 'Bundle',
    snapshot: { element: [
      { id: 'Bundle.entry', path: 'Bundle.entry', slicing: { rules, discriminator: [
        { type: 'type', path: 'resource' },
        ...(profileDiscriminator ? [{ type: 'profile' as const, path: 'resource' }] : []),
      ] } },
      { id: 'Bundle.entry:device', path: 'Bundle.entry', sliceName: 'device', min, max: '*' },
      { id: 'Bundle.entry:device.resource', path: 'Bundle.entry.resource',
        type: [{ code: 'Device', profile: [deviceProfile] }] },
    ] },
  };
}

describe('Bundle entry profile requirements', () => {
  it.each(['open', 'openAtEnd'] as const)('allows a base resource outside an optional %s profile slice', rules => {
    expect(getBundleEntryRequiredProfile(child, bundleProfile(0, rules))).toBeUndefined();
  });

  it('retains the conformance check for a required profile slice', () => {
    expect(getBundleEntryRequiredProfile(child, bundleProfile(1, 'open'))).toBe(deviceProfile);
  });

  it('retains the profile requirement when no unmatched entry is allowed', () => {
    expect(getBundleEntryRequiredProfile(child, bundleProfile(0, 'closed'))).toBe(deviceProfile);
  });

  it('retains a type-discriminated slice profile regardless of optionality', () => {
    expect(getBundleEntryRequiredProfile(child, bundleProfile(0, 'open', false))).toBe(deviceProfile);
  });

  it.each(['terminology-binding-required', 'terminology-binding-required-code'])('blocks required slice conformance on %s', code => {
    const issues = buildBundleEntrySliceConformanceIssues({}, [{ ...child, issues: [{
      aspect: 'terminology', severity: 'error', code, message: 'Required binding failed', path: 'Device.status',
    }] }], bundleProfile(1, 'open'));
    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'error', ruleId: 'bundle-entry-slice-profile-match-failed',
      details: expect.objectContaining({ causeIssueCodes: [code] }),
    }));
  });

  it.each([
    { severity: 'warning', code: 'terminology-binding-required-code' },
    { severity: 'error', code: 'terminology-binding-unverified' },
    { severity: 'error', code: 'terminology-codesystem-unresolvable' },
  ] as const)('does not turn $severity $code into a required slice failure', ({ severity, code }) => {
    const issue: ValidationIssue = { aspect: 'terminology', severity, code, message: 'Unverified', path: 'Device.status' };
    expect(buildBundleEntrySliceConformanceIssues({}, [{ ...child, issues: [issue] }], bundleProfile(1, 'open'))).toEqual([]);
  });
});
