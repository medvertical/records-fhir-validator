import { describe, expect, it, vi } from 'vitest';

import type { StructureDefinition } from '../../core/structure-definition-types';
import type { ElementRulesValidator } from '../element-rules-validator';
import type { ExtensionValidationContext } from '../extension-types';
import type { TypeValidator } from '../type-validator';
import type { ValueSetValidator } from '../valueset-validator';
import { validateExtensionValueElements } from '../extension-value-profile-validation';

// Stands in for the release of a value set the definition's own package ships.
vi.mock('../../core/executors/terminology-binding-dependency-pins', () => ({
  pinBindingToDependencyPins: vi.fn(async (binding: { valueSet?: string }, definition: { version?: string }) => (
    binding.valueSet && definition.version ? { ...binding, valueSet: `${binding.valueSet}|${definition.version}` } : binding
  )),
}));

const profileUrl = 'http://hl7.org/fhir/StructureDefinition/cqf-fhirQueryPattern';

const context: ExtensionValidationContext = {
  resource: { resourceType: 'Library' },
  profileSD: { resourceType: 'StructureDefinition' } as StructureDefinition,
  strictMode: false,
  fhirVersion: 'R4',
  profileUrl,
  getValueAtPath: () => undefined,
};

const typeValidator = { validate: async () => [] } as unknown as TypeValidator;
const valueSetValidator = { validateBinding: async () => [] } as unknown as ValueSetValidator;
const elementRulesValidator = { validate: () => [] } as unknown as ElementRulesValidator;

const requiredValueElements = [
  { id: 'Extension.value[x]', path: 'Extension.value[x]', min: 1, max: '1', type: [{ code: 'string' }] },
];

async function run(extension: Record<string, unknown>) {
  return validateExtensionValueElements({
    extension,
    valueElements: requiredValueElements,
    path: 'Library.dataRequirement.extension',
    profileUrl,
    context,
    typeValidator,
    valueSetValidator,
    elementRulesValidator,
  });
}

describe('validateExtensionValueElements', () => {
  it('reports a required value[x] that is absent entirely', async () => {
    const issues = await run({ url: profileUrl });
    expect(issues.map(issue => issue.code)).toContain('profile-extension-missing-value');
  });

  it('accepts a value[x] present only through its underscore sidecar', async () => {
    const issues = await run({
      url: profileUrl,
      _valueString: {
        extension: [{
          url: 'http://hl7.org/fhir/StructureDefinition/cqf-expression',
          valueExpression: { language: 'text/cql-expression', expression: "'Patient?_id=' + %patientId" },
        }],
      },
    });
    expect(issues).toEqual([]);
  });

  it('still reports when the sidecar carries no id or extension', async () => {
    const issues = await run({ url: profileUrl, _valueString: {} });
    expect(issues.map(issue => issue.code)).toContain('profile-extension-missing-value');
  });

  it('reports a value whose JSON type the definition does not allow, as the reference validator does', async () => {
    const issues = await run({ url: profileUrl, valueInteger: 3 });

    expect(issues).toEqual([expect.objectContaining({
      code: 'profile-extension-wrong-value-type',
      severity: 'error',
      message: `The Extension '${profileUrl}' definition allows for the types [string] but found type integer`,
    })]);
  });

  it('matches camel-case primitive types regardless of the JSON name\'s capitalisation', async () => {
    const issues = await validateExtensionValueElements({
      extension: { url: profileUrl, valueDateTime: '2020-01-01T00:00:00Z' },
      valueElements: [{ id: 'Extension.value[x]', path: 'Extension.value[x]', min: 1, max: '1', type: [{ code: 'dateTime' }] }],
      path: 'Patient.extension',
      profileUrl,
      context,
      typeValidator,
      valueSetValidator,
      elementRulesValidator,
    });

    expect(issues).toEqual([]);
  });

  it('reads the value binding in the release of the package that defines the extension', async () => {
    const birthsex = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-birthsex';
    const validateBinding = vi.fn(async () => []);
    await validateExtensionValueElements({
      extension: { url: birthsex, valueCode: 'F' },
      valueElements: [{
        id: 'Extension.value[x]', path: 'Extension.value[x]', min: 0, max: '1', type: [{ code: 'code' }],
        binding: { strength: 'required', valueSet: 'http://hl7.org/fhir/us/core/ValueSet/birthsex' },
      }],
      path: 'Patient.extension[0]',
      profileUrl: birthsex,
      context,
      typeValidator,
      valueSetValidator: { validateBinding } as unknown as ValueSetValidator,
      elementRulesValidator,
      definition: { url: birthsex, version: '3.1.1' },
    });

    expect(validateBinding).toHaveBeenCalledWith(
      'F',
      expect.objectContaining({ valueSet: 'http://hl7.org/fhir/us/core/ValueSet/birthsex|3.1.1' }),
      'Patient.extension[0].valueCode',
      { fhirVersion: context.fhirVersion, profileUrl: birthsex },
    );
  });

  it('reports any value on a complex extension, whose value[x] is closed with max 0', async () => {
    const ethnicity = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity';
    const issues = await validateExtensionValueElements({
      extension: { url: ethnicity, valueCodeableConcept: { text: 'Unknown' } },
      valueElements: [{
        id: 'Extension.value[x]', path: 'Extension.value[x]', min: 0, max: '0',
        type: [{ code: 'CodeableConcept' }, { code: 'string' }],
      }],
      path: 'Patient.extension[0]',
      profileUrl: ethnicity,
      context,
      typeValidator,
      valueSetValidator,
      elementRulesValidator,
    });

    expect(issues).toEqual([expect.objectContaining({
      code: 'profile-extension-wrong-value-type',
      message: `The Extension '${ethnicity}' definition allows for the types [] but found type CodeableConcept`,
    })]);
  });
});
