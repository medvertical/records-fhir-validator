import { describe, it, expect } from 'vitest';
import { NarrativeValidator } from '../narrative-validator';
import { dedupeIssues } from '../../core/validation-utils';

const validator = new NarrativeValidator();

const COMPOSITION_BASE = {
  resourceType: 'Composition',
  id: 'c0',
  status: 'final',
  type: { text: 'X' },
  date: '2024-01-01',
  title: 'T',
};

describe('NarrativeValidator textLink extension', () => {
  it('flags a local hyperlink whose XHTML target does not exist', () => {
    const resource = {
      ...COMPOSITION_BASE,
      text: {
        status: 'generated',
        div: '<div xmlns="http://www.w3.org/1999/xhtml"><a href="#missing">missing</a></div>',
      },
    };

    const issues = validator.validateNarrative(resource, 'Composition');

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'narrative-hyperlink-target-not-found',
      path: 'Composition.text.div',
      severity: 'error',
    }));
  });

  it('accepts a local hyperlink whose XHTML target exists', () => {
    const resource = {
      ...COMPOSITION_BASE,
      text: {
        status: 'generated',
        div: '<div xmlns="http://www.w3.org/1999/xhtml"><a href="#present">present</a><span id="present">x</span></div>',
      },
    };

    const issues = validator.validateNarrative(resource, 'Composition');

    expect(issues.filter(issue => issue.code === 'narrative-hyperlink-target-not-found')).toEqual([]);
  });

  it('resolves the IG-publisher contained-resource anchor idiom via <a name>', () => {
    const resource = {
      ...COMPOSITION_BASE,
      text: {
        status: 'generated',
        div:
          '<div xmlns="http://www.w3.org/1999/xhtml">' +
          '<a name="hcc0/med2"> </a>' +
          '<a href="#hcc0/med2">Nizatidine 15 MG/ML Oral Solution</a>' +
          '</div>',
      },
    };

    const issues = validator.validateNarrative(resource, 'Composition');

    expect(issues.filter(issue => issue.code === 'narrative-hyperlink-target-not-found')).toEqual([]);
  });

  it('resolves the questionnaire option-list anchor idiom via <a name>', () => {
    const resource = {
      ...COMPOSITION_BASE,
      text: {
        status: 'generated',
        div:
          '<div xmlns="http://www.w3.org/1999/xhtml">' +
          '<a href="#opt-item./68519-8">5 options</a>' +
          '<a name="opt-item./68519-8"> </a>' +
          '</div>',
      },
    };

    const issues = validator.validateNarrative(resource, 'Composition');

    expect(issues.filter(issue => issue.code === 'narrative-hyperlink-target-not-found')).toEqual([]);
  });

  it('does not treat name attributes on non-anchor elements as link targets', () => {
    const resource = {
      ...COMPOSITION_BASE,
      text: {
        status: 'generated',
        div:
          '<div xmlns="http://www.w3.org/1999/xhtml">' +
          '<span name="target">x</span>' +
          '<a href="#target">broken</a>' +
          '</div>',
      },
    };

    const issues = validator.validateNarrative(resource, 'Composition');

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'narrative-hyperlink-target-not-found',
      severity: 'error',
    }));
  });

  it('does not treat data-name on an anchor element as a link target', () => {
    const resource = {
      ...COMPOSITION_BASE,
      text: {
        status: 'generated',
        div:
          '<div xmlns="http://www.w3.org/1999/xhtml">' +
          '<a data-name="target">x</a>' +
          '<a href="#target">broken</a>' +
          '</div>',
      },
    };

    const issues = validator.validateNarrative(resource, 'Composition');

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'narrative-hyperlink-target-not-found',
      severity: 'error',
    }));
  });

  it('keeps one finding for every distinct unresolved target in the same div', () => {
    const resource = {
      ...COMPOSITION_BASE,
      text: {
        status: 'generated',
        div:
          '<div xmlns="http://www.w3.org/1999/xhtml">' +
          '<a href="#Patient_missing">Patient</a>' +
          '<a href="#Organization_missing">Organization</a>' +
          '</div>',
      },
    };

    const issues = dedupeIssues(validator.validateNarrative(resource, 'Composition'));

    expect(issues.filter(issue => issue.code === 'narrative-hyperlink-target-not-found'))
      .toHaveLength(2);
  });

  it('flags an htmlid that is not present in the rendered xhtml', () => {
    const resource = {
      ...COMPOSITION_BASE,
      contained: [{ resourceType: 'Patient', id: 'pat-1' }],
      text: {
        status: 'generated',
        div: '<div xmlns="http://www.w3.org/1999/xhtml"><span id="anchor-A">x</span></div>',
        extension: [
          {
            url: 'http://hl7.org/fhir/StructureDefinition/textLink',
            extension: [
              { url: 'htmlid', valueString: 'anchor-MISSING' },
              { url: 'data', valueUri: '#pat-1' },
            ],
          },
        ],
      },
    };

    const issues = validator.validateNarrative(resource, 'Composition');
    const htmlidIssue = issues.find(i => i.code === 'narrative-textlink-htmlid-not-found');
    expect(htmlidIssue).toBeDefined();
    expect(htmlidIssue!.severity).toBe('error');
    expect(htmlidIssue!.message).toContain("'anchor-MISSING'");
  });

  it('flags a data target absent from the structured resource without a duplicate URI error', () => {
    const resource = {
      ...COMPOSITION_BASE,
      contained: [{ resourceType: 'Patient', id: 'pat-1' }],
      text: {
        status: 'generated',
        div: '<div xmlns="http://www.w3.org/1999/xhtml"><span id="anchor-A">x</span></div>',
        extension: [
          {
            url: 'http://hl7.org/fhir/StructureDefinition/textLink',
            extension: [
              { url: 'htmlid', valueString: 'anchor-A' },
              { url: 'data', valueUri: '#unknown-target' },
            ],
          },
        ],
      },
    };

    const issues = validator.validateNarrative(resource, 'Composition');
    const targetIssue = issues.find(i => i.code === 'narrative-textlink-target-not-found');
    const uriIssue = issues.find(i => i.code === 'narrative-textlink-uri-no-target');
    expect(targetIssue).toBeDefined();
    expect(targetIssue!.severity).toBe('error');
    expect(targetIssue!.message).toContain("'#unknown-target'");
    expect(uriIssue).toBeUndefined();
  });

  it('does not accept a textLink data target supplied only by the rendered xhtml', () => {
    const resource = {
      ...COMPOSITION_BASE,
      text: {
        status: 'generated',
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><span id='anchor-A'>x</span></div>`,
        extension: [
          {
            url: 'http://hl7.org/fhir/StructureDefinition/textLink',
            extension: [
              { url: 'htmlid', valueString: 'anchor-A' },
              { url: 'data', valueUri: '#anchor-A' },
            ],
          },
        ],
      },
    };

    const issues = validator.validateNarrative(resource, 'Composition');
    expect(issues.filter(i => i.code?.startsWith('narrative-textlink-')).map(i => i.code)).toEqual(['narrative-textlink-target-not-found']);
  });

  it('ignores extensions that are not the textLink URL', () => {
    const resource = {
      ...COMPOSITION_BASE,
      text: {
        status: 'generated',
        div: '<div xmlns="http://www.w3.org/1999/xhtml">x</div>',
        extension: [
          {
            url: 'http://example.org/some-other-extension',
            extension: [{ url: 'htmlid', valueString: 'anything' }],
          },
        ],
      },
    };

    const issues = validator.validateNarrative(resource, 'Composition');
    expect(issues.filter(i => i.code?.startsWith('narrative-textlink-'))).toHaveLength(0);
  });

  it('preserves incompleteness when an external data target cannot be checked', () => {
    const resource = {
      ...COMPOSITION_BASE,
      text: {
        status: 'generated',
        div: '<div xmlns="http://www.w3.org/1999/xhtml"><span id="anchor-A">x</span></div>',
        extension: [
          {
            url: 'http://hl7.org/fhir/StructureDefinition/textLink',
            extension: [
              { url: 'htmlid', valueString: 'anchor-A' },
              { url: 'data', valueUri: 'http://example.org/Patient/abc' },
            ],
          },
        ],
      },
    };

    const issues = validator.validateNarrative(resource, 'Composition');
    expect(issues).toContainEqual(expect.objectContaining({ code: 'narrative-textlink-target-unverified', severity: 'information', details: expect.objectContaining({ validationComplete: false }) }));
  });

  it('does not resolve htmlids that only occur inside XHTML comments', () => {
    const resource = {
      ...COMPOSITION_BASE,
      contained: [{ resourceType: 'Patient', id: 'pat-1' }],
      text: {
        status: 'generated',
        div: '<div xmlns="http://www.w3.org/1999/xhtml"><!-- <span id="hidden">x</span> --></div>',
        extension: [{
          url: 'http://hl7.org/fhir/StructureDefinition/textLink',
          extension: [
            { url: 'htmlid', valueString: 'hidden' },
            { url: 'data', valueUri: '#pat-1' },
          ],
        }],
      },
    };

    const issues = validator.validateNarrative(resource, 'Composition');
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'narrative-textlink-htmlid-not-found',
    }));
  });
});
