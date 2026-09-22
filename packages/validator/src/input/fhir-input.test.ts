import { describe, expect, it } from 'vitest';
import { getValueAtPath } from '../core/validation-utils';
import { TypeValidator } from '../validators/type-validator';
import { parseFhirNdjson } from './fhir-ndjson-input';
import { parseFhirXml } from './fhir-xml-input';

describe('secure FHIR XML input adapter', () => {
  it('normalizes primitives, primitive extensions, arrays, contained resources, and XHTML', () => {
    const parsed = parseFhirXml(`<?xml version="1.0"?>
<Patient xmlns="http://hl7.org/fhir">
  <id value="patient-1"/>
  <active value="true"/>
  <name>
    <family value="Muster"/>
    <given value="Ada"/>
    <given value="Lovelace"/>
  </name>
  <birthDate value="1815-12-10">
    <extension url="http://hl7.org/fhir/StructureDefinition/patient-birthTime">
      <valueDateTime value="1815-12-10T12:00:00Z"/>
    </extension>
  </birthDate>
  <text>
    <status value="generated"/>
    <div xmlns="http://www.w3.org/1999/xhtml"><p>Ada <b>safe</b> &amp; cared for</p></div>
  </text>
  <contained>
    <Organization>
      <id value="org-1"/>
      <name value="Analytical Engine"/>
    </Organization>
  </contained>
</Patient>`);

    expect(parsed.format).toBe('xml');
    expect(parsed.resources[0]).toMatchObject({
      resourceType: 'Patient',
      id: 'patient-1',
      active: true,
      name: [{
        family: 'Muster',
        given: ['Ada', 'Lovelace'],
      }],
      birthDate: '1815-12-10',
      _birthDate: {
        extension: [{
          url: 'http://hl7.org/fhir/StructureDefinition/patient-birthTime',
          valueDateTime: '1815-12-10T12:00:00Z',
        }],
      },
      contained: [{
        resourceType: 'Organization',
        id: 'org-1',
        name: 'Analytical Engine',
      }],
    });
    expect((parsed.resources[0].text as { div: string }).div)
      .toContain(
        '<div xmlns="http://www.w3.org/1999/xhtml"><p>Ada <b>safe</b> &amp; cared for</p></div>',
      );
    expect(parsed.sourceMap['Patient.birthDate']).toEqual(expect.objectContaining({
      line: expect.any(Number),
      column: expect.any(Number),
    }));
  });

  it('normalizes Bundle entry resource wrappers', () => {
    const parsed = parseFhirXml(`<Bundle xmlns="http://hl7.org/fhir">
  <type value="collection"/>
  <entry>
    <fullUrl value="urn:uuid:patient-1"/>
    <resource><Patient><id value="patient-1"/></Patient></resource>
  </entry>
</Bundle>`);
    expect(parsed.resources[0]).toMatchObject({
      resourceType: 'Bundle',
      type: 'collection',
      entry: [{
        fullUrl: 'urn:uuid:patient-1',
        resource: { resourceType: 'Patient', id: 'patient-1' },
      }],
    });
  });

  it('aligns primitive-extension sidecars in repeating primitive arrays', () => {
    const parsed = parseFhirXml(`<Patient xmlns="http://hl7.org/fhir">
  <name>
    <given value="Ada"/>
    <given value="Lovelace">
      <extension url="https://example.test/fhir/StructureDefinition/demo">
        <valueString value="preferred"/>
      </extension>
    </given>
  </name>
</Patient>`);

    expect(parsed.resources[0]).toMatchObject({
      name: [{
        given: ['Ada', 'Lovelace'],
        _given: [
          null,
          {
            extension: [{
              url: 'https://example.test/fhir/StructureDefinition/demo',
              valueString: 'preferred',
            }],
          },
        ],
      }],
    });
  });

  it('maps missing primitive choice values to JSON sidecars', () => {
    const parsed = parseFhirXml(`<Parameters xmlns="http://hl7.org/fhir">
  <parameter>
    <name value="missing"/>
    <valueBoolean>
      <extension url="http://hl7.org/fhir/StructureDefinition/data-absent-reason">
        <valueCode value="unknown"/>
      </extension>
    </valueBoolean>
  </parameter>
</Parameters>`);

    const expectedSidecar = {
      extension: [{
        url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
        valueCode: 'unknown',
      }],
    };

    expect(parsed.resources[0]).toEqual({
      resourceType: 'Parameters',
      parameter: [{
        name: 'missing',
        _valueBoolean: expectedSidecar,
      }],
    });
    const parameter = (parsed.resources[0].parameter as Array<Record<string, unknown>>)[0];
    expect(parameter).not.toHaveProperty('valueBoolean');
    expect(getValueAtPath(parameter, 'value[x]')).toEqual(expectedSidecar);
  });

  it('normalizes exponent-form XML decimals as numbers', () => {
    const parsed = parseFhirXml(`<Parameters xmlns="http://hl7.org/fhir">
  <parameter><name value="decimal"/><valueDecimal value="1.0e-1"/></parameter>
</Parameters>`);

    expect(parsed.resources[0]).toMatchObject({
      parameter: [{ valueDecimal: 0.1 }],
    });
  });

  it('preserves exponent-form XML integers so structural validation rejects them', async () => {
    const parsed = parseFhirXml(`<Parameters xmlns="http://hl7.org/fhir">
  <parameter><name value="integer"/><valueInteger value="1e2"/></parameter>
</Parameters>`);
    const parameter = (parsed.resources[0].parameter as Array<Record<string, unknown>>)[0];

    expect(parameter.valueInteger).toBe('1e2');
    await expect(new TypeValidator().validate(
      parameter.valueInteger,
      [{ code: 'integer' }],
      'Parameters.parameter[0].valueInteger',
    )).resolves.toContainEqual(expect.objectContaining({
      code: 'structural-primitive-type-mismatch',
      path: 'Parameters.parameter[0].valueInteger',
    }));
  });

  it('preserves leading-plus numeric primitives so structural validation rejects them', async () => {
    const parsed = parseFhirXml(`<Parameters xmlns="http://hl7.org/fhir">
  <parameter><name value="integer"/><valueInteger value="+1"/></parameter>
  <parameter><name value="decimal"/><valueDecimal value="+1.0"/></parameter>
</Parameters>`);
    const parameters = parsed.resources[0].parameter as Array<Record<string, unknown>>;

    for (const [index, property, type] of [
      [0, 'valueInteger', 'integer'],
      [1, 'valueDecimal', 'decimal'],
    ] as const) {
      expect(parameters[index]?.[property]).toMatch(/^\+/);
      await expect(new TypeValidator().validate(
        parameters[index]?.[property],
        [{ code: type }],
        `Parameters.parameter[${index}].${property}`,
      )).resolves.toContainEqual(expect.objectContaining({
        code: 'structural-primitive-type-mismatch',
        path: `Parameters.parameter[${index}].${property}`,
      }));
    }
  });

  it('preserves empty primitive choices as invalid values without empty sidecars', async () => {
    const parsed = parseFhirXml(`<Parameters xmlns="http://hl7.org/fhir">
  <parameter><name value="empty"/><valueBoolean/></parameter>
</Parameters>`);
    const parameter = (parsed.resources[0].parameter as Array<Record<string, unknown>>)[0];

    expect(parameter).toEqual({ name: 'empty', valueBoolean: {} });
    expect(parameter).not.toHaveProperty('_valueBoolean');
    await expect(new TypeValidator().validate(
      parameter.valueBoolean,
      [{ code: 'boolean' }],
      'Parameters.parameter[0].valueBoolean',
    )).resolves.toContainEqual(expect.objectContaining({
      code: 'structural-primitive-type-mismatch',
      path: 'Parameters.parameter[0].valueBoolean',
    }));
  });

  it('keeps singleton StructureDefinition collections as arrays', () => {
    const parsed = parseFhirXml(`<StructureDefinition xmlns="http://hl7.org/fhir">
  <url value="https://example.test/StructureDefinition/example"/>
  <snapshot><element><path value="Patient"/><constraint><key value="one"/></constraint></element></snapshot>
</StructureDefinition>`);

    expect(parsed.resources[0]).toMatchObject({
      snapshot: {
        element: [{ constraint: [{ key: 'one' }] }],
      },
    });
  });

  it('preserves integer64 values without JavaScript number precision loss', () => {
    const parsed = parseFhirXml(`<TestResource xmlns="http://hl7.org/fhir">
  <valueInteger64 value="9007199254740993"/>
</TestResource>`);

    expect(parsed.resources[0].valueInteger64).toBe('9007199254740993');
  });

  it('rejects non-string runtime input with a stable boundary error', () => {
    expect(() => parseFhirXml(null as unknown as string)).toThrow('must be a string');
  });

  it('rejects DTD/entity input, foreign namespaces, depth bombs, and oversized input', () => {
    expect(() => parseFhirXml(
      '<!DOCTYPE Patient [<!ENTITY x SYSTEM "file:///etc/passwd">]><Patient xmlns="http://hl7.org/fhir"/>',
    )).toThrow('DTD and entity');
    expect(() => parseFhirXml('<Patient xmlns="urn:not-fhir"/>')).toThrow('unsupported namespace');
    expect(() => parseFhirXml(
      '<Patient xmlns="http://hl7.org/fhir"><x:constructor xmlns:x="urn:evil"/></Patient>',
    )).toThrow('unsupported namespace');
    expect(() => parseFhirXml(
      '<Patient xmlns="http://hl7.org/fhir" xmlns:x="urn:evil"><id x:value="forged"/></Patient>',
    )).toThrow('unsupported attribute namespace');
    expect(() => parseFhirXml(
      '<Patient xmlns="http://hl7.org/fhir"><contact><name/></contact></Patient>',
      { maxDepth: 2 },
    )).toThrow('depth limit');
    expect(() => parseFhirXml('<Patient xmlns="http://hl7.org/fhir"/>', { maxBytes: 4 }))
      .toThrow('byte limit');
  });
});

