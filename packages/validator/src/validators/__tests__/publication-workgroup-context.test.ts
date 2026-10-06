import { describe, expect, it } from 'vitest';
import { validateCanonicalResourceMetadata } from '../canonical-resource-metadata-rules.js';

const WG = 'http://hl7.org/fhir/StructureDefinition/structuredefinition-wg';
const base = { resourceType: 'ValueSet', url: 'http://hl7.org/fhir/ValueSet/PublicationControl', status: 'draft' };
const options = { forPublication: true };
const codes = (resource: Record<string, unknown>, publication = false) =>
  validateCanonicalResourceMetadata(resource, { forPublication: publication }).map(issue => [issue.code, issue.severity]);
const nominated = (valueCode: string) => ({ ...base, extension: [{ url: WG, valueCode }],
  publisher: 'HL7 International / FHIR Infrastructure',
  contact: [{ telecom: [{ system: 'url', value: 'http://www.hl7.org/Special/committees/fiwg' }] }] });

describe('explicit publication workgroup policy', () => {
  it.each([undefined, false, true])('requires own WG only for publication=%s', publication => {
    expect(validateCanonicalResourceMetadata(base, { forPublication: publication }).map(issue => [issue.code, issue.severity]))
      .toEqual(publication === true ? [['business-rule-wg-missing', 'error']] : []);
  });
  it('defaults to normal validation', () => expect(validateCanonicalResourceMetadata(base)).toEqual([]));
  it.each(['http://hl7.org/fhir/sid', 'http://hl7.org/fhir/sid/icd-10-cm'])('exempts the reference SID namespace %s', url => {
    expect(codes({ ...base, url }, true)).toEqual([]);
  });
  it.each(['https://hl7.org/fhir/ValueSet/X', 'http://hl7.org/fhir.evil/ValueSet/X',
    'http://terminology.hl7.org/ValueSet/X', 'https://vendor.test/ValueSet/X'])('does not extend the HL7 canonical prefix to %s', url => {
    expect(codes({ ...base, url }, true)).toEqual([]);
  });
  it.each(['Patient', 'Bundle'])('does not treat %s as canonical', resourceType => {
    expect(codes({ ...base, resourceType }, true)).toEqual([]);
  });
  it('accepts a known own WG with its publisher and committee page', () => expect(codes(nominated('fhir'), true)).toEqual([]));
  it.each(['unknown-wg', 'constructor', '__proto__', 'toString'])('rejects the external WG code %s without a runtime exception', wg => {
    expect(codes(nominated(wg), false)).toEqual([['business-rule-wg-unknown', 'error']]);
    expect(codes(nominated(wg), true)).toEqual([['business-rule-wg-unknown', 'error']]);
  });
  it('keeps multiple nominations independently invalid', () => {
    expect(codes({ ...nominated('fhir'), extension: [{ url: WG, valueCode: 'fhir' }, { url: WG, valueCode: 'oo' }] }, true))
      .toEqual([['business-rule-wg-multiple', 'error']]);
  });
  it.each([{ url: WG }, { url: WG, valueString: 'fhir' }, { url: WG, valueCode: 3 }])('does not derive a valid WG from a malformed nomination %j', extension => {
    expect(codes({ ...base, extension: [extension] }, true)).toEqual([['business-rule-wg-missing', 'error']]);
  });
  it('keeps existing publisher/contact rules in normal validation', () => {
    expect(codes({ ...nominated('fhir'), publisher: 'Vendor', contact: [] })).toEqual([
      ['business-rule-wg-publisher', 'warning'], ['business-rule-wg-contact', 'warning']]);
  });
  it('does not infer example mode from a URL, resource type or experimental flag', () => {
    expect(codes({ ...base, resourceType: 'ExampleScenario', url: 'http://hl7.org/fhir/ExampleScenario/example', experimental: true }, true))
      .toEqual([['business-rule-wg-missing', 'error']]);
  });
  it('does not make status and version consistency publication-only', () => {
    const body = { resourceType: 'ValueSet', version: '1#fragment', status: 'draft',
      extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/structuredefinition-standards-status', valueCode: 'normative' }] };
    expect(validateCanonicalResourceMetadata(body, options).map(issue => [issue.code, issue.severity])).toEqual([
      ['business-rule-sd-status-consistency', 'warning'], ['business-rule-version-hash', 'warning']]);
    expect(codes(body)).toEqual(codes(body, true));
  });
});
