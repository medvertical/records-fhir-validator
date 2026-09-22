import { describe, expect, it } from 'vitest';
import { universalConstraintsValidator } from '../universal-constraints-validator';

describe('universalConstraintsValidator', () => {
  it('does not report ele-1 when a primitive sidecar-only child has extensions', () => {
    const issues = universalConstraintsValidator.validate({
      resourceType: 'Observation',
      id: 'obs-heart-rate',
      subject: {
        _reference: {
          extension: [{
            url: 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-templateExtractValue',
            valueString: "'Patient/' + %resource.item.where(linkId='patient-id').answer.valueString",
          }],
        },
      },
    });

    expect(issues.some(issue => issue.code === 'ele-1-violation')).toBe(false);
  });

  it('does not report ele-1 when a repeating primitive sidecar array has extensions', () => {
    const issues = universalConstraintsValidator.validate({
      resourceType: 'ActivityDefinition',
      id: 'administer-zika-virus-exposure-assessment',
      timingTiming: {
        _event: [{
          extension: [{
            url: 'http://hl7.org/fhir/StructureDefinition/cqf-expression',
            valueExpression: {
              language: 'text/cql',
              expression: 'Now()',
            },
          }],
        }],
      },
    });

    expect(issues.some(issue =>
      issue.code === 'ele-1-violation' &&
      issue.path === 'ActivityDefinition.timingTiming'
    )).toBe(false);
  });

  it('still reports ele-1 when a primitive sidecar-only child is empty', () => {
    const issues = universalConstraintsValidator.validate({
      resourceType: 'Observation',
      id: 'obs-heart-rate',
      subject: {
        _reference: {},
      },
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'ele-1-violation',
      path: 'Observation.subject',
    }));
  });

  it('reports ele-1 when a primitive sidecar contains only an element id', () => {
    const issues = universalConstraintsValidator.validate({
      resourceType: 'Patient',
      id: 'patient-id-only',
      _implicitRules: { id: 'metadata-only' },
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'ele-1-violation',
      path: 'Patient.implicitRules',
    }));
  });

  it('reports ele-1 when a repeating element contains only an element id', () => {
    const issues = universalConstraintsValidator.validate({
      resourceType: 'Patient',
      name: [{ id: 'metadata-only' }],
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'ele-1-violation',
      path: 'Patient.name[0]',
    }));
  });

  it('still reports ele-1 when a repeating primitive sidecar array has no meaningful items', () => {
    const issues = universalConstraintsValidator.validate({
      resourceType: 'ActivityDefinition',
      id: 'empty-timing',
      timingTiming: {
        _event: [{}],
      },
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'ele-1-violation',
      path: 'ActivityDefinition.timingTiming',
    }));
  });

  it('accepts conditional relative references for ref-1', () => {
    const issues = universalConstraintsValidator.validate({
      resourceType: 'Encounter',
      id: 'enc-1',
      subject: {
        reference: 'Patient?identifier=9000951',
      },
    });

    expect(issues.some(issue => issue.code === 'ref-1-violation')).toBe(false);
  });

  it('still rejects bare non-url reference values for ref-1', () => {
    const issues = universalConstraintsValidator.validate({
      resourceType: 'Encounter',
      id: 'enc-1',
      subject: {
        reference: 'not-a-reference',
      },
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'ref-1-violation',
      path: 'Encounter.subject.reference',
    }));
  });

  it('reports ele-1 for a primitive whose only child is its id', () => {
    // <implicitRules id="i1"/> — no value, and the expression discounts id:
    // `hasValue() or (children().count() > id.count())`.
    const issues = universalConstraintsValidator.validate({
      resourceType: 'Patient',
      id: 'pat-good',
      _implicitRules: { id: 'i1' },
      language: 'en-AU',
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'ele-1-violation',
      path: 'Patient.implicitRules',
    }));
  });

  it('accepts a primitive whose sidecar carries an extension', () => {
    const issues = universalConstraintsValidator.validate({
      resourceType: 'Patient',
      _active: {
        extension: [{
          url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
          valueCode: 'unknown',
        }],
      },
    });

    expect(issues.filter(issue => issue.code === 'ele-1-violation')).toEqual([]);
  });

  it('does not report ele-1 when the primitive carries a value', () => {
    const issues = universalConstraintsValidator.validate({
      resourceType: 'Patient',
      implicitRules: 'http://example.org/rules',
      _implicitRules: { id: 'i1' },
    });

    expect(issues.filter(issue => issue.code === 'ele-1-violation')).toEqual([]);
  });

  it('leaves extensions to ext-1', () => {
    const issues = universalConstraintsValidator.validate({
      resourceType: 'Patient',
      extension: [{ url: 'http://example.org/x', _valueString: { id: 'e1' } }],
    });

    expect(issues.filter(issue => issue.code === 'ele-1-violation')).toEqual([]);
  });

  it('does not walk into narrative markup', () => {
    // A narrative whose namespace is wrong reaches the validator as a walked
    // tree rather than a string. It is XHTML, not FHIR elements.
    const issues = universalConstraintsValidator.validate({
      resourceType: 'List',
      text: { status: 'generated', div: { p: {} } },
    });

    expect(issues.filter(issue => issue.code === 'ele-1-violation')).toEqual([]);
  });

  it('terminates safely for cyclic object graphs', () => {
    const resource: Record<string, unknown> = {
      resourceType: 'Patient',
      id: 'patient-1',
    };
    resource.self = resource;

    expect(universalConstraintsValidator.validate(resource)).toEqual([]);
  });
});
