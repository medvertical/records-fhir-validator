import { describe, expect, it } from 'vitest';
import { validateCanonicalResourceMetadata } from '../canonical-resource-metadata-rules';

const WG = 'http://hl7.org/fhir/StructureDefinition/structuredefinition-wg';
const STANDARDS_STATUS = 'http://hl7.org/fhir/StructureDefinition/structuredefinition-standards-status';

const findings = (resource: Record<string, unknown>) => validateCanonicalResourceMetadata(resource)
  .map(issue => [issue.code, issue.severity]);

function hl7Resource(resourceType: string, wg: string | string[], fields: Record<string, unknown> = {}) {
  return {
    resourceType,
    url: `http://hl7.org/fhir/${resourceType}/example`,
    extension: [wg].flat().map(valueCode => ({ url: WG, valueCode })),
    contact: [{ telecom: [{ system: 'url', value: 'http://www.hl7.org/Special/committees/fiwg' }] }],
    ...fields,
  };
}

describe('canonical resource metadata rules', () => {
  it('accepts official HL7 publisher and committee URL variants for the nominated WG', () => {
    expect(findings({
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/StructureDefinition/Account',
      extension: [{ url: WG, valueCode: 'pa' }],
      publisher: 'Health Level Seven International (Patient Administration)',
      contact: [{ telecom: [{ system: 'url', value: 'http://www.hl7.org/Special/committees/pafm/index.cfm' }] }],
    })).toEqual([]);
  });

  it('checks publisher and contact against the nominated WG', () => {
    expect(findings({
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/StructureDefinition/Account',
      extension: [{ url: WG, valueCode: 'pa' }],
      publisher: 'Example Publisher',
      contact: [{ telecom: [{ system: 'url', value: 'http://example.org/wg' }] }],
    })).toEqual([['business-rule-wg-publisher', 'warning'], ['business-rule-wg-contact', 'warning']]);
  });

  // spark-r4 ValueSet/questionnaire-enable-operator: every canonical resource, not only profiles.
  it('checks a ValueSet published under http://hl7.org/fhir/', () => {
    expect(findings(hl7Resource('ValueSet', 'fhir', { publisher: 'HL7 (FHIR Project)' })))
      .toEqual([['business-rule-wg-publisher', 'warning']]);
  });

  it('leaves resources outside http://hl7.org/fhir/ alone', () => {
    expect(findings({
      resourceType: 'ValueSet',
      url: 'http://terminology.hl7.org/ValueSet/v2-0092',
      extension: [{ url: WG, valueCode: 'pa' }],
      publisher: 'HL7, Inc',
    })).toEqual([]);
  });

  it('knows each work group by the reference validator\'s names', () => {
    expect(findings(hl7Resource('CodeSystem', 'cgp', {
      publisher: 'HL7 International / Cross-Group Projects',
      contact: [{ telecom: [{ system: 'url', value: 'http://www.hl7.org/Special/committees/cgp' }] }],
    }))).toEqual([]);
    expect(findings(hl7Resource('CodeSystem', 'vocab', {
      publisher: 'HL7 International / Vocabulary',
      contact: [{ telecom: [{ system: 'url', value: 'http://www.hl7.org/Special/committees/Vocab' }] }],
    }))).toEqual([]);
  });

  it('fails a publisher that names the wrong HL7 group, an unknown group and several groups', () => {
    expect(findings(hl7Resource('ValueSet', 'fhir', { publisher: 'HL7 International / Patient Care' })))
      .toEqual([['business-rule-wg-publisher', 'error']]);
    expect(findings(hl7Resource('ValueSet', 'nope', { publisher: 'HL7' })))
      .toEqual([['business-rule-wg-unknown', 'error']]);
    expect(findings(hl7Resource('ValueSet', ['fhir', 'oo'], { publisher: 'HL7 International / FHIR Infrastructure' })))
      .toEqual([['business-rule-wg-multiple', 'error']]);
    expect(findings(hl7Resource('ValueSet', 'fhir')))
      .toEqual([['business-rule-wg-publisher-missing', 'warning']]);
  });

  it('holds the status to the standards status and the version free of #', () => {
    const withStatus = (standardsStatus: string, status: string) => findings({
      resourceType: 'SearchParameter',
      extension: [{ url: STANDARDS_STATUS, valueCode: standardsStatus }],
      status,
    });
    expect(withStatus('informative', 'retired')).toEqual([]);
    expect(withStatus('withdrawn', 'active')).toEqual([['business-rule-sd-status-consistency', 'warning']]);
    expect(withStatus('normative', 'draft')).toEqual([['business-rule-sd-status-consistency', 'warning']]);
    expect(findings({ resourceType: 'Library', version: '1.0#2' })).toEqual([['business-rule-version-hash', 'warning']]);
  });

  it('ignores resources that are not canonical', () => {
    expect(findings({ resourceType: 'Patient', url: 'http://hl7.org/fhir/Patient/x', extension: [{ url: WG, valueCode: 'x' }] }))
      .toEqual([]);
  });
});
