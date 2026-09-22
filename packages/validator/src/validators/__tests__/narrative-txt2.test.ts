import { describe, expect, it } from 'vitest';
import { validateNarrativeDiv } from '../narrative-xhtml-rules';
import { NarrativeValidator } from '../narrative-validator';

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

function txt2Issues(div: string, basePath = 'Patient.text', resourceType = 'Patient') {
  return validateNarrativeDiv(div, basePath, resourceType)
    .filter(issue => issue.code === 'narrative-txt2-violation');
}

describe('Narrative txt-2 (non-whitespace content) validation', () => {
  it('reports txt-2 for an empty generated table (hapi.fhir.org empty-Patient shape)', () => {
    const div =
      `<div xmlns="${XHTML_NS}"><table class="hapiPropertyTable"><tbody/></table></div>`;

    const issues = txt2Issues(div);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual(expect.objectContaining({
      severity: 'error',
      path: 'Patient.text.div',
      message:
        `Constraint failed: txt-2: 'The narrative SHALL have some non-whitespace content' ` +
        `(defined in http://hl7.org/fhir/StructureDefinition/Narrative)`,
    }));
  });

  it('reports txt-2 for a whitespace-only div', () => {
    const div = `<div xmlns="${XHTML_NS}">  \n\t  </div>`;

    expect(txt2Issues(div)).toHaveLength(1);
  });

  it('reports txt-2 when the only text is inside comments or CDATA', () => {
    const div = `<div xmlns="${XHTML_NS}"><!-- hidden --><![CDATA[also hidden]]></div>`;

    expect(txt2Issues(div)).toHaveLength(1);
  });

  it('reports txt-2 when entities decode to whitespace only', () => {
    const div = `<div xmlns="${XHTML_NS}"><p>&#32;&#x20;&#10;</p></div>`;

    expect(txt2Issues(div)).toHaveLength(1);
  });

  it('does NOT report txt-2 for an image-only narrative', () => {
    const div = `<div xmlns="${XHTML_NS}"><img src="pic.png" alt=""/></div>`;

    expect(txt2Issues(div)).toHaveLength(0);
  });

  it.each(['<img alt="placeholder"/>', '<img alt="src=placeholder"/>', '<img data-src="pic.png"/>'])('reports txt-2 for an image without a src attribute: %s', image => {
      expect(txt2Issues(`<div xmlns="${XHTML_NS}">${image}</div>`)).toHaveLength(1);
    });

  it('does NOT report txt-2 for a normal narrative', () => {
    const div = `<div xmlns="${XHTML_NS}"><p>Patient summary</p></div>`;

    expect(validateNarrativeDiv(div, 'Patient.text', 'Patient')).toHaveLength(0);
  });

  it('does NOT report txt-2 when an entity decodes to visible text', () => {
    const div = `<div xmlns="${XHTML_NS}"><p>&amp;</p></div>`;

    expect(txt2Issues(div)).toHaveLength(0);
  });

  it('counts &nbsp; as content, matching the Java reference validator', () => {
    const div = `<div xmlns="${XHTML_NS}"><p>&nbsp;</p></div>`;

    expect(txt2Issues(div)).toHaveLength(0);
  });

  it('flags empty Composition.section narratives while keeping a valid root narrative clean', () => {
    const validator = new NarrativeValidator();
    const composition = {
      resourceType: 'Composition',
      text: {
        status: 'generated',
        div: `<div xmlns="${XHTML_NS}"><p>Discharge summary</p></div>`,
      },
      section: [{
        title: 'Empty section',
        text: {
          status: 'generated',
          div: `<div xmlns="${XHTML_NS}"><table><tbody/></table></div>`,
        },
      }],
    };

    const issues = validator.validateNarrative(composition, 'Composition');
    const violations = issues.filter(issue => issue.code === 'narrative-txt2-violation');

    expect(violations).toHaveLength(1);
    expect(violations[0].path).toBe('Composition.section[0].text.div');
  });
});
