import { describe, it, expect } from 'vitest';
import { NarrativeValidator } from '../narrative-validator';

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

  it('flags an unresolvable contained-reference data target', () => {
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
    expect(uriIssue).toBeDefined();
    expect(uriIssue!.path).toBe('Composition.text.extension[0].extension[1].value.ofType(uri)');
  });

  it('does not flag a textLink whose htmlid + data both resolve', () => {
    const resource = {
      ...COMPOSITION_BASE,
      contained: [{ resourceType: 'Patient', id: 'pat-1' }],
      text: {
        status: 'generated',
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><span id='anchor-A'>x</span></div>`,
        extension: [
          {
            url: 'http://hl7.org/fhir/StructureDefinition/textLink',
            extension: [
              { url: 'htmlid', valueString: 'anchor-A' },
              { url: 'data', valueUri: '#pat-1' },
            ],
          },
        ],
      },
    };

    const issues = validator.validateNarrative(resource, 'Composition');
    expect(issues.filter(i => i.code?.startsWith('narrative-textlink-'))).toHaveLength(0);
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

  it('skips data-target check when valueUri is not a fragment reference', () => {
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
    expect(issues.filter(i => i.code?.startsWith('narrative-textlink-'))).toHaveLength(0);
  });
});
