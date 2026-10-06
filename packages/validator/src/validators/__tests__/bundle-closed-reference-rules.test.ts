import { describe, expect, it } from 'vitest';
import { validateBundleCrossEntryReferences } from '../bundle-cross-entry-references';

const missing = (bundle: Record<string, unknown>) => validateBundleCrossEntryReferences(bundle, String(bundle.type))
  .filter(issue => issue.code === 'bundle-cross-entry-reference-missing')
  .map(issue => [issue.severity, issue.path]);

describe('document and message reference rules', () => {
  // smart-r4 Bundle/2442505: the questionnaire response's fullUrl is no
  // RESTful URL, so its relative references resolve to nothing.
  it('fails a relative reference whose own entry has no RESTful fullUrl, though an entry has that type and id', () => {
    expect(missing({
      resourceType: 'Bundle',
      type: 'message',
      entry: [
        { fullUrl: 'urn:uuid:b23679b3-4345-40bf-866f-99c73d76e631', resource: { resourceType: 'MessageHeader', focus: [{ reference: 'ServiceRequest/1' }] } },
        { fullUrl: 'ServiceRequest/1', resource: { resourceType: 'ServiceRequest', id: '1', subject: { reference: 'Patient/1' } } },
        { fullUrl: 'Patient/1', resource: { resourceType: 'Patient', id: '1' } },
        { fullUrl: 'consent-1', resource: { resourceType: 'QuestionnaireResponse', id: 'consent-1', basedOn: [{ reference: 'ServiceRequest/1' }] } },
      ],
    })).toEqual([
      ['error', 'Bundle.entry[0].resource.focus[0]'],
      ['error', 'Bundle.entry[3].resource.basedOn[0]'],
    ]);
  });

  it('fails a relative reference from a fullUrl that names another resource', () => {
    expect(missing({
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        { fullUrl: 'http://example.org/fhir/Composition/c', resource: { resourceType: 'Composition', id: 'c', subject: { reference: 'Patient/p' } } },
        { fullUrl: 'http://example.org/fhir/Patient/p', resource: { resourceType: 'Patient', id: 'p' } },
        { fullUrl: 'http://example.org/fhir/Observation/x', resource: { resourceType: 'Observation', id: 'o', subject: { reference: 'Patient/p' } } },
      ],
    })).toEqual([['error', 'Bundle.entry[2].resource.subject']]);
  });

  it('notes a reference outside the Composition to a resource the document does not hold', () => {
    expect(missing({
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        { fullUrl: 'urn:uuid:845824ba-6a35-4bb2-9d3f-4150ae900eef', resource: { resourceType: 'Composition', subject: { reference: 'Patient/c0be00a6' } } },
        { fullUrl: 'urn:uuid:c0be00a6-3478-4b72-962a-575a430c15c0', resource: { resourceType: 'Patient' } },
        { fullUrl: 'urn:uuid:bbad968f-174b-4521-b499-991a9fd6fd2d', resource: { resourceType: 'Encounter', subject: { reference: 'Patient/c0be00a6' } } },
      ],
    })).toEqual([
      ['error', 'Bundle.entry[0].resource.subject'],
      ['information', 'Bundle.entry[2].resource.subject'],
    ]);
  });

  it('resolves a relative reference through the RESTful fullUrl of its own entry', () => {
    expect(missing({
      resourceType: 'Bundle',
      type: 'message',
      entry: [
        { fullUrl: 'http://example.org/fhir/MessageHeader/m', resource: { resourceType: 'MessageHeader', id: 'm', focus: [{ reference: 'Task/t' }] } },
        { fullUrl: 'http://example.org/fhir/Task/t', resource: { resourceType: 'Task', id: 't', for: { reference: 'Patient/p' } } },
        { fullUrl: 'http://example.org/fhir/Patient/p', resource: { resourceType: 'Patient', id: 'p' } },
      ],
    })).toEqual([]);
  });

  it.each(['document', 'collection'])('fails a urn reference two %s entries answer', (type) => {
    const shared = 'urn:uuid:9f240000-5c20-0000-0000-98a32e37edcd';
    expect(missing({
      resourceType: 'Bundle',
      type,
      entry: [
        { fullUrl: 'urn:uuid:845824ba-6a35-4bb2-9d3f-4150ae900eef', resource: { resourceType: 'Composition', encounter: { reference: shared } } },
        { fullUrl: shared, resource: { resourceType: 'Encounter' } },
        { fullUrl: shared, resource: { resourceType: 'DocumentReference' } },
      ],
    })).toEqual([['error', 'Bundle.entry[0].resource.encounter']]);
  });
});
