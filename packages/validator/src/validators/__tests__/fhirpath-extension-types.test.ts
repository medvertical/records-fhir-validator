import { describe, expect, it } from 'vitest';
import type { ElementDefinition, StructureDefinition } from '../../core/structure-definition-types';
import { ConstraintValidator } from '../constraint-validator';
import { SDFHIRPathExecutor } from '../sd-fhirpath-executor';

const profileUrl = 'https://example.test/StructureDefinition/extension-types';
const extensionUrl = 'https://example.test/extension/flag';
const valuePath = `extension('${extensionUrl}').value`;
type FhirVersion = 'R4' | 'R5' | 'R6';

const examples = [
  {
    name: 'a true boolean',
    extension: { valueBoolean: true },
    expression: `(${valuePath} as boolean) = true`,
  },
  {
    name: 'a false boolean in a conditional rule',
    extension: { valueBoolean: false },
    expression: `(${valuePath} as boolean) = true implies active = false`,
  },
  {
    name: 'a Coding',
    extension: { valueCoding: { system: 'https://example.test/codes', code: '1' } },
    expression: `(${valuePath} as Coding).code = '1'`,
  },
  {
    name: 'a CodeableConcept',
    extension: { valueCodeableConcept: { coding: [{ code: '1' }] } },
    expression: `(${valuePath} as CodeableConcept).coding.code = '1'`,
  },
  {
    name: 'a nested date',
    extension: { extension: [{ url: 'date', valueDate: '2026-07-01' }] },
    expression: `(extension('${extensionUrl}').extension('date').value as date) = @2026-07-01`,
  },
  {
    name: 'a nested Ratio',
    extension: { extension: [{ url: 'ratio', valueRatio: { numerator: { value: 1 }, denominator: { value: 4 } } }] },
    expression: `(extension('${extensionUrl}').extension('ratio').value as Ratio).numerator.value = 1`,
  },
] as const;

const engines = [
  {
    name: 'ConstraintValidator',
    validate: (resource: { resourceType: string }, elements: ElementDefinition[], fhirVersion: FhirVersion) =>
      new ConstraintValidator().validate(resource, elements, profileUrl, { fhirVersion }),
  },
  {
    name: 'SDFHIRPathExecutor',
    validate: (resource: { resourceType: string }, elements: ElementDefinition[], fhirVersion: FhirVersion) => {
      const structureDef: StructureDefinition = {
        resourceType: 'StructureDefinition', url: profileUrl, name: 'ExtensionTypes',
        status: 'active', kind: 'resource', abstract: false, type: resource.resourceType,
        snapshot: { element: elements },
      };
      return new SDFHIRPathExecutor().execute({
        resource, resourceType: resource.resourceType, structureDef, fhirVersion,
      });
    },
  },
];

function elements(expression: string, path = 'Patient'): ElementDefinition[] {
  return [...(path === 'Patient' ? [] : [{ id: 'Patient', path: 'Patient' }]), {
    id: path, path,
    constraint: [{ key: 'typed-extension', severity: 'error', human: 'Check the extension value', expression }],
  }];
}

for (const engine of engines) {
  describe.each(['R4', 'R5', 'R6'] as const)(`${engine.name} %s extension value types`, fhirVersion => {
    it.each(examples)('preserves $name through extension(url)', async example => {
      const resource = {
        resourceType: 'Patient', active: true,
        extension: [{ url: extensionUrl, ...example.extension }],
      };

      expect(await engine.validate(resource, elements(example.expression), fhirVersion)).toEqual([]);
      expect(resource.extension[0]).not.toHaveProperty('value');
    });

    it.each([
      { valueBoolean: false },
      { valueString: 'true' },
      { valueCoding: { code: 'true' } },
    ])('rejects a wrong value or type: %j', async extension => {
      const resource = { resourceType: 'Patient', extension: [{ url: extensionUrl, ...extension }] };

      const issues = await engine.validate(resource, elements(`(${valuePath} as boolean) = true`), fhirVersion);

      expect(issues).toEqual([expect.objectContaining({ ruleId: 'typed-extension', severity: 'error' })]);
    });

    it('preserves primitive-sidecar extensions and their code type without a primitive value', async () => {
      const resource = {
        resourceType: 'Patient',
        _gender: { extension: [{ url: extensionUrl, valueCode: 'unknown' }] },
      };

      expect(await engine.validate(resource, elements(`(gender.${valuePath} as code) = 'unknown'`), fhirVersion)).toEqual([]);
    });

    it('navigates typed extensions from a raw datatype constraint context', async () => {
      const resource = {
        resourceType: 'Patient',
        address: [{ extension: [{ url: extensionUrl, valueCoding: { code: '1' } }] }],
      };

      expect(await engine.validate(resource, elements(`(${valuePath} as Coding).code = '1'`, 'Patient.address'), fhirVersion)).toEqual([]);
    });
  });
}
