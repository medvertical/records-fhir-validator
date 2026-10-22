import { afterEach, describe, expect, it } from 'vitest';
import { setCustomRulesSource, type EngineCustomRule } from '../../persistence/index.js';
import { buildMultiAspectValidateCallback } from '../multi-aspect-validate-callback.js';
import { validateRecordsResource } from '../validator-single-resource-validation.js';
import { validateRecordsAspects, validateRecordsBatch } from '../validator-batch-validation.js';
import type { MultiAspectValidateResult } from '../multi-aspect-types.js';
import type { CustomRuleSelectedRelease } from '../../custom-rules/applicability.js';
import { base, custom, definition, fixture, settings } from './custom-rule-applicability-fixtures.js';

function source(restrictions: Partial<EngineCustomRule>) {
  setCustomRulesSource({ async getRulesByResourceType() {
    return [{ ruleId: 'bounded', name: 'Bounded', expression: 'false', severity: 'error', ...restrictions }];
  } });
}

function callback(deps: ReturnType<typeof fixture>, selectedRelease: CustomRuleSelectedRelease | null) {
  return buildMultiAspectValidateCallback(deps as never, ['custom_rule'], settings, 7,
    undefined, undefined, undefined, undefined, undefined, selectedRelease);
}

describe('native custom rule caller parity', () => {
  afterEach(() => setCustomRulesSource({ async getRulesByResourceType() { return []; } }));

  it.each(['R4', 'R4B', 'R5', 'R6'] as const)('direct single, multi, direct aspect and batch preserve %s', async selectedRelease => {
    source({ fhirVersions: [selectedRelease], profilesAny: [custom + '|1.0'] });
    const deps = fixture();
    const resource = { resourceType: 'Patient' };
    const fhirVersion = selectedRelease === 'R4B' ? 'R4' : selectedRelease;
    const single = await validateRecordsResource({ resource, profileUrl: custom, fhirVersion,
      selectedRelease, settings, organizationId: 7 }, deps as never);
    const multi = await callback(deps, selectedRelease)(resource, custom, fhirVersion);
    const options = { fhirVersion, selectedRelease, settings, organizationId: 7, profileUrl: custom, aspects: ['custom_rule' as const] };
    const direct = await validateRecordsAspects(resource, options, deps as never);
    const batch = await validateRecordsBatch([resource], options, deps as never);
    for (const issues of [single, multi.aspects.flatMap(aspect => aspect.issues), direct.aspects.flatMap(aspect => aspect.issues),
      (batch.get(resource) as MultiAspectValidateResult).aspects.flatMap(aspect => aspect.issues)]) {
      expect(issues.filter(issue => issue.code === 'custom-rule-violation')).toEqual([
        expect.objectContaining({ details: expect.objectContaining({ selectedRelease }) }),
      ]);
    }
  });

  it.each([null, definition(custom, 'Observation')])('keeps unresolved or incompatible requested profiles incomplete: %j', async loaded => {
    source({ profilesAny: [custom] });
    const deps = fixture(loaded);
    const single = await validateRecordsResource({ resource: { resourceType: 'Patient' }, profileUrl: custom,
      fhirVersion: 'R4', selectedRelease: 'R4B', settings, organizationId: 7 }, deps as never);
    const multi = await callback(deps, 'R4B')({ resourceType: 'Patient' }, custom, 'R4');
    expect(single).toContainEqual(expect.objectContaining({ code: 'custom-rule-applicability-unknown' }));
    expect(multi).toMatchObject({ isValid: false, aspects: [{ aspect: 'custom_rule', isValid: false }] });
    expect(multi.aspects[0].issues).toHaveLength(1);
  });

  it('defaults the internal single sidecar only when omitted, preserving explicit null', async () => {
    source({ fhirVersions: ['R4'], profilesAny: [custom] });
    const deps = fixture();
    const input = { resource: { resourceType: 'Patient' }, profileUrl: custom, fhirVersion: 'R4' as const,
      settings, organizationId: 7 };
    const known = await validateRecordsResource(input, deps as never);
    expect(known).toContainEqual(expect.objectContaining({ code: 'custom-rule-violation',
      details: expect.objectContaining({ selectedRelease: 'R4' }) }));
    const unknown = await validateRecordsResource({ ...input, selectedRelease: null }, deps as never);
    expect(unknown).toContainEqual(expect.objectContaining({ code: 'custom-rule-applicability-unknown',
      details: expect.objectContaining({ selectedRelease: null }) }));
    expect(unknown.some(issue => issue.code === 'custom-rule-violation')).toBe(false);
  });

  it('rejects incoherent direct aspect and batch contexts before any profile preparation', async () => {
    source({});
    const deps = fixture();
    const resource = { resourceType: 'Patient' };
    const options = { fhirVersion: 'R4' as const, selectedRelease: 'R5' as const, settings,
      organizationId: 7, profileUrl: custom, aspects: ['custom_rule' as const] };
    await expect(validateRecordsAspects(resource, options, deps as never)).rejects.toThrow('Selected validation release is incompatible with the validator model');
    await expect(validateRecordsBatch([resource], options, deps as never)).rejects.toThrow('Selected validation release is incompatible with the validator model');
    await expect(callback(deps, 'R5')(resource, custom, 'R4')).rejects.toThrow('Selected validation release is incompatible with the validator model');
    expect(deps.sdLoader.loadProfile).not.toHaveBeenCalled();
    expect(deps.sdLoader.loadProfilesBatch).not.toHaveBeenCalled();
  });

  it('does not substitute declarations for the resolved canonical or selected release', async () => {
    source({ profilesAny: [custom], fhirVersions: ['R4B'] });
    const resource = { resourceType: 'Patient', meta: { profile: [custom] } };
    const different = fixture(definition('urn:actually-loaded'));
    const canonicalResult = await callback(different, 'R4B')(resource, custom, 'R4');
    expect(canonicalResult.aspects[0].issues).toEqual([expect.objectContaining({
      code: 'custom-rule-applicability-unknown', details: expect.objectContaining({ validationComplete: false }),
    })]);
    const unknown = await callback(fixture(), null)(resource, custom, 'R4');
    expect(unknown).toMatchObject({ isValid: false });
    expect(unknown.aspects[0].issues[0]).toMatchObject({ code: 'custom-rule-applicability-unknown' });
  });

  it('returns honest custom-rule-only incompleteness with no SD while preserving structural dependency failure', async () => {
    source({ profilesAny: [custom] });
    const deps = fixture(null);
    deps.sdLoader.loadProfile.mockResolvedValue(null);
    const result = await callback(deps, 'R4B')({ resourceType: 'Patient' }, custom, 'R4');
    expect(result).toMatchObject({ isValid: false, aspects: [{ aspect: 'custom_rule', isValid: false }] });
    expect(result.aspects[0].issues).toHaveLength(1);
    const validate = buildMultiAspectValidateCallback(deps as never, ['structural', 'custom_rule'], settings, 7);
    await expect(validate({ resourceType: 'Patient' }, custom, 'R4')).rejects.toThrow('dependency could not be completed');
  });

  it.each(['contained', 'parameters', 'bundle'])('uses each %s descendant SD, not the parent profile', async kind => {
    source({ fhirVersions: ['R4B'], profilesAny: [custom] });
    const child = { resourceType: 'Patient', id: 'child', meta: { profile: [custom] } };
    const parent = kind === 'contained' ? { resourceType: 'Patient', contained: [child] }
      : kind === 'parameters' ? { resourceType: 'Parameters', parameter: [{ name: 'bounded', resource: child }] }
        : { resourceType: 'Bundle', type: 'collection', entry: [{ resource: child }] };
    const result = await callback(fixture(), 'R4B')(parent, base + parent.resourceType, 'R4');
    const violations = result.aspects.flatMap(aspect => aspect.issues).filter(issue => issue.code === 'custom-rule-violation');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ path: expect.stringContaining(kind === 'contained' ? '.contained[0]' : kind === 'parameters' ? '.parameter[0]' : '.entry[0]'),
      details: expect.objectContaining({ selectedRelease: 'R4B' }) });
  });
});
