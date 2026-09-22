import { describe, expect, it, vi } from 'vitest';
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

  it('does not flag base resource keys when a profile snapshot is sparse', async () => {
    const sparsePatientIndex = buildSnapshotIndex({
      url: 'http://nictiz.nl/fhir/StructureDefinition/nl-core-Patient',
      snapshot: {
        element: [
          { path: 'Patient' },
          { path: 'Patient.extension', type: [{ code: 'Extension' }] },
        ],
      },
    } as any);

    const issues = await detectUnknownProperties(
      {
        resourceType: 'Patient',
        identifier: [{ system: 'http://fhir.nl/fhir/NamingSystem/bsn', value: '999911120' }],
        name: [{ family: 'Pietersen' }],
        telecom: [{ system: 'phone', value: '+31611234567' }],
        gender: 'female',
        birthDate: '1998-12-03',
        deceasedBoolean: false,
        multipleBirthBoolean: false,
      },
      sparsePatientIndex,
      'Patient',
      'http://nictiz.nl/fhir/StructureDefinition/nl-core-Patient',
    );

    expect(issues).toHaveLength(0);
  });

  it('uses the base resource snapshot when a profile snapshot omits inherited top-level elements', async () => {
    const sparseObservationIndex = buildSnapshotIndex({
      url: 'https://example.org/fhir/StructureDefinition/sparse-observation-profile',
      snapshot: {
        element: [
          { path: 'Observation' },
          { path: 'Observation.method', type: [{ code: 'CodeableConcept' }] },
          { path: 'Observation.value[x]', type: [{ code: 'Quantity' }] },
        ],
      },
    } as any);
    const sdLoader = {
      loadProfile: async (url: string) => {
        if (url !== 'http://hl7.org/fhir/StructureDefinition/Observation') {
          throw new Error(`Unexpected profile load: ${url}`);
        }
        return {
          url,
          snapshot: {
            element: [
              { path: 'Observation' },
              { path: 'Observation.status', type: [{ code: 'code' }] },
              { path: 'Observation.category', type: [{ code: 'CodeableConcept' }] },
              { path: 'Observation.code', type: [{ code: 'CodeableConcept' }] },
              { path: 'Observation.subject', type: [{ code: 'Reference' }] },
              { path: 'Observation.effective[x]', type: [{ code: 'Period' }] },
              { path: 'Observation.value[x]', type: [{ code: 'Quantity' }] },
            ],
          },
        };
      },
    } as any;

    const issues = await detectUnknownProperties(
      {
        resourceType: 'Observation',
        status: 'final',
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }],
        code: { coding: [{ system: 'http://loinc.org', code: '8310-5' }] },
        subject: { reference: 'Patient/example' },
        effectivePeriod: { start: '2026-07-03T07:30:00Z' },
        method: { text: 'oral' },
        valueQuantity: { value: 37, system: 'http://unitsofmeasure.org', code: 'Cel' },
        statuz: 'typo',
      },
      sparseObservationIndex,
      'Observation',
      'https://example.org/fhir/StructureDefinition/sparse-observation-profile',
      makeWalkerDeps(sdLoader),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'structural-unknown-element',
      path: 'Observation.statuz',
      severity: 'error',
    });
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

  it('flags unknown fields inside primitive extension sidecars', async () => {
    const issues = await detectUnknownProperties(
      {
        resourceType: 'TestRes',
        id: 'a',
        _id: { fhir_comments: ['not a legal Element property'] },
      },
      index, 'TestRes', sd.url,
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'structural-unknown-element',
      path: 'TestRes.id',
      severity: 'error',
    });
  });

  it('accepts id and extension in primitive extension sidecars', async () => {
    const issues = await detectUnknownProperties(
      {
        resourceType: 'TestRes',
        id: 'a',
        _id: {
          id: 'primitive-element-id',
          extension: [{ url: 'http://example.org/ext', valueString: 'ok' }],
        },
      },
      index, 'TestRes', sd.url,
    );

    expect(issues).toHaveLength(0);
  });

  it('leaves malformed orphan sidecars to the canonical structural sanity diagnostic', async () => {
    const issues = await detectUnknownProperties(
      {
        resourceType: 'TestRes',
        _valueString: { value: 'not a legal primitive sidecar field' },
      },
      index, 'TestRes', sd.url,
    );

    expect(issues).toHaveLength(0);
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
      { resourceType: 'TestRes', name: { family: 'Doe', faimly: 'typo' }, contact: [{ name: { faimly: 'nested typo' } }] },
      index, 'TestRes', sd.url, deps,
    );
    expect(issues.map(issue => issue.path)).toEqual(['TestRes.name.faimly', 'TestRes.contact.name.faimly']);
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

  it('retries unresolved datatype profiles after packages become available', async () => {
    let available = false;
    const sdLoader = {
      loadProfile: vi.fn(async () => available ? {
        snapshot: {
          element: [
            { path: 'HumanName' },
            { path: 'HumanName.family', type: [{ code: 'string' }] },
          ],
        },
      } : null),
    } as any;
    const deps = makeWalkerDeps(sdLoader, 'R4');
    const resource = { resourceType: 'TestRes', name: { faimly: 'typo' } };

    expect(await detectUnknownProperties(resource, index, 'TestRes', sd.url, deps))
      .toHaveLength(0);
    available = true;
    expect(await detectUnknownProperties(resource, index, 'TestRes', sd.url, deps))
      .toContainEqual(expect.objectContaining({ path: 'TestRes.name.faimly' }));
    expect(sdLoader.loadProfile).toHaveBeenCalledTimes(2);
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

  it('expands complex choice-type properties such as definitionDataRequirement', async () => {
    const evidenceVariableIndex = buildSnapshotIndex({
      url: 'http://hl7.org/fhir/StructureDefinition/EvidenceVariable',
      snapshot: {
        element: [
          { path: 'EvidenceVariable' },
          { path: 'EvidenceVariable.characteristic', type: [{ code: 'BackboneElement' }] },
          {
            path: 'EvidenceVariable.characteristic.definition[x]',
            type: [{ code: 'DataRequirement' }, { code: 'Reference' }, { code: 'CodeableConcept' }],
          },
        ],
      },
    } as any);

    expect(await detectUnknownProperties(
      {
        resourceType: 'EvidenceVariable',
        characteristic: [{ definitionDataRequirement: { type: 'Coding' } }],
      },
      evidenceVariableIndex,
      'EvidenceVariable',
      'http://hl7.org/fhir/StructureDefinition/EvidenceVariable',
    )).toHaveLength(0);

    const issues = await detectUnknownProperties(
      {
        resourceType: 'EvidenceVariable',
        characteristic: [{ definitionBogus: { type: 'Coding' } }],
      },
      evidenceVariableIndex,
      'EvidenceVariable',
      'http://hl7.org/fhir/StructureDefinition/EvidenceVariable',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'structural-unknown-element',
      path: 'EvidenceVariable.characteristic.definitionBogus',
      severity: 'warning',
    });
  });

  it('does not load primitive choice suffixes as datatype StructureDefinitions', async () => {
    const planDefinitionIndex = buildSnapshotIndex({
      url: 'http://hl7.org/fhir/StructureDefinition/PlanDefinition',
      snapshot: {
        element: [
          { path: 'PlanDefinition' },
          { path: 'PlanDefinition.action', type: [{ code: 'BackboneElement' }] },
          {
            path: 'PlanDefinition.action.definition[x]',
            type: [{ code: 'canonical' }, { code: 'uri' }],
          },
        ],
      },
    } as any);
    const sdLoader = {
      loadProfile: vi.fn(async () => null),
    } as any;

    const issues = await detectUnknownProperties(
      {
        resourceType: 'PlanDefinition',
        action: [{ definitionCanonical: 'ActivityDefinition/example' }],
      },
      planDefinitionIndex,
      'PlanDefinition',
      'http://hl7.org/fhir/StructureDefinition/PlanDefinition',
      makeWalkerDeps(sdLoader, 'R4'),
    );

    expect(issues).toHaveLength(0);
    expect(sdLoader.loadProfile).not.toHaveBeenCalled();
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

  it('does not let sliced resource children override Resource-typed Bundle.entry.resource', async () => {
    const bundleIndex = buildSnapshotIndex({
      url: 'http://example.org/StructureDefinition/bundle-eu-eps',
      snapshot: {
        element: [
          { id: 'Bundle', path: 'Bundle' },
          { id: 'Bundle.entry', path: 'Bundle.entry', type: [{ code: 'BackboneElement' }] },
          { id: 'Bundle.entry.fullUrl', path: 'Bundle.entry.fullUrl', type: [{ code: 'uri' }] },
          { id: 'Bundle.entry.resource', path: 'Bundle.entry.resource', type: [{ code: 'Resource' }] },
          { id: 'Bundle.entry:composition', path: 'Bundle.entry', sliceName: 'composition' },
          {
            id: 'Bundle.entry:composition.resource',
            path: 'Bundle.entry.resource',
            type: [{ code: 'Composition' }],
          },
          { id: 'Bundle.entry:patient', path: 'Bundle.entry', sliceName: 'patient' },
          {
            id: 'Bundle.entry:patient.resource',
            path: 'Bundle.entry.resource',
            type: [{ code: 'Patient' }],
          },
        ],
      },
    } as any);

    const issues = await detectUnknownProperties(
      {
        resourceType: 'Bundle',
        entry: [
          {
            fullUrl: 'urn:uuid:c1',
            resource: {
              resourceType: 'Composition',
              id: 'c1',
              status: 'final',
              title: 'European Patient Summary',
            },
          },
        ],
      },
      bundleIndex,
      'Bundle',
      'http://example.org/StructureDefinition/bundle-eu-eps',
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

  it('terminates when an in-memory repeating element contains a cycle', async () => {
    const contact: unknown[] = [];
    contact.push(contact);

    await expect(detectUnknownProperties(
      { resourceType: 'TestRes', contact },
      index,
      'TestRes',
      sd.url,
    )).resolves.toEqual([]);
  });
});
