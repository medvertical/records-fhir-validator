import { beforeAll, describe, expect, it } from 'vitest';
import { RecordsValidator } from '../validator-engine';
import type { ValidationIssue } from '@records-fhir/validation-types';

const VALID_PATIENT = {
  resourceType: 'Patient',
  id: 'test-patient-001',
  meta: {
    profile: ['http://hl7.org/fhir/StructureDefinition/Patient'],
    lastUpdated: '2024-01-01T00:00:00Z'
  },
  name: [{
    family: 'Smith',
    given: ['John']
  }],
  gender: 'male',
  birthDate: '1990-01-01',
  active: true
};

const PATIENT_WITHOUT_OPTIONAL_NAME = {
  resourceType: 'Patient',
  id: 'test-patient-invalid',
  // Base Patient.name is optional; advisory guidance must not invalidate it.
  gender: 'male'
};

const PATIENT_WITH_INVALID_TYPE = {
  resourceType: 'Patient',
  id: 'test-patient-type-error',
  name: [{
    family: 'Smith',
    given: ['John']
  }],
  gender: 'invalid-gender-value', // Invalid enum value
  birthDate: '1990-01-01'
};

const VALID_OBSERVATION = {
  resourceType: 'Observation',
  id: 'test-observation-001',
  status: 'final',
  code: {
    coding: [{
      system: 'http://loinc.org',
      code: '33747-0',
      display: 'Temperature'
    }]
  },
  subject: {
    reference: 'Patient/test-patient-001'
  },
  valueQuantity: {
    value: 98.6,
    unit: '°F',
    system: 'http://unitsofmeasure.org',
    code: '[degF]'
  }
};

const OBSERVATION_MISSING_REQUIRED = {
  resourceType: 'Observation',
  id: 'test-observation-invalid',
  subject: {
    reference: 'Patient/test-patient-001'
  }
};

const VALID_CONDITION = {
  resourceType: 'Condition',
  id: 'test-condition-001',
  clinicalStatus: {
    coding: [{
      system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
      code: 'active'
    }]
  },
  subject: {
    reference: 'Patient/test-patient-001'
  },
  code: {
    coding: [{
      system: 'http://snomed.info/sct',
      code: '44054006',
      display: 'Diabetes mellitus type 2'
    }]
  }
};


const errors = (issues: ValidationIssue[]) => issues.filter(issue => ['error', 'fatal'].includes(issue.severity));
const semanticIssues = (issues: ValidationIssue[]) => issues.map(({ aspect, severity, code, path, message }) =>
  ({ aspect, severity, code, path, message })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe('public validator resource and targeted-aspect outcomes', () => {
  let validator: RecordsValidator;
  beforeAll(async () => {
    validator = new RecordsValidator({ enableCaching: true, strictMode: false, timeout: 30_000, autoDownload: false });
    validator.configureTerminologyResolution({
      strategy: 'local-only', serverUrl: undefined,
      serverDelegation: { expandValueSets: false, validateCodes: false, cacheResults: true, cacheTTLSeconds: 3600 },
    });
    await validator.waitForInitialization();
    expect(validator.isAvailable()).toBe(true);
  }, 120_000);

  it.each([VALID_PATIENT, VALID_OBSERVATION, VALID_CONDITION])('accepts valid $resourceType without error-level issues', async resource => {
    const issues = await validator.validate(resource, `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`, 'R4');
    expect(issues.some(issue => issue.code === 'profile-not-resolved')).toBe(false);
    expect(errors(issues)).toEqual([]);
  });

  it('treats the missing optional Patient name as advisory, including in structural-only validation', async () => {
    const issues = await validator.validate(PATIENT_WITHOUT_OPTIONAL_NAME, 'http://hl7.org/fhir/StructureDefinition/Patient', 'R4');
    expect(errors(issues)).toEqual([]);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'best-practice-patient-name', path: 'Patient.name' }),
    ]));
    expect(errors(await validator.validateStructure(PATIENT_WITHOUT_OPTIONAL_NAME, 'R4'))).toEqual([]);
  });

  it('rejects an invalid Patient gender at the gender element', async () => {
    const issues = await validator.validate(PATIENT_WITH_INVALID_TYPE, 'http://hl7.org/fhir/StructureDefinition/Patient', 'R4');
    expect(errors(issues)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Patient.gender' }),
    ]));
  });

  it('reports both required Observation fields', async () => {
    const issues = await validator.validate(OBSERVATION_MISSING_REQUIRED, 'http://hl7.org/fhir/StructureDefinition/Observation', 'R4');
    expect(errors(issues).map(issue => issue.path)).toEqual(expect.arrayContaining(['Observation.status', 'Observation.code']));
  });

  it('preserves valid metadata and identifies both malformed metadata fields', async () => {
    expect(errors(await validator.validateMetadata(VALID_PATIENT))).toEqual([]);
    const issues = await validator.validateMetadata({ ...VALID_PATIENT,
      meta: { profile: 'not-an-array', lastUpdated: 'invalid-date-format' },
    });
    expect(issues.filter(issue => issue.aspect === 'metadata').map(issue => issue.path))
      .toEqual(expect.arrayContaining(['meta.profile', 'meta.lastUpdated']));
  });

  it('reports a malformed reference instead of just returning an array', async () => {
    expect(errors(await validator.validateReferences(VALID_OBSERVATION))).toEqual([]);
    const issues = await validator.validateReferences({ ...VALID_OBSERVATION, subject: { reference: 'Patient/' } });
    expect(errors(issues)).toEqual(expect.arrayContaining([
      expect.objectContaining({ aspect: 'reference', path: 'Observation.subject.reference' }),
    ]));
  });

  it('returns identical semantic issues on a repeated validation', async () => {
    const validate = () => validator.validate(PATIENT_WITH_INVALID_TYPE, 'http://hl7.org/fhir/StructureDefinition/Patient', 'R4');
    expect(semanticIssues(await validate())).toEqual(semanticIssues(await validate()));
  });
});
