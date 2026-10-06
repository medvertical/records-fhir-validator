import { describe, expect, it } from 'vitest';
import { createMemberOfFunction, createSubsumesFunction } from './fhirpath-custom-functions';
import { TerminologyOperationCache } from './terminology-operation-cache';
import { makeSubsumesCacheKey } from './terminology-subsumes-cache';
import { atoms, metadataCache, requestedVersion, sdk, valueSetUrl, versionCache, versionCanonical,
  versionEvidence, type AtomName } from './__tests__/memberof-sync-fixtures';

describe('synchronous memberOf CodeableConcept membership', () => {
  it('pins complete original CodeSystem metadata and the distinct SDK-default reference', () => {
    expect(sdk.codeSystems.usCore.origin.sha256).toBe('df226e59ef0dba28efe2a411dcc527033f400f92dc0653cc2877ef9c271c76f1');
    expect(sdk.codeSystems.administrativeGender.origin.sha256).toBe('928e86ab4bd68d6c4d2a306f97b6c28f0ac5e5d11e1c1d5e7a72b96fa5cc3b7f');
    expect(sdk.codeSystems.usCore.metadata.content).toBe('complete');
    expect(sdk.codeSystems.administrativeGender.metadata.content).toBe('complete');
    expect(sdk.oracle.membershipOnly).toBe(false);
    expect(sdk.oracle.sha256).toBe('3b1c7de6528a229942490bf7983cde1c574ba92f9a5c4d798e326f0043d7df19');
    expect(sdk.oracle.controls.map(control => control.result)).toEqual([true, false, true, true, false]);
    expect(sdk.codeSystems.administrativeGender.metadata.concept.map(concept => concept.code)).toContain('male');
    expect(sdk.codeSystems.administrativeGender.metadata.concept.map(concept => concept.code)).toContain('female');
  });

  it.each<[AtomName[], boolean]>([
    [['member'], true], [['male'], false], [['male', 'member'], true], [['member', 'male'], true],
    [['male', 'female', 'member'], true], [['member', 'female', 'male'], true], [['male', 'female'], false],
  ])('decides genuine valid Coding sequence %j', async (names, expected) => {
    const fn = createMemberOfFunction(await metadataCache()).fn;
    expect(fn([{ coding: names.map(name => atoms[name]) }], valueSetUrl)).toEqual([expected]);
  });

  it.each([
    { coding: [null, atoms.member], expected: [true] },
    { coding: [atoms.member, null], expected: [true] },
    { coding: [null, atoms.male], expected: [] },
    { coding: [atoms.male, { system: atoms.member.system }], expected: [] },
    { coding: [atoms.male, atoms.member.code], expected: [] },
    { coding: [atoms.male, { coding: [atoms.member] }], expected: [] },
    { coding: [{ data: atoms.male, fhirNodeDataType: 'Coding' }, { data: atoms.member, fhirNodeDataType: 'Coding' }], expected: [true] },
    { coding: [null], expected: [] },
    { coding: [], expected: [] },
  ])('keeps unknown Coding values distinct from known nonmembers: %j', async ({ coding, expected }) => {
    expect(createMemberOfFunction(await metadataCache()).fn([{ coding }], valueSetUrl)).toEqual(expected);
  });

  it('preserves primitive, supplied-system Coding and wrapper behavior', async () => {
    const fn = createMemberOfFunction(await metadataCache()).fn;
    expect(fn([atoms.member.code], valueSetUrl)).toEqual([true]);
    expect(fn([atoms.member], valueSetUrl)).toEqual([true]);
    expect(fn([{ system: atoms.male.system, code: atoms.member.code }], valueSetUrl)).toEqual([false]);
    expect(fn([{ data: { coding: [atoms.male, atoms.member] }, fhirNodeDataType: 'CodeableConcept' }], valueSetUrl)).toEqual([true]);
  });

  it('keeps cold Coding.version input unverified without claiming version attestation', async () => {
    expect(createMemberOfFunction(await metadataCache(false)).fn([
      { ...atoms.member, version: 'unattested-version' },
    ], valueSetUrl)).toEqual([]);
  });

  it('does not combine separate FHIRPath input nodes as a CodeableConcept', async () => {
    const fn = createMemberOfFunction(await metadataCache()).fn;
    expect(fn([], valueSetUrl)).toEqual([]);
    expect(fn([atoms.member, atoms.male], valueSetUrl)).toEqual([]);
    expect(fn([{ coding: [atoms.member] }, { coding: [atoms.male] }], valueSetUrl)).toEqual([]);
  });

  it('checks all ISO Coding candidates while retaining supplied-system identity', async () => {
    const fn = createMemberOfFunction(await metadataCache()).fn;
    const iso = { system: 'urn:iso:std:iso:3166', code: 'DE' };
    const url = 'http://hl7.org/fhir/ValueSet/iso3166-1-2';
    expect(fn([{ coding: [atoms.male, iso] }], url)).toEqual([true]);
    expect(fn([{ coding: [iso, atoms.male] }], url)).toEqual([true]);
    expect(fn([{ coding: [atoms.male, null] }], url)).toEqual([]);
    expect(fn([{ system: atoms.male.system, code: 'DE' }], url)).toEqual([false]);
  });
});

describe('explicit ValueSet business-version cache selection', () => {
  it.each(versionEvidence)('$name', evidence => {
    const requested = evidence.unversioned ? versionCanonical : requestedVersion;
    const expected = evidence.partial && evidence.exact === 'male' ? [false]
      : evidence.expected === 'unverified' ? [] : [evidence.expected === 'valid'];
    expect(createMemberOfFunction(versionCache(evidence)).fn([atoms.member], requested)).toEqual(expected);
  });
});

describe('subsumes dispatch remains independent of the memberOf refactor', () => {
  it('retains the existing first CodeableConcept pair contract without claiming full subsumes parity', () => {
    const system = 'http://snomed.info/sct';
    const cache = new TerminologyOperationCache();
    cache.storeSubsumes(makeSubsumesCacheKey('https://tx.example', system, 'first', 'target'), 'not-subsumed');
    cache.storeSubsumes(makeSubsumesCacheKey('https://tx.example', system, 'second', 'target'), 'subsumes');
    expect(createSubsumesFunction(cache).fn([{ coding: [
      { system, code: 'first' }, { system, code: 'second' },
    ] }], [{ system, code: 'target' }])).toEqual([false]);
  });
});
