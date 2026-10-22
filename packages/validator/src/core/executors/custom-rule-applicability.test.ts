import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fhirpath from 'fhirpath';
import { setCustomRulesSource, type EngineCustomRule } from '../../persistence/index.js';
import { CustomRuleExecutor, type CustomRuleValidationContext } from './custom-rule-executor.js';
import type { StructureDefinition } from '../structure-definition-types.js';

vi.mock('fhirpath', () => ({ default: { evaluate: vi.fn(() => [false]) } }));

const canonical = 'https://profiles.example.test/Patient';
const structureDef = { resourceType: 'StructureDefinition', type: 'Patient', url: canonical, version: '1.0' } as StructureDefinition;
const rule: EngineCustomRule = { ruleId: 'bounded-rule', name: 'Bounded', expression: 'false', severity: 'error' };
const context: CustomRuleValidationContext = {
  resource: { resourceType: 'Patient', meta: { profile: ['urn:declared-but-not-loaded'] } },
  organizationId: 7, structureDef, fhirVersion: 'R4', selectedRelease: 'R4B',
};

describe('actual custom rule execution gate', () => {
  beforeEach(() => vi.mocked(fhirpath.evaluate).mockClear());
  afterEach(() => setCustomRulesSource({ async getRulesByResourceType() { return []; } }));

  it.each(['R4', 'R4B', 'R5', 'R6'] as const)('preserves exact release %s independently of the model', async selectedRelease => {
    setCustomRulesSource({ async getRulesByResourceType() { return ['R4', 'R4B', 'R5', 'R6'].map(release => ({ ...rule, ruleId: release, fhirVersions: [release] })); } });
    const issues = await new CustomRuleExecutor().validate({ ...context, selectedRelease, fhirVersion: selectedRelease === 'R4B' ? 'R4' : selectedRelease });
    expect(fhirpath.evaluate).toHaveBeenCalledTimes(1);
    expect(issues).toEqual([expect.objectContaining({ code: 'custom-rule-violation', aspect: 'custom_rule', details: expect.objectContaining({ ruleId: selectedRelease }) })]);
  });

  it.each([
    { fhirVersions: ['R5'] }, { profilesAny: ['urn:declared-but-not-loaded'] },
    { profilesAny: [canonical + '|2.0'] },
  ])('skips nonapplicable rules before sandbox and evaluator: %j', restrictions => {
    setCustomRulesSource({ async getRulesByResourceType() { return [{ ...rule, expression: 'repeat(repeat(repeat(repeat(true))))', ...restrictions }]; } });
    return expect(new CustomRuleExecutor().validate(context)).resolves.toEqual([]).then(() => {
      expect(fhirpath.evaluate).not.toHaveBeenCalled();
    });
  });

  it.each([['R5', 'R4'], ['R4', 'R5'], ['R4B', 'R5']] as const)('blocks known selected %s under incompatible model %s', async (selectedRelease, fhirVersion) => {
    setCustomRulesSource({ async getRulesByResourceType() { return [rule, { ...rule, fhirVersions: [selectedRelease] }]; } });
    const issues = await new CustomRuleExecutor().validate({ ...context, selectedRelease, fhirVersion });
    expect(fhirpath.evaluate).not.toHaveBeenCalled();
    expect(issues).toHaveLength(2);
    expect(issues.every(issue => issue.code === 'custom-rule-applicability-unknown'
      && typeof issue.details === 'object' && issue.details !== null
      && issue.details?.applicabilityReason === 'release-model-mismatch'
      && issue.details?.validationComplete === false)).toBe(true);
  });

  it.each([
    { rule: { profilesAny: null }, context: {} },
    { rule: { fhirVersions: ['forged'] }, context: {} },
    { rule: { fhirVersions: ['R4'] }, context: { selectedRelease: null } },
    { rule: { profilesAny: [canonical] }, context: { structureDef: undefined } },
    { rule: { profilesAny: [canonical + '|1.0'] }, context: { structureDef: { ...structureDef, version: undefined } } },
    { rule: { profilesAny: [canonical] }, context: { structureDef: { ...structureDef, type: 'Observation' } } },
    { rule: { profilesAny: ['urn:unresolved'] }, context: { profileResolutionFallback: true } },
  ])('emits one fixed incomplete finding for unknown evidence: %j', async fixture => {
    const restricted = { ...rule, ...fixture.rule } as unknown as EngineCustomRule;
    setCustomRulesSource({ async getRulesByResourceType() { return [restricted]; } });
    const issues = await new CustomRuleExecutor().validate({ ...context, ...fixture.context });
    expect(fhirpath.evaluate).not.toHaveBeenCalled();
    expect(issues).toEqual([expect.objectContaining({
      aspect: 'custom_rule', code: 'custom-rule-applicability-unknown',
      details: expect.objectContaining({ checkOutcome: 'unknown', validationComplete: false }),
    })]);
  });

  it('evaluates actual fallback base matches and legacy unrestricted rules', async () => {
    setCustomRulesSource({ async getRulesByResourceType() { return [rule, { ...rule, profilesAny: [canonical] }]; } });
    await new CustomRuleExecutor().validate({ ...context, selectedRelease: null, profileResolutionFallback: true });
    expect(fhirpath.evaluate).toHaveBeenCalledTimes(2);
  });

  it('captures selected release and loaded SD evidence before deferred rule loading', async () => {
    let resolveRules: (rules: EngineCustomRule[]) => void = () => { throw new Error('Source was not called'); };
    setCustomRulesSource({ getRulesByResourceType: () => new Promise(resolve => { resolveRules = resolve; }) });
    const loaded = { ...structureDef };
    const request = { ...context, structureDef: loaded, profileResolutionFallback: false };
    const pending = new CustomRuleExecutor().validate(request);
    request.selectedRelease = null;
    request.profileResolutionFallback = true;
    loaded.url = 'urn:mutated';
    loaded.version = '2.0';
    loaded.type = 'Observation';
    resolveRules([{ ...rule, fhirVersions: ['R4B'], profilesAny: [canonical + '|1.0'] }]);
    const issues = await pending;
    expect(fhirpath.evaluate).toHaveBeenCalledTimes(1);
    expect(issues[0]).toMatchObject({ code: 'custom-rule-violation', details: expect.objectContaining({ selectedRelease: 'R4B' }) });
  });

  it('retains execution-error incompleteness rather than classifying it as a data violation', async () => {
    setCustomRulesSource({ async getRulesByResourceType() { return [rule]; } });
    vi.mocked(fhirpath.evaluate).mockImplementationOnce(() => { throw new Error('bounded synthetic failure'); });
    const issues = await new CustomRuleExecutor().validate(context);
    expect(issues).toEqual([expect.objectContaining({ aspect: 'custom_rule', code: 'custom-rule-evaluation-error',
      details: expect.objectContaining({ selectedRelease: 'R4B', checkOutcome: 'execution-failure', validationComplete: false }) })]);
    expect(JSON.stringify(issues)).not.toContain('bounded synthetic failure');
  });
});
