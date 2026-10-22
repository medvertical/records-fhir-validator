import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCustomRulesSource } from '../../persistence/index.js';
import { custom, settings } from './custom-rule-applicability-fixtures.js';
import { RecordsValidator } from '../validator-engine.js';
import { recordsValidator } from '../../validator-singleton.js';

vi.mock('../validator-engine-components.js', async () => {
  const { fixture } = await import('./custom-rule-applicability-fixtures.js');
  return { createRecordsValidatorComponents: () => fixture() };
});
vi.mock('../validator-initialization.js', () => ({ checkRecordsValidatorAvailability: async () => true }));
vi.mock('../validator-runtime-controls.js', () => {
  return { ValidatorRuntimeControls: class {
    constructor(private readonly components: ReturnType<typeof import('./custom-rule-applicability-fixtures.js').fixture>) {}
    applySettings() {}
    getSdLoader() { return this.components.sdLoader; }
  } };
});

describe('actual single-resource custom rule descendants', () => {
  afterEach(() => setCustomRulesSource({ async getRulesByResourceType() { return []; } }));

  it('blocks incoherent direct single and batch entry before the tenant source is called', async () => {
    const getRulesByResourceType = vi.fn().mockResolvedValue([{ ruleId: 'bounded', name: 'Bounded', expression: 'false', severity: 'error' }]);
    setCustomRulesSource({ getRulesByResourceType });
    const validator = new RecordsValidator({ autoDownload: false });
    const issues = await validator.validate({ resourceType: 'Patient' }, undefined, 'R4', settings, undefined, undefined, 7, undefined, 0, 'R5');
    expect(issues).toEqual([expect.objectContaining({ code: 'custom-rule-applicability-unknown',
      details: expect.objectContaining({ applicabilityReason: 'release-model-mismatch', validationComplete: false }) })]);
    expect(issues[0].details).not.toHaveProperty('ruleId');
    await expect(validator.validateBatch([{ resourceType: 'Patient' }], { fhirVersion: 'R4', selectedRelease: 'R5', organizationId: 7, settings }))
      .rejects.toThrow('Selected validation release is incompatible with the validator model');
    expect(getRulesByResourceType).not.toHaveBeenCalled();
  });

  it('blocks incoherent public single without inventing a rule and keeps public all invalid', async () => {
    const getRulesByResourceType = vi.fn().mockResolvedValue([]);
    setCustomRulesSource({ getRulesByResourceType });
    const issues = await recordsValidator.validateRequest({ resource: { resourceType: 'Patient' }, fhirVersion: 'R4',
      selectedRelease: 'R5', organizationId: 7, runtimeScopeKey: 'bounded-public-model-mismatch', settings });
    expect(issues).toEqual([expect.objectContaining({ code: 'custom-rule-applicability-unknown',
      details: expect.objectContaining({ applicabilityReason: 'release-model-mismatch', validationComplete: false }) })]);
    expect(issues[0].details).not.toHaveProperty('ruleId');
    await expect(recordsValidator.validateAll([{ resourceType: 'Patient' }], { fhirVersion: 'R4', selectedRelease: 'R5', settings }))
      .rejects.toThrow('Selected validation release is incompatible with the validator model');
    expect(getRulesByResourceType).not.toHaveBeenCalled();
  });

  it.each(['R4', 'R4B'] as const)('keeps coherent public %s requests executable under the R4 model', async selectedRelease => {
    setCustomRulesSource({ async getRulesByResourceType() {
      return [{ ruleId: 'bounded', name: 'Bounded', expression: 'false', severity: 'error', fhirVersions: [selectedRelease], profilesAny: [custom] }];
    } });
    const issues = await recordsValidator.validateRequest({ resource: { resourceType: 'Patient' }, profileUrl: custom,
      fhirVersion: selectedRelease, organizationId: 7, runtimeScopeKey: 'bounded-public-coherent-' + selectedRelease, settings });
    expect(issues.filter(issue => issue.code === 'custom-rule-violation')).toEqual([
      expect.objectContaining({ details: expect.objectContaining({ selectedRelease }) }),
    ]);
    expect(issues.some(issue => issue.code === 'custom-rule-applicability-unknown')).toBe(false);
  });

  it.each(['contained', 'parameters', 'bundle'])('preserves selected release and own loaded SD through %s traversal', async kind => {
    setCustomRulesSource({ async getRulesByResourceType() {
      return [{ ruleId: 'bounded', name: 'Bounded', expression: 'false', severity: 'error', fhirVersions: ['R4B'], profilesAny: [custom] }];
    } });
    const child = { resourceType: 'Patient', id: 'child', meta: { profile: [custom] } };
    const parent = kind === 'contained' ? { resourceType: 'Patient', contained: [child] }
      : kind === 'parameters' ? { resourceType: 'Parameters', parameter: [{ name: 'bounded', resource: child }] }
        : { resourceType: 'Bundle', type: 'collection', entry: [{ resource: child }] };
    const validator = new RecordsValidator({ autoDownload: false });
    const issues = await validator.validate(parent, undefined, 'R4', settings, undefined, undefined, 7, undefined, 0, 'R4B');
    const violations = issues.filter(issue => issue.code === 'custom-rule-violation');
    expect(issues.some(issue => issue.code === 'validation-error')).toBe(false);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      path: expect.stringContaining(kind === 'contained' ? '.contained[0]' : kind === 'parameters' ? '.parameter[0]' : '.entry[0]'),
      details: expect.objectContaining({ selectedRelease: 'R4B' }),
    });
  });

  it('preserves explicit null through a single-resource descendant rather than defaulting to R4', async () => {
    setCustomRulesSource({ async getRulesByResourceType() {
      return [{ ruleId: 'bounded', name: 'Bounded', expression: 'false', severity: 'error', fhirVersions: ['R4'], profilesAny: [custom] }];
    } });
    const validator = new RecordsValidator({ autoDownload: false });
    const issues = await validator.validate({ resourceType: 'Patient', contained: [{ resourceType: 'Patient', meta: { profile: [custom] } }] },
      undefined, 'R4', settings, undefined, undefined, 7, undefined, 0, null);
    expect(issues.filter(issue => issue.code === 'custom-rule-violation')).toEqual([]);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'custom-rule-applicability-unknown',
      path: expect.stringContaining('.contained[0]'), details: expect.objectContaining({ selectedRelease: null }) }));
  });
});
