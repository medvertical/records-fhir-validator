import { describe, expect, it } from 'vitest';
import {
  buildSnapshotIndex,
  detectUnknownProperties,
  makeWalkerDeps,
} from '../unknown-property-walker';

describe('unknown-property-walker', () => {
  // Hand-crafted snapshot fragment — covers the BackboneElement, choice-type
  // and Resource cases the walker special-cases without requiring the full
  // FHIR core SDs at test time.
  const sd = {
    url: 'http://example.org/test-sd',
    snapshot: {
      element: [
        { path: 'TestRes' },
        { path: 'TestRes.id', type: [{ code: 'string' }] },
        { path: 'TestRes.name', type: [{ code: 'HumanName' }] },
        { path: 'TestRes.contact', type: [{ code: 'BackboneElement' }] },
        { path: 'TestRes.contact.id' },
        { path: 'TestRes.contact.relationship', type: [{ code: 'CodeableConcept' }] },
        { path: 'TestRes.contact.name', type: [{ code: 'HumanName' }] },
        { path: 'TestRes.contact.telecom', type: [{ code: 'ContactPoint' }] },
        { path: 'TestRes.contact.gender', type: [{ code: 'code' }] },
        { path: 'TestRes.value[x]', type: [{ code: 'Quantity' }, { code: 'string' }] },
        { path: 'TestRes.entry', type: [{ code: 'BackboneElement' }] },
        { path: 'TestRes.entry.resource', type: [{ code: 'Resource' }] },
      ],
    },
  } as any;

  const index = buildSnapshotIndex(sd);

  it('does not flag valid top-level resource keys', async () => {
    const issues = await detectUnknownProperties(
      { resourceType: 'TestRes', id: 'a', name: { family: 'Doe' } },
      index, 'TestRes', sd.url,
    );
    expect(issues).toHaveLength(0);
  });

  it('does not flag standard keys when a downloaded profile contains only a stub root element', async () => {
    const stubIndex = buildSnapshotIndex({
      url: 'http://example.org/stub-profile',
      snapshot: { element: [{ path: 'Consent' }] },
    } as any);

    const issues = await detectUnknownProperties(
      {
        resourceType: 'Consent',
        status: 'active',
        scope: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'adr' }] },
        patient: { reference: 'Patient/example' },
      },
      stubIndex,
      'Consent',
      'http://example.org/stub-profile',
    );

    expect(issues).toHaveLength(0);
  });

  it('flags unknown top-level keys as error severity', async () => {
    const issues = await detectUnknownProperties(
      { resourceType: 'TestRes', namee: { family: 'Doe' } },
      index, 'TestRes', sd.url,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('structural-unknown-element');
    expect(issues[0].path).toBe('TestRes.namee');
    expect(issues[0].severity).toBe('error');
  });

  it('flags nested unknown keys inside BackboneElements as warning', async () => {
    const issues = await detectUnknownProperties(
      {
        resourceType: 'TestRes',
        contact: [
          { relationship: { text: 'spouse' }, relationshp: { text: 'typo' } },
        ],
      },
      index, 'TestRes', sd.url,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('TestRes.contact.relationshp');
    expect(issues[0].severity).toBe('warning');
  });

  it('does not flag valid BackboneElement nested keys', async () => {
    const issues = await detectUnknownProperties(
      {
        resourceType: 'TestRes',
        contact: [
          { relationship: { text: 'spouse' }, name: { family: 'Doe' }, gender: 'female' },
        ],
      },
      index, 'TestRes', sd.url,
    );
    expect(issues).toHaveLength(0);
  });

  it('treats complex datatype children as opaque when no walker deps are provided', async () => {
    const issues = await detectUnknownProperties(
      {
        resourceType: 'TestRes',
        name: { family: 'Doe', faimly: 'typo-not-flagged' },
      },
      index, 'TestRes', sd.url,
    );
    expect(issues).toHaveLength(0);
  });

  it('descends into complex datatypes via the SDLoader and flags typos there', async () => {
    const humanNameSd = {
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/StructureDefinition/HumanName',
      snapshot: {
        element: [
          { path: 'HumanName' },
          { path: 'HumanName.family', type: [{ code: 'string' }] },
          { path: 'HumanName.given', type: [{ code: 'string' }] },
        ],
      },
    };
    const sdLoader = {
      loadProfile: async (url: string) =>
        url === 'http://hl7.org/fhir/StructureDefinition/HumanName' ? humanNameSd : null,
    } as any;
    const deps = makeWalkerDeps(sdLoader, 'R4');
    const issues = await detectUnknownProperties(
      { resourceType: 'TestRes', name: { family: 'Doe', faimly: 'typo' } },
      index, 'TestRes', sd.url, deps,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('HumanName.faimly');
    expect(issues[0].severity).toBe('warning');
  });

  it('caches type indices so multiple uses of HumanName cost one SD load', async () => {
    let loadCount = 0;
    const humanNameSd = {
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/StructureDefinition/HumanName',
      snapshot: {
        element: [
          { path: 'HumanName' },
          { path: 'HumanName.family', type: [{ code: 'string' }] },
        ],
      },
    };
    const sdLoader = {
      loadProfile: async (url: string) => {
        if (url === 'http://hl7.org/fhir/StructureDefinition/HumanName') {
          loadCount++;
          return humanNameSd;
        }
        return null;
      },
    } as any;
    const deps = makeWalkerDeps(sdLoader, 'R4');
    await detectUnknownProperties(
      { resourceType: 'TestRes', name: { family: 'A' }, contact: [{ name: { family: 'B' } }] },
      index, 'TestRes', sd.url, deps,
    );
    expect(loadCount).toBe(1);
  });

  it('expands choice-type properties (value[x] -> valueString / valueQuantity)', async () => {
    expect(await detectUnknownProperties(
      { resourceType: 'TestRes', valueString: 'hello' }, index, 'TestRes', sd.url,
    )).toHaveLength(0);
    expect(await detectUnknownProperties(
      { resourceType: 'TestRes', valueQuantity: { value: 1 } }, index, 'TestRes', sd.url,
    )).toHaveLength(0);
    expect(await detectUnknownProperties(
      { resourceType: 'TestRes', valueBogus: 'x' }, index, 'TestRes', sd.url,
    )).toHaveLength(1);
  });

  it('skips primitive-extension sidecar keys (underscore prefix)', async () => {
    const issues = await detectUnknownProperties(
      { resourceType: 'TestRes', id: 'a', _id: { extension: [] } },
      index, 'TestRes', sd.url,
    );
    expect(issues).toHaveLength(0);
  });

  it('skips Resource-typed nested children (does not recurse into entry.resource)', async () => {
    const issues = await detectUnknownProperties(
      {
        resourceType: 'TestRes',
        entry: [
          { resource: { resourceType: 'Patient', bogus: 'not-flagged-here' } },
        ],
      },
      index, 'TestRes', sd.url,
    );
    expect(issues).toHaveLength(0);
  });

  it('skips contained (validated separately by engine recursion)', async () => {
    const issues = await detectUnknownProperties(
      {
        resourceType: 'TestRes',
        contained: [{ resourceType: 'Patient', bogus: 'not-flagged-here' }],
      },
      index, 'TestRes', sd.url,
    );
    expect(issues).toHaveLength(0);
  });
});
