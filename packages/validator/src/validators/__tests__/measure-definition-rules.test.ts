import { describe, expect, it } from 'vitest';
import { validateMeasureDefinition } from '../measure-definition-rules';

const findings = (measure: Record<string, unknown>) => validateMeasureDefinition(measure)
  .map(issue => [issue.severity, issue.code, issue.path]);

describe('Measure definition rules', () => {
  it('asks for at least one group', () => {
    expect(findings({ resourceType: 'Measure' })).toEqual([['warning', 'measure-groups-missing', 'Measure']]);
  });

  it('asks for codes once there are several groups, populations or stratifiers', () => {
    expect(findings({
      resourceType: 'Measure',
      group: [
        { code: { text: 'a' }, population: [{ code: { text: 'initial-population' } }, {}] },
        { stratifier: [{ code: { text: 'age' } }, {}] },
      ],
    })).toEqual([
      ['warning', 'measure-population-code-missing', 'Measure.group[0].population[1]'],
      ['warning', 'measure-group-code-missing', 'Measure.group[1]'],
      ['warning', 'measure-group-population-missing', 'Measure.group[1]'],
      ['warning', 'measure-stratifier-code-missing', 'Measure.group[1].stratifier[1]'],
    ]);
  });

  it('leaves single groups, populations and stratifiers without a code alone', () => {
    expect(findings({ resourceType: 'Measure', group: [{ population: [{}], stratifier: [{}] }] })).toEqual([]);
  });

  it('does not infer a missing Library from the ambiguous R4 text/cql token', () => {
    const measure = (library?: string[]) => ({
      resourceType: 'Measure',
      ...(library ? { library } : {}),
      group: [{
        population: [{ criteria: { language: 'text/cql', expression: 'Initial Population' } }],
        stratifier: [{ criteria: { language: 'text/cql', expression: 'Age Group/Sex' } }],
      }],
    });

    expect(findings(measure())).toEqual([]);
    expect(findings(measure(['http://ohie.org/Library/hiv-indicators']))).toEqual([]);
  });

  it('says nothing about criteria in a language the reference validator cannot evaluate', () => {
    expect(findings({
      resourceType: 'Measure',
      group: [{ population: [{}], stratifier: [{ criteria: { language: 'text/fhirpath', expression: 'Patient.gender' } }] }],
    })).toEqual([]);
  });

  it('does not invent a Library prerequisite for independently valid inline CQL forms', () => {
    for (const language of ['text/cql', 'text/cql-expression']) {
      expect(findings({
        resourceType: 'Measure',
        group: [{ population: [{}], stratifier: [{ criteria: { language, expression: 'true' } }] }],
      })).toEqual([]);
    }
  });

  it('preserves the explicit CQL identifier declared-Library prerequisite', () => {
    const measure = (library?: string[]) => ({
      resourceType: 'Measure',
      ...(library ? { library } : {}),
      group: [{
        population: [{}],
        stratifier: [{ criteria: { language: 'text/cql.identifier', expression: 'RiskAssessmentScore' } }],
      }],
    });
    expect(findings(measure())).toEqual([
      ['error', 'measure-criteria-cql-library-missing', 'Measure.group[0].stratifier[0].criteria'],
    ]);
    // Declaring a Library satisfies this prerequisite without proving its availability or CQL evaluation.
    expect(findings(measure(['http://ohie.org/Library/hiv-indicators']))).toEqual([]);
  });

  it('preserves independent Measure findings beside the explicit identifier prerequisite', () => {
    expect(findings({
      resourceType: 'Measure',
      group: [
        { population: [{}], stratifier: [{ criteria: { language: 'text/cql', expression: 'true' } }] },
        { population: [{}], stratifier: [{ criteria: { language: 'text/cql.identifier', expression: 'RiskAssessmentScore' } }] },
      ],
    })).toEqual([
      ['warning', 'measure-group-code-missing', 'Measure.group[0]'],
      ['warning', 'measure-group-code-missing', 'Measure.group[1]'],
      ['error', 'measure-criteria-cql-library-missing', 'Measure.group[1].stratifier[0].criteria'],
    ]);
  });

  it('does not invent missing context when a genuine cqf-library extension declares it', () => {
    const measure = (extension: Record<string, unknown>) => ({
      resourceType: 'Measure', extension: [extension],
      group: [{ population: [{}], stratifier: [{
        criteria: { language: 'text/cql.identifier', expression: 'RiskAssessmentScore' },
      }] }],
    });
    expect(findings(measure({ url: 'http://hl7.org/fhir/StructureDefinition/cqf-library',
      valueCanonical: 'http://ohie.org/Library/hiv-indicators' }))).toEqual([]);
    for (const extension of [
      { url: 'http://example.org/StructureDefinition/unrelated', valueCanonical: 'http://ohie.org/Library/hiv-indicators' },
      { url: 'http://hl7.org/fhir/StructureDefinition/cqf-library', valueCanonical: '' },
      { url: 'http://hl7.org/fhir/StructureDefinition/cqf-library', valueUri: 'http://ohie.org/Library/hiv-indicators' },
    ]) {
      expect(findings(measure(extension))).toEqual([
        ['error', 'measure-criteria-cql-library-missing', 'Measure.group[0].stratifier[0].criteria'],
      ]);
    }
  });

  it('leaves the availability of an explicitly referenced expression outside this owner', () => {
    const measure = (reference?: string) => ({
      resourceType: 'Measure', group: [{ population: [{}], stratifier: [{ criteria: {
        language: 'text/cql.identifier', expression: 'RiskAssessmentScore', ...(reference === undefined ? {} : { reference }),
      } }] }],
    });
    expect(findings(measure('http://ohie.org/Library/hiv-indicators#RiskAssessmentScore'))).toEqual([]);
    expect(findings(measure(''))).toEqual([
      ['error', 'measure-criteria-cql-library-missing', 'Measure.group[0].stratifier[0].criteria'],
    ]);
  });
});
