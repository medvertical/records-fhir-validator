import { describe, expect, it } from 'vitest';
import { validateBundleReachability } from '../bundle-reachability';

describe('validateBundleReachability', () => {
  it('reports document entries that cannot be reached from the Composition', () => {
    const issues = validateBundleReachability({
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        {
          fullUrl: 'urn:uuid:composition',
          resource: {
            resourceType: 'Composition',
            id: 'composition',
            subject: { reference: 'urn:uuid:patient' },
          },
        },
        {
          fullUrl: 'urn:uuid:patient',
          resource: { resourceType: 'Patient', id: 'patient' },
        },
        {
          fullUrl: 'urn:uuid:observation',
          resource: { resourceType: 'Observation', id: 'observation' },
        },
      ],
    }, 'document');

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'bundle-entry-not-reachable',
        path: 'Bundle.entry[2]',
        severity: 'error',
      }),
    ]);
  });

  it('treats an absolute Attachment.url as a link to an in-bundle Binary', () => {
    // eu.imaging document bundles reference their Binary only via
    // DiagnosticReport.presentedForm[0].url — the HL7 validator counts that
    // as a link, so must we.
    const issues = validateBundleReachability({
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        {
          fullUrl: 'http://example.com/fhir/Composition/comp',
          resource: {
            resourceType: 'Composition',
            id: 'comp',
            section: [{ entry: [{ reference: 'DiagnosticReport/report' }] }],
          },
        },
        {
          fullUrl: 'http://example.com/fhir/DiagnosticReport/report',
          resource: {
            resourceType: 'DiagnosticReport',
            id: 'report',
            presentedForm: [{ contentType: 'application/pdf', url: 'http://example.com/fhir/Binary/pdf' }],
          },
        },
        {
          fullUrl: 'http://example.com/fhir/Binary/pdf',
          resource: { resourceType: 'Binary', id: 'pdf', contentType: 'application/pdf' },
        },
      ],
    }, 'document');

    expect(issues).toEqual([]);
  });

  it('resolves a relative Attachment.url against the entry fullUrl base', () => {
    const issues = validateBundleReachability({
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        {
          fullUrl: 'http://example.com/fhir/Composition/comp',
          resource: {
            resourceType: 'Composition',
            id: 'comp',
            section: [{ entry: [{ reference: 'DiagnosticReport/report' }] }],
          },
        },
        {
          fullUrl: 'http://example.com/fhir/DiagnosticReport/report',
          resource: {
            resourceType: 'DiagnosticReport',
            id: 'report',
            presentedForm: [{ contentType: 'application/pdf', url: 'Binary/pdf' }],
          },
        },
        {
          fullUrl: 'http://example.com/fhir/Binary/pdf',
          resource: { resourceType: 'Binary', id: 'pdf', contentType: 'application/pdf' },
        },
      ],
    }, 'document');

    expect(issues).toEqual([]);
  });

  it('does not treat extension canonical urls as bundle links', () => {
    const issues = validateBundleReachability({
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        {
          fullUrl: 'http://example.com/fhir/Composition/comp',
          resource: {
            resourceType: 'Composition',
            id: 'comp',
            extension: [{ url: 'http://example.com/fhir/Binary/orphan', valueBoolean: true }],
          },
        },
        {
          fullUrl: 'http://example.com/fhir/Binary/orphan',
          resource: { resourceType: 'Binary', id: 'orphan', contentType: 'application/pdf' },
        },
      ],
    }, 'document');

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'bundle-entry-not-reachable',
        path: 'Bundle.entry[1]',
      }),
    ]);
  });

  it('handles malformed entry values safely in strict-reference mode', () => {
    expect(() => validateBundleReachability({
      entry: [null, 42, { resource: 'invalid' }],
    }, 'message', true)).not.toThrow();
  });

  it('ignores non-object bundle inputs', () => {
    expect(validateBundleReachability(null, 'document')).toEqual([]);
  });

  describe('entries reached only by pointing back at the document', () => {
    const document = {
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        { fullUrl: 'urn:uuid:composition', resource: { resourceType: 'Composition', subject: { reference: 'urn:uuid:patient' } } },
        { fullUrl: 'urn:uuid:patient', resource: { resourceType: 'Patient' } },
        { fullUrl: 'urn:uuid:observation', resource: { resourceType: 'Observation', subject: { reference: 'urn:uuid:patient' }, performer: [{ reference: 'urn:uuid:practitioner' }] } },
        { fullUrl: 'urn:uuid:practitioner', resource: { resourceType: 'Practitioner' } },
        { fullUrl: 'urn:uuid:provenance', resource: { resourceType: 'Provenance', target: [{ reference: 'urn:uuid:composition' }] } },
      ],
    };

    it('warns in R4 for the entry that points back, not for what it links onwards or for Provenance', () => {
      const issues = validateBundleReachability(document, 'document', false, 'R4');

      expect(issues.map(issue => [issue.code, issue.path, issue.severity])).toEqual([
        ['bundle-entry-reverse-link', 'Bundle.entry[2]', 'warning'],
      ]);
      expect(issues[0].message).toContain('Only Provenance is approved to be used this way');
    });

    it('only notes it from R5 on, where the rule was relaxed', () => {
      const issues = validateBundleReachability(document, 'document', false, 'R5');

      expect(issues.map(issue => [issue.code, issue.severity])).toEqual([
        ['bundle-entry-reverse-link', 'information'],
      ]);
    });
  });
});
