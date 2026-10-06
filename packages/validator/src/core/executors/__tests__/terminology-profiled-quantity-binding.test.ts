import { registerProfiledQuantityBindingContracts } from './profiled-quantity-binding-contracts';

const profileUrl = 'https://example.org/StructureDefinition/synthetic-age-observation';
const valueSetUrl = 'https://example.org/ValueSet/synthetic-age-units';

registerProfiledQuantityBindingContracts({
  profile: {
    resourceType: 'StructureDefinition', url: profileUrl, version: '1.0.0',
    fhirVersion: '4.0.1', name: 'SyntheticAgeObservation', status: 'active',
    kind: 'resource', abstract: false, type: 'Observation',
    differential: { element: [{
      id: 'Observation.value[x]', path: 'Observation.value[x]', min: 1,
      type: [{ code: 'Quantity' }],
      binding: { strength: 'required', valueSet: valueSetUrl },
    }] },
  },
  ageUnits: {
    resourceType: 'ValueSet', url: valueSetUrl, version: '1.0.0', status: 'active',
    compose: { include: [{ system: 'http://unitsofmeasure.org',
      concept: ['a', 'mo', 'wk', 'd'].map(code => ({ code })),
    }] },
  },
  input: {
    resourceType: 'Observation', status: 'final', meta: { profile: [profileUrl] },
    valueQuantity: { system: 'http://unitsofmeasure.org', code: 'cm', value: 12 },
  },
  malformedPrimitive: { resourceType: 'Observation', status: 'final', valueString: 'synthetic primitive' },
});
