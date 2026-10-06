import { describe, expect, it, vi } from 'vitest';
import { ComplexTypeValidator } from '../complex-type-validator';
import { TypeValidator } from '../type-validator';

// Stands in for the owning package's release of a value set.
vi.mock('../../core/executors/terminology-binding-dependency-pins', () => ({
  pinBindingToDependencyPins: vi.fn(async (binding: { valueSet?: string } | undefined, profile: { version?: string }) => (
    binding?.valueSet && profile.version ? { ...binding, valueSet: `${binding.valueSet}|${profile.version}` } : binding
  )),
}));

const IDENTIFIER_TYPE = 'http://hl7.org/fhir/ValueSet/identifier-type';

const identifierSd = {
  resourceType: 'StructureDefinition',
  url: 'http://hl7.org/fhir/StructureDefinition/Identifier',
  name: 'Identifier',
  status: 'active',
  kind: 'complex-type',
  abstract: false,
  type: 'Identifier',
  snapshot: {
    element: [
      { path: 'Identifier' },
      {
        path: 'Identifier.type',
        min: 0,
        max: '1',
        type: [{ code: 'CodeableConcept' }],
        binding: { strength: 'extensible', valueSet: IDENTIFIER_TYPE },
      },
      {
        path: 'Identifier.assigner',
        min: 0,
        max: '1',
        type: [{ code: 'Reference' }],
      },
      { path: 'Identifier.value', min: 0, max: '1', type: [{ code: 'string' }] },
    ],
  },
};

const USE_CONTEXT = 'http://hl7.org/fhir/ValueSet/use-context';
const usageContextSd = {
  resourceType: 'StructureDefinition',
  url: 'http://hl7.org/fhir/StructureDefinition/UsageContext',
  name: 'UsageContext',
  status: 'active',
  kind: 'complex-type',
  abstract: false,
  type: 'UsageContext',
  snapshot: {
    element: [
      { path: 'UsageContext' },
      { path: 'UsageContext.code', min: 1, max: '1', type: [{ code: 'Coding' }] },
      {
        path: 'UsageContext.value[x]',
        min: 1,
        max: '1',
        type: [{ code: 'CodeableConcept' }, { code: 'Quantity' }],
        binding: { strength: 'extensible', valueSet: USE_CONTEXT },
      },
    ],
  },
};

function createValidator(validateBinding: ReturnType<typeof vi.fn>): ComplexTypeValidator {
  const sdLoader = {
    loadProfile: vi.fn().mockImplementation(async (url: string) => (
      url.endsWith('/Identifier') ? identifierSd : url.endsWith('/UsageContext') ? usageContextSd : null
    )),
  } as never;
  return new ComplexTypeValidator(sdLoader, new TypeValidator(), { validateBinding } as never);
}

describe('bindings a datatype declares on its coded children', () => {
  it('checks the extensible binding of Identifier.type wherever an Identifier appears', async () => {
    const validateBinding = vi.fn().mockResolvedValue([]);
    const identifierType = { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'NPI' }] };

    await createValidator(validateBinding).validateComplexTypeSubElements(
      { type: identifierType, value: '1' },
      { id: 'Patient.identifier', path: 'Patient.identifier', type: [{ code: 'Identifier' }] },
      'Patient.identifier[0]',
      '',
      undefined,
      'R4',
    );

    expect(validateBinding).toHaveBeenCalledWith(
      identifierType,
      expect.objectContaining({ strength: 'extensible', valueSet: IDENTIFIER_TYPE }),
      'Patient.identifier[0].type',
      expect.anything(),
    );
  });

  it('reports a binding on a choice at the choice the instance made', async () => {
    const validateBinding = vi.fn().mockResolvedValue([]);
    const focus = { coding: [{ system: 'http://snomed.info/sct', code: '337915000' }] };

    await createValidator(validateBinding).validateComplexTypeSubElements(
      { code: { code: 'species' }, valueCodeableConcept: focus },
      { id: 'Questionnaire.useContext', path: 'Questionnaire.useContext', type: [{ code: 'UsageContext' }] },
      'Questionnaire.useContext[0]',
      '',
      undefined,
      'R4',
    );

    expect(validateBinding).toHaveBeenCalledWith(
      focus,
      expect.objectContaining({ valueSet: USE_CONTEXT }),
      'Questionnaire.useContext[0].valueCodeableConcept',
      expect.anything(),
    );
  });

  // CARIN BB 2.0.0 binds EOB item.subSite to its own C4BBSurfaceCodes, which
  // later releases rebuilt on ADA codes.
  it('reads the binding in the release of the package that owns the profile', async () => {
    const validateBinding = vi.fn().mockResolvedValue([]);
    const identifierType = { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'NPI' }] };
    const profile = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/fhir/StructureDefinition/patient',
      version: '2.0.0',
      type: 'Patient',
      snapshot: { element: [{ path: 'Patient' }, { path: 'Patient.identifier', type: [{ code: 'Identifier' }] }] },
    };

    await createValidator(validateBinding).validateComplexTypeSubElements(
      { type: identifierType, value: '1' },
      { id: 'Patient.identifier', path: 'Patient.identifier', type: [{ code: 'Identifier' }] },
      'Patient.identifier[0]',
      profile.url,
      profile as never,
      'R4',
    );

    expect(validateBinding).toHaveBeenCalledWith(
      identifierType,
      expect.objectContaining({ valueSet: `${IDENTIFIER_TYPE}|2.0.0` }),
      'Patient.identifier[0].type',
      expect.anything(),
    );
  });
});
