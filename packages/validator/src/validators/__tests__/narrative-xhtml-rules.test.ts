import { describe, expect, it } from 'vitest';
import { evaluateHtmlChecksConstraint } from '../fhirpath-html-checks';
import { validateNarrativeDiv } from '../narrative-xhtml-rules';

describe('Narrative XHTML attribute validation', () => {
  it('reports a non-string div as a primitive type mismatch without throwing', () => {
    const issues = validateNarrativeDiv(
      { invalidType: true },
      'Composition.text',
      'Composition',
    );

    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'structural-primitive-type-mismatch',
      path: 'Composition.text.div',
    }));
  });

  it('rejects the deprecated and change-mark elements the reference validator rejects', () => {
    const div =
      '<div xmlns="http://www.w3.org/1999/xhtml">' +
      '<p><s>retired</s> <strike>old</strike> <u>underlined</u> <ins>added</ins> <del>removed</del></p>' +
      '<address>Main St</address><bdo dir="rtl">x</bdo>' +
      '</div>';

    const issues = validateNarrativeDiv(div, 'DeviceDefinition.text', 'DeviceDefinition');

    expect(issues.filter(issue => issue.code === 'narrative-invalid-element').map(issue => issue.details?.element))
      .toEqual(['s', 'strike', 'u', 'ins', 'del']);
  });

  it('attributes findings on an xhtml fragment to the htmlChecks() constraint', () => {
    const issues = evaluateHtmlChecksConstraint(
      'htmlChecks()', "<img src='#okImage'>", 'Extension.valueString', 'Extension', undefined, 'xhtml-ext-1',
    );

    expect(issues).toEqual([expect.objectContaining({ code: 'narrative-malformed-xhtml', ruleId: 'xhtml-ext-1' })]);
  });

  it('requires empty elements to close themselves, as XHTML does', () => {
    const open = '<div xmlns="http://www.w3.org/1999/xhtml"><p>a<br>b</p></div>';
    const closed = '<div xmlns="http://www.w3.org/1999/xhtml"><p>a<br/>b</p><img src="#i"/></div>';

    expect(validateNarrativeDiv(open, 'Patient.text', 'Patient'))
      .toContainEqual(expect.objectContaining({ code: 'narrative-malformed-xhtml' }));
    expect(validateNarrativeDiv(closed, 'Patient.text', 'Patient')
      .filter(issue => issue.code === 'narrative-malformed-xhtml')).toEqual([]);
  });

  it('does not treat base64 data URI fragments inside style values as attributes', () => {
    const div =
      '<div xmlns="http://www.w3.org/1999/xhtml">' +
      '<table><tr><td style="background-image: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAyAAAAACCAYAAACg/LjIAAAAL0lEQVR42u3XsQ0AQAgCQHdl/xn8jxvYWB3JlTR0VJLa+OltBwAAYP6EEQAAgCsPVYVAgIJrA/sAAAAASUVORK5CYII=)" class="hierarchy">x</td></tr></table>' +
      '</div>';

    const issues = validateNarrativeDiv(div, 'StructureDefinition.text', 'StructureDefinition');

    expect(issues.filter(issue => issue.code === 'narrative-invalid-attribute')).toHaveLength(0);
    expect(issues.filter(issue => issue.code === 'narrative-txt1-violation')).toHaveLength(0);
  });

  it('still reports real disallowed attributes', () => {
    const div =
      '<div xmlns="http://www.w3.org/1999/xhtml">' +
      '<table><tr><td saaaaasuvork5cyii="x">x</td></tr></table>' +
      '</div>';

    const issues = validateNarrativeDiv(div, 'StructureDefinition.text', 'StructureDefinition');

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'narrative-invalid-attribute',
      details: expect.objectContaining({
        element: 'td',
        attribute: 'saaaaasuvork5cyii',
      }),
    }));
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'narrative-txt1-violation',
    }));
  });

  it('warns once for node ids and anchor names used by more than one node', () => {
    const div =
      '<div xmlns="http://www.w3.org/1999/xhtml" id="root">' +
      '<a name="med2"> </a><p id="med2">Medication</p><a name="med2"/>' +
      '<a name="self" id="self">x</a><p id="root">y</p>' +
      '<a name="hc-author"> </a><a name="hc-author"> </a><!-- <a name="self"/> -->' +
      '</div>';

    const issues = validateNarrativeDiv(div, 'MedicationRequest.text', 'MedicationRequest')
      .filter(issue => issue.code === 'narrative-duplicate-ids');

    expect(issues).toEqual([expect.objectContaining({
      severity: 'warning',
      path: 'MedicationRequest.text.div',
      message: expect.stringMatching(/anchor names: hc-author \(2x\), med2 \(3x\)$/),
      details: expect.objectContaining({
        duplicateIds: [{ id: 'hc-author', count: 2 }, { id: 'med2', count: 3 }],
      }),
    })]);
  });
});

