import { describe, expect, it } from 'vitest';
import { StructureDefinitionValidator } from '../structure-definition-validator';

describe('StructureDefinitionValidator — patternIdentifier ident-1', () => {
  const validator = new StructureDefinitionValidator();

  function sd(elements: any[]) {
    return {
      resourceType: 'StructureDefinition',
      type: 'Patient',
      url: 'http://example.org/sd',
      differential: { element: elements },
    };
  }

  it('flags patternIdentifier without value (no extension)', () => {
    const issues = validator.validate(sd([
      { id: 'Patient.identifier:mrn', path: 'Patient.identifier',
        sliceName: 'mrn', patternIdentifier: { system: 'http://x' } },
    ]));
    const ident1 = issues.filter(i => i.code === 'sd-pattern-ident-1');
    expect(ident1).toHaveLength(1);
    expect(ident1[0].severity).toBe('warning');
    expect(ident1[0].path).toBe('StructureDefinition.differential.element[0].patternIdentifier');
    expect(ident1[0].message).toContain('ident-1');
  });

  it('flags fixedIdentifier without value', () => {
    const issues = validator.validate(sd([
      { id: 'Patient.identifier', path: 'Patient.identifier',
        fixedIdentifier: { use: 'official' } },
    ]));
    expect(issues.some(i => i.code === 'sd-pattern-ident-1')).toBe(true);
  });

  it('does not flag patternIdentifier with a value', () => {
    const issues = validator.validate(sd([
      { id: 'Patient.identifier', path: 'Patient.identifier',
        patternIdentifier: { system: 'http://x', value: 'abc' } },
    ]));
    expect(issues.some(i => i.code === 'sd-pattern-ident-1')).toBe(false);
  });

  it('does not flag patternIdentifier when an extension is present (data-absent-reason)', () => {
    const issues = validator.validate(sd([
      { id: 'Patient.identifier', path: 'Patient.identifier',
        patternIdentifier: {
          system: 'http://x',
          extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason', valueCode: 'masked' }],
        } },
    ]));
    expect(issues.some(i => i.code === 'sd-pattern-ident-1')).toBe(false);
  });

  it('does not run on non-StructureDefinition resources', () => {
    const issues = validator.validate({
      resourceType: 'Patient',
      identifier: [{ system: 'http://x' }],
    });
    expect(issues.some(i => i.code === 'sd-pattern-ident-1')).toBe(false);
  });
});