describe('bounded FHIR NDJSON input adapter', () => {
  it('parses one resource per line and records line locations', () => {
    const parsed = parseFhirNdjson([
      '{"resourceType":"Patient","id":"p1"}',
      '{"resourceType":"Observation","id":"o1"}',
      '',
    ].join('\n'));
    expect(parsed.resources).toHaveLength(2);
    expect(parsed.sourceMap).toEqual({
      'resources[0]': { line: 1, column: 1 },
      'resources[1]': { line: 2, column: 1 },
    });
  });

  it('rejects blank records, missing resourceType, record bombs, and long lines', () => {
    expect(() => parseFhirNdjson(
      '{"resourceType":"Patient"}\n\n{"resourceType":"Observation"}',
    )).toThrow('line 2 is empty');
    expect(() => parseFhirNdjson('{"id":"p1"}')).toThrow('missing resourceType');
    expect(() => parseFhirNdjson(
      '{"resourceType":"Patient"}\n{"resourceType":"Observation"}',
      { maxRecords: 1 },
    )).toThrow('record limit');
    expect(() => parseFhirNdjson('{"resourceType":"Patient"}', { maxLineBytes: 4 }))
      .toThrow('line 1 exceeded byte limit');
  });
});

describe('schema-driven XML conversion', () => {
  it('types primitives from the definitions, not the element name', () => {
    const parsed = parseFhirXml(`<Observation xmlns="http://hl7.org/fhir">
      <valueQuantity><value value="185.5"/><unit value="cm"/></valueQuantity>
    </Observation>`);
    const resource = parsed.resources[0] as Record<string, any>;
    // Quantity.value is a decimal, but the XML element is only called "value"
    // and its parent is spelled valueQuantity — no name heuristic reaches it.
    expect(resource.valueQuantity.value).toBe(185.5);
    expect(resource.valueQuantity.unit).toBe('cm');
  });

  it('arrays single-occurrence repeating elements', () => {
    const parsed = parseFhirXml(`<StructureDefinition xmlns="http://hl7.org/fhir">
      <differential><element id="Address.country"><min value="1"/></element></differential>
    </StructureDefinition>`);
    const resource = parsed.resources[0] as Record<string, any>;
    expect(Array.isArray(resource.differential.element)).toBe(true);
    expect(resource.differential.element[0].min).toBe(1);
  });

  it('honours the release, which R4 and R5 disagree about', () => {
    const xml = `<Appointment xmlns="http://hl7.org/fhir">
      <participant><required value="true"/></participant>
    </Appointment>`;
    // Appointment.participant.required is a code in R4 and a boolean in R5.
    const r4 = parseFhirXml(xml, {}, { fhirVersion: 'R4' }).resources[0] as Record<string, any>;
    const r5 = parseFhirXml(xml, {}, { fhirVersion: 'R5' }).resources[0] as Record<string, any>;
    expect(r4.participant[0].required).toBe('true');
    expect(r5.participant[0].required).toBe(true);
  });

  it('converts decimals written with an exponent', () => {
    // FHIR decimal admits an exponent. Without it these stayed strings and the
    // validator reported a mismatch against the element's own decimal type.
    const parsed = parseFhirXml(`<Parameters xmlns="http://hl7.org/fhir">
      <parameter><name value="a"/><valueDecimal value="1e1"/></parameter>
      <parameter><name value="b"/><valueDecimal value="1.0e-1"/></parameter>
      <parameter><name value="c"/><valueInteger value="1e1"/></parameter>
    </Parameters>`);
    const resource = parsed.resources[0] as Record<string, any>;
    expect(resource.parameter[0].valueDecimal).toBe(10);
    expect(resource.parameter[1].valueDecimal).toBe(0.1);
    // integer does not admit an exponent, so this stays as written
    expect(resource.parameter[2].valueInteger).toBe('1e1');
  });

  it('gives R4B its own definitions rather than reusing R4', () => {
    // EvidenceVariable.characteristic.timeFromStart is a Duration in R4, so
    // its `value` is a decimal, and a BackboneElement in R4B, where it is not.
    // Reusing the R4 table for R4B was wrong for every element the two
    // releases do not share.
    const xml = `<EvidenceVariable xmlns="http://hl7.org/fhir">
      <characteristic><timeFromStart><value value="5"/></timeFromStart></characteristic>
    </EvidenceVariable>`;
    const r4 = parseFhirXml(xml, {}, { fhirVersion: 'R4' }).resources[0] as Record<string, any>;
    const r4b = parseFhirXml(xml, {}, { fhirVersion: 'R4B' }).resources[0] as Record<string, any>;
    expect(r4.characteristic[0].timeFromStart.value).toBe(5);
    expect(r4b.characteristic[0].timeFromStart.value).toBe('5');
  });

  it('falls back to heuristics for types the definitions do not describe', () => {
    const parsed = parseFhirXml(`<NotAFhirResource xmlns="http://hl7.org/fhir">
      <active value="true"/><extension url="http://example.org/x"/>
    </NotAFhirResource>`);
    const resource = parsed.resources[0] as Record<string, any>;
    expect(resource.active).toBe(true);
    expect(Array.isArray(resource.extension)).toBe(true);
  });
});