describe('htmlChecks() on non-narrative xhtml fragments', () => {
  it('accepts a bare element fragment without demanding a narrative root div', () => {
    const issues = evaluateHtmlChecksConstraint(
      'htmlChecks()',
      "<img src='data:image/png;base64,AAAA'/>",
      'Questionnaire.item.answerOption.value[x].display.extension[0].valueString',
      'Questionnaire',
    );

    expect(issues).toEqual([]);
  });

  it('still applies the full narrative contract to Narrative.div contexts', () => {
    const issues = evaluateHtmlChecksConstraint(
      'htmlChecks()',
      '<p>no root div</p>',
      'Questionnaire.text.div',
      'Questionnaire',
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'narrative-invalid-root',
    }));
  });

  it('keeps the content policy for fragments', () => {
    const issues = evaluateHtmlChecksConstraint(
      'htmlChecks()',
      '<script>alert(1)</script>',
      'Questionnaire.item.text.extension[0].valueString',
      'Questionnaire',
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'narrative-forbidden-content',
      path: 'Questionnaire.item.text.extension[0].valueString',
    }));
  });
});

describe('Narrative link and image URLs', () => {
  const urlIssues = (div: string) => validateNarrativeDiv(div, 'Observation.text', 'Observation')
    .filter(issue => issue.code === 'narrative-url-invalid')
    .map(issue => [issue.severity, issue.message]);

  it('rejects a URL with a space or an empty one, as the reference validator does', () => {
    expect(urlIssues('<div xmlns="http://www.w3.org/1999/xhtml"><a href="http://hl7.org/fhir/us/bser/CodeSystem/bser x">x</a><img src="" alt="y"/></div>')).toEqual([
      ['error', "The URL is not valid because '(URL contains Invalid Character: ' ')': http://hl7.org/fhir/us/bser/CodeSystem/bser x"],
      ['error', "The URL is not valid because '(URL is empty)': "],
    ]);
  });

  it('accepts URL punctuation, non-ASCII letters, entity-encoded ampersands and data URLs', () => {
    expect(urlIssues('<div xmlns="http://www.w3.org/1999/xhtml"><a href="https://example.org/a?b=1&amp;c=(2)*|#frag">x</a>'
      + '<a href="https://exämple.org/größe">y</a><img src="data:image/png;base64,iVBORw0KGgo=" alt="z"/><a name="n">w</a></div>')).toEqual([]);
  });

  // SANER's CDC measure writes &trade; in its narrative; FHIR parses the div
  // as XML, which knows only the five predefined entities.
  it('reports HTML named entities, which XML without the XHTML DTD does not define', () => {
    const div = '<div xmlns="http://www.w3.org/1999/xhtml"><p>CDC&trade; &amp; partners &#8482; &lt;b&gt;</p></div>';
    expect(validateNarrativeDiv(div, 'Measure.text', 'Measure')).toEqual([
      expect.objectContaining({ code: 'narrative-invalid-entity', message: "Invalid entity in the XHTML ('&trade;')", path: 'Measure.text.div' }),
    ]);
  });
});
