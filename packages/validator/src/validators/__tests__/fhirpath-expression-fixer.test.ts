import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecordsValidator } from '../../core/validator-engine';
import { createIsolatedConstraintStore, expectIsolatedConstraintProfilesLoaded, invariantFixerDefinitions, removeIsolatedConstraintStore } from '../../core/__tests__/portable-core-constraint-profiles';
import { fixKnownInvariantExpression } from '../fhirpath-expression-fixer';

describe('fixKnownInvariantExpression', () => {
  it('guards ras-2 against a prediction without probability', () => {
    expect(fixKnownInvariantExpression(
      'probability is decimal implies (probability as decimal) <= 100',
      'ras-2',
      'R4',
    )).toBe('(probability.exists() and (probability is decimal)) implies ((probability as decimal) <= 100)');
  });

  it('tightens the published que-12 threshold to two conditions', () => {
    expect(fixKnownInvariantExpression(
      'enableWhen.count() > 2 implies enableBehavior.exists()',
      'que-12',
      'R4',
    )).toBe('enableWhen.count() >= 2 implies enableBehavior.exists()');
  });

  it('applies version-specific rewrites only to their FHIR release', () => {
    const r4Offset = "offset.empty() or (when.exists() and ((when in ('C' | 'CM' | 'CD' | 'CV')).not()))";
    expect(fixKnownInvariantExpression(r4Offset, 'tim-9', 'R4')).toContain('.allFalse()');
    expect(fixKnownInvariantExpression(r4Offset, 'tim-9', 'R5')).toBe(r4Offset);
    expect(fixKnownInvariantExpression('x', 'opd-3', 'R5')).toContain('all-resource-types');
    expect(fixKnownInvariantExpression('x', 'opd-3', 'R4')).toContain('ValueSet/resource-types');
  });

  it('guards ref-1 against a Reference without a reference', () => {
    const r4Ref1 = "reference.startsWith('#').not() or (reference.substring(1).trace('url') in %rootResource.contained.id.trace('ids'))";
    expect(fixKnownInvariantExpression(r4Ref1, 'ref-1', 'R4'))
      .toBe(`reference.exists() implies (reference = '#' or (${r4Ref1}))`);
    expect(fixKnownInvariantExpression(`${r4Ref1} or (reference='#' and %rootResource!=%resource)`, 'ref-1', 'R5'))
      .toMatch(/^reference\.exists\(\) implies \(/);
  });

  it('leaves unknown expressions untouched', () => {
    expect(fixKnownInvariantExpression('name.exists()', 'pat-1', 'R4')).toBe('name.exists()');
  });
});

describe('reference-validator invariant fixes during validation', () => {
  let validator: RecordsValidator;
  let packageRoot: string;

  beforeAll(async () => {
    packageRoot = await createIsolatedConstraintStore(invariantFixerDefinitions());
    validator = new RecordsValidator({ packageCachePath: packageRoot, bundledProfilesPath: packageRoot,
      terminologyPackageDirectories: [], prewarmProfileSource: false, autoDownload: false, enableCaching: true, strictMode: false });
    await validator.waitForInitialization();
    await expectIsolatedConstraintProfilesLoaded(validator, invariantFixerDefinitions());
  }, 120_000);
  afterAll(async () => { await removeIsolatedConstraintStore(packageRoot); });

  const mentions = (key: string) => (issue: { code?: string; message?: string }) =>
    Boolean(issue.code?.includes(key) || issue.message?.includes(`'${key}'`) || issue.message?.includes(`${key}:`));

  const riskAssessment = (prediction: Record<string, unknown>) => ({
    resourceType: 'RiskAssessment',
    id: 'risk',
    status: 'final',
    subject: { reference: 'Patient/p' },
    prediction: [prediction],
  });

  it('accepts a RiskAssessment prediction without probability', async () => {
    const issues = await validator.validate(
      riskAssessment({ outcome: { text: 'stroke' } }),
      'http://hl7.org/fhir/StructureDefinition/RiskAssessment',
      'R4',
    );
    expect(issues.some(issue => ['profile-not-found', 'profile-not-resolved', 'validation-error'].includes(issue.code ?? ''))).toBe(false);
    expect(issues.filter(mentions('ras-2'))).toEqual([]);
  }, 120_000);

  it('still rejects a decimal probability above 100', async () => {
    const issues = await validator.validate(
      riskAssessment({ outcome: { text: 'stroke' }, probabilityDecimal: 150 }),
      'http://hl7.org/fhir/StructureDefinition/RiskAssessment',
      'R4',
    );
    expect(issues.some(issue => ['profile-not-found', 'profile-not-resolved', 'validation-error'].includes(issue.code ?? ''))).toBe(false);
    expect(issues.filter(mentions('ras-2')).map(issue => issue.severity)).toEqual(['error']);
  }, 120_000);

  it('requires enableBehavior once a Questionnaire item has two enableWhen conditions', async () => {
    const issues = await validator.validate(
      {
        resourceType: 'Questionnaire',
        id: 'q',
        status: 'active',
        item: [
          { linkId: 'a', type: 'boolean' },
          { linkId: 'b', type: 'boolean' },
          {
            linkId: 'c',
            type: 'string',
            enableWhen: [
              { question: 'a', operator: '=', answerBoolean: true },
              { question: 'b', operator: '=', answerBoolean: true },
            ],
          },
        ],
      },
      'http://hl7.org/fhir/StructureDefinition/Questionnaire',
      'R4',
    );
    expect(issues.some(issue => ['profile-not-found', 'profile-not-resolved', 'validation-error'].includes(issue.code ?? ''))).toBe(false);
    expect(issues.filter(mentions('que-12')).map(issue => issue.severity)).toEqual(['error']);
  }, 120_000);
});
