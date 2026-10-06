import { registerGoldenQualityContracts, type GoldenCase } from './golden-quality-contracts';

function control(name: string, resource: Record<string, unknown>, severity: 'error' | 'warning', kind: string, pathPattern: string): GoldenCase {
  return { name, resource, expected: {
    fixture: `${name}.json`, fhirVersion: 'R4',
    expectedIssues: [{ severity, kind, pathPattern }],
  } };
}

registerGoldenQualityContracts('Synthetic portable quality matrix', [
  control('synthetic-patient-gender', { resourceType: 'Patient', gender: 'synthetic-invalid' }, 'error', 'terminology-', 'Patient.gender'),
  control('synthetic-observation-status', { resourceType: 'Observation', status: 'synthetic-invalid' }, 'error', 'terminology-', 'Observation.status'),
  control('synthetic-encounter-reference', { resourceType: 'Encounter', status: 'finished', subject: { reference: 'Organization/synthetic-target' } }, 'error', 'reference-target-type-invalid', 'Encounter.subject'),
  control('synthetic-organization-reference', { resourceType: 'Organization', partOf: { reference: 'Patient/synthetic-target' } }, 'error', 'reference-target-type-invalid', 'Organization.partOf'),
  control('synthetic-observation-obs6', { resourceType: 'Observation', status: 'final', valueQuantity: { value: 12 }, dataAbsentReason: { text: 'synthetic absent reason' } }, 'error', 'obs-6-violation', 'Observation.dataAbsentReason'),
  control('synthetic-patient-future', { resourceType: 'Patient', birthDate: '2999-01-01' }, 'warning', 'business-', 'Patient.birthDate'),
]);
