import { describe, expect, it } from 'vitest';
import {
  validateContainedResourceIdsPresent,
  validateContainedResourcesReferenced,
  validateEmptyPrimitives,
  validateIllegalXmlCharacterPrimitives,
  validateNoEmptyArrays,
  validateOrphanPrimitiveSidecars,
  validatePrimitiveSidecarArrayAlignment,
  validateResourceId,
  validateUniqueElementIds,
  validateWhitespaceOnlyPrimitives,
} from '../structural-sanity-rules';

describe('structural sanity rules', () => {
  // Finland's blood pressure example leaves its note text as "".
  it('reports a primitive written as an empty string unless its sidecar carries extensions', () => {
    const issues = validateEmptyPrimitives({
      resourceType: 'Observation',
      note: [{ text: '' }],
      identifier: [{ system: 'urn:x', value: 'v', _value: { id: 'only-an-id' } }],
      category: [{ text: '', _text: { extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason', valueCode: 'unknown' }] } }],
      component: [{ code: { coding: [{ code: 'x' }] }, valueString: ' ' }],
      focus: [{ display: 'x' }],
    }, 'Observation');

    expect(issues.map(issue => [issue.code, issue.path, issue.severity])).toEqual([
      ['structural-empty-value', 'Observation.note[0].text', 'error'],
    ]);
  });

  it('reports each empty entry of a repeating primitive', () => {
    const issues = validateEmptyPrimitives({ resourceType: 'Patient', name: [{ given: ['', 'Anna', ''], _given: [null, null, { id: 'g' }] }] }, 'Patient');

    expect(issues.map(issue => issue.path)).toEqual(['Patient.name[0].given[0]', 'Patient.name[0].given[2]']);
  });

  it('rejects primitive sidecar entries beyond the value array', () => {
    const issues = validatePrimitiveSidecarArrayAlignment({
      resourceType: 'Patient',
      name: [{
        given: ['a'],
        _given: [{ id: 'test' }, null],
      }],
    }, 'Patient');

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'structural-primitive-array-alignment',
      path: 'Patient.name[0].given',
      severity: 'error',
    }));
  });

  it('rejects extensions on Resource.id', () => {
    const issues = validateResourceId({
      resourceType: 'Patient',
      id: 'patient-1',
      _id: {
        extension: [{
          url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
          valueCode: 'masked',
        }],
      },
    }, 'Patient');

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'structural-resource-id-extension',
      path: 'Patient.id',
      severity: 'error',
    }));
  });

  it('terminates safely when an in-memory resource graph contains a cycle', () => {
    const resource: Record<string, unknown> = {
      resourceType: 'Patient',
      name: [],
    };
    resource.self = resource;

    expect(validateNoEmptyArrays(resource, 'Patient')).toContainEqual(
      expect.objectContaining({ code: 'structural-empty-array', path: 'Patient.name' }),
    );
    expect(() => validateUniqueElementIds(resource, 'Patient')).not.toThrow();
    expect(() => validateWhitespaceOnlyPrimitives(resource, 'Patient')).not.toThrow();
    expect(() => validatePrimitiveSidecarArrayAlignment(resource, 'Patient')).not.toThrow();
    expect(() => validateContainedResourcesReferenced(resource, 'Patient')).not.toThrow();
  });

  it('reports null contained entries without dereferencing them', () => {
    const issues = validateContainedResourceIdsPresent({
      resourceType: 'Patient',
      contained: [null],
    }, 'Patient');

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'structural-contained-id-missing',
      path: 'Patient.contained[0]/*Resource/null*/',
    }));
  });

  it('flags a whitespace-only string containing exotic Unicode whitespace incl. NEL', () => {
    const issues = validateWhitespaceOnlyPrimitives({
      resourceType: 'Parameters',
      parameter: [{ name: 'allWS', valueString: '\t\n\u000b\u000c\r \u0085\u00a0\u2000\u3000' }],
    }, 'Parameters');

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'string-whitespace-only',
      path: 'Parameters.parameter[0].valueString',
      severity: 'warning',
    }));
  });

  it('warns once per string that carries XML-illegal control characters', () => {
    const issues = validateIllegalXmlCharacterPrimitives({
      resourceType: 'Parameters',
      parameter: [{ name: 'bad', valueString: 'a\u000bb\u000cc' }],
    }, 'Parameters');

    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual(expect.objectContaining({
      code: 'string-illegal-xml-chars',
      path: 'Parameters.parameter[0].valueString',
      severity: 'warning',
    }));
    expect(issues[0].message).toContain('[b, c] (hex values)');
  });

  it('does not flag tab, LF or CR as XML-illegal', () => {
    const issues = validateIllegalXmlCharacterPrimitives({
      resourceType: 'Parameters',
      parameter: [{ name: 'ok', valueString: 'line1\nline2\tend\r' }],
    }, 'Parameters');

    expect(issues).toEqual([]);
  });

  it('accepts a sidecar-only primitive carrying an arbitrary extension', () => {
    // US Core glascow-coma-score: `_questionnaire` alone with the
    // questionnaire-uri extension is legal FHIR JSON (primitive with
    // extensions but no value).
    const issues = validateOrphanPrimitiveSidecars({
      resourceType: 'QuestionnaireResponse',
      _questionnaire: {
        extension: [{
          url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-extension-questionnaire-uri',
          valueUri: 'https://example.org/gcs.pdf',
        }],
      },
    }, 'QuestionnaireResponse');

    expect(issues).toEqual([]);
  });

  it('accepts a sidecar-only primitive carrying only an element id', () => {
    const issues = validateOrphanPrimitiveSidecars({
      resourceType: 'Patient',
      _birthDate: { id: 'anchor-1' },
    }, 'Patient');

    expect(issues).toEqual([]);
  });

  it('flags a sidecar-only primitive with neither id nor extension', () => {
    const issues = validateOrphanPrimitiveSidecars({
      resourceType: 'Patient',
      _birthDate: { value: '1990-01-01' },
    }, 'Patient');

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'structural-orphan-primitive-extension',
      path: 'Patient.birthDate',
      severity: 'error',
    }));
  });

  it('accepts a contained resource that refers to its container with a bare hash', () => {
    const issues = validateContainedResourcesReferenced({
      resourceType: 'Organization',
      contained: [{
        resourceType: 'OrganizationAffiliation',
        id: 'affiliation',
        organization: { reference: '#' },
      }],
    }, 'Organization');

    expect(issues).toEqual([]);
  });

  it('reports unreferenced contained resources with a specific dom-3 code', () => {
    const issues = validateContainedResourcesReferenced({
      resourceType: 'Citation',
      contained: [{ resourceType: 'Organization', id: 'contributor0' }],
    }, 'Citation');

    expect(issues).toEqual([expect.objectContaining({
      code: 'structural-contained-not-referenced',
      severity: 'error',
      path: 'Citation.contained[0]',
      message: "The contained resource 'contributor0' is not referenced to from elsewhere in the containing resource nor does it refer to the containing resource",
      details: expect.objectContaining({
        constraintKey: 'dom-3',
        containedId: 'contributor0',
      }),
    })]);
  });
});