describe('XML serialisation diagnostics', () => {
  it('reports text where the element allows none', () => {
    // The text is dropped by the conversion, so an object-based validator
    // cannot see it afterwards — the adapter has to report it while parsing.
    const parsed = parseFhirXml(`<List xmlns="http://hl7.org/fhir">
      <id value="val1">some text</id>
    </List>`);
    expect(parsed.diagnostics).toEqual([
      expect.objectContaining({
        code: 'xml-text-not-allowed',
        message: "Text should not be present ('some text')",
      }),
    ]);
  });

  it('reports an attribute FHIR XML does not define', () => {
    const parsed = parseFhirXml(`<List xmlns="http://hl7.org/fhir">
      <id value="val1" other="x"/>
    </List>`);
    expect(parsed.diagnostics?.[0]).toMatchObject({ code: 'xml-attribute-undefined' });
    expect(parsed.diagnostics?.[0].message).toContain("'@other'");
  });

  it('reports an attribute written with an empty value', () => {
    // `url=""` is dropped by the conversion, after which it is
    // indistinguishable from an attribute that was never written.
    const parsed = parseFhirXml(`<Patient xmlns="http://hl7.org/fhir">
      <extension url=""><valueString value="x"/></extension>
    </Patient>`);
    expect(parsed.diagnostics?.[0]).toMatchObject({
      code: 'xml-attribute-empty',
      message: 'value cannot be empty',
    });
  });

  it('stays silent on a well-formed resource', () => {
    const parsed = parseFhirXml(`<List xmlns="http://hl7.org/fhir">
      <id value="val1"/><status value="current"/>
    </List>`);
    expect(parsed.diagnostics).toBeUndefined();
  });

  it('leaves a mis-namespaced narrative to the namespace check', () => {
    // The div is missing the XHTML namespace, so it is walked as FHIR. Its
    // markup must not be reported element by element as stray text; the
    // namespace is the defect.
    const parsed = parseFhirXml(`<List xmlns="http://hl7.org/fhir">
      <text><status value="generated"/><div><p>narrative</p></div></text>
    </List>`);
    expect(parsed.diagnostics ?? []).toEqual([]);
  });
});
