import { createHash } from 'node:crypto';
import { conceptFilterMembership } from '../valueset-concept-filter-membership.js';
import type { CodeSystem } from '../valueset-types.js';
import { describe, expect, it } from 'vitest';
import { assessSelectedNamedMembership, canAssertNamedCodeRejection, importedNamedCodeRejection, isImportedNamedCodeRejection, parseMixedNamedInventory,
  findImportedInventoryConcept, type ActualSelectedScope } from '../imported-terminology-inventory.js';

const prefix = 'https://records-fhir.dev/StructureDefinition/imported-terminology-';
const edition = 'http://snomed.info/sct/900000000000207008/version/20250201';
const firstCode = '22298006';
const secondCode = '386661006';
const detailCode = '271649006';
const scalar = (url: string, value: unknown, key = 'valueString') => Object.freeze({ url, [key]: value });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const scope: ActualSelectedScope = Object.freeze({ sourceScopeKey: 'explicit-metadata-fixture-source', fhirFamily: 'R4',
  selectedCanonical: 'http://snomed.info/sct', selectedBusinessVersion: edition,
  requestedCanonical: 'http://snomed.info/sct', requestedBusinessVersion: edition, defaultSelection: 'not-established' });
function concept(code: string, detailed = false) {
  return Object.freeze({ code, property: Object.freeze([Object.freeze({ code: 'inactive', valueBoolean: false })]),
    ...(detailed ? { extension: Object.freeze([Object.freeze({ url: prefix + 'label-coverage', extension: Object.freeze([
      scalar('completeSourceDescriptions', true, 'valueBoolean'), scalar('sourceDescriptionCount', 0, 'valueInteger'),
    ]) })]) } : {}) });
}
function declaration(contract = 'records.fhirsmith.terminology-projection.v2') {
  return Object.freeze({ url: prefix + 'source', extension: Object.freeze([
    scalar('contract', contract, 'valueCode'), scalar('format', 'snomed', 'valueCode'),
    scalar('displayLanguageMatch', 'base-language', 'valueCode'), scalar('sha256', 'a'.repeat(64)), scalar('businessVersion', edition),
    scalar('selection', 'all-named-codes', 'valueCode'), scalar('completeNamedCodeInventory', true, 'valueBoolean'),
    scalar('datasetNamedCodeCount', 2, 'valueInteger'), scalar('projectedNamedCodeCount', 2, 'valueInteger'),
    scalar('descriptionsCompleteForIncludedCodes', false, 'valueBoolean'), scalar('propertiesCompleteForIncludedCodes', false, 'valueBoolean'),
    scalar('relationshipsCompleteForIncludedCodes', false, 'valueBoolean'), scalar('detailSelection', 'code-list', 'valueCode'),
    scalar('detailCodeCount', 1, 'valueInteger'), scalar('detailCodesSha256', hash(JSON.stringify([detailCode]))),
    scalar('detailDescriptionsComplete', true, 'valueBoolean'), scalar('detailPropertiesComplete', false, 'valueBoolean'),
    scalar('detailRelationshipsComplete', false, 'valueBoolean'),
  ]) });
}
function resource(concepts: unknown[], extensions: unknown[] = Object.freeze([declaration()]) as unknown as unknown[]) {
  return Object.freeze({ resourceType: 'CodeSystem', url: scope.selectedCanonical, version: edition,
    content: 'fragment', count: 2, caseSensitive: true, compositional: true, concept: concepts, extension: extensions });
}
function requireNoFalseMiss(raw: unknown, code: string) {
  const parsed = parseMixedNamedInventory(raw);
  if (parsed.kind === 'unverified') {
    expect(parsed.kind).toBe('unverified');
    return;
  }
  expect(parsed.kind).toBe('named-inventory');
  if (parsed.kind !== 'named-inventory') throw new Error('A recognized V2 input must not fall through to V1');
  const membership = assessSelectedNamedMembership(parsed.definition, scope, code);
  expect(membership.kind).toBe('present');
  expect(importedNamedCodeRejection(membership, code)).toBeUndefined();
}

describe('named inventory intrinsic index data stability', () => {
  // Metadata-only mutation controls; these are not primary dataset or original clinical acceptance receipts.
  it('cannot reject a newly exposed present ID through a stale frozen concept-index getter', () => {
    let selected = concept(firstCode);
    const concepts = [selected, concept(detailCode, true)];
    Object.defineProperty(concepts, '0', { get: () => selected, enumerable: true, configurable: false });
    Object.freeze(concepts);
    const raw = resource(concepts);
    parseMixedNamedInventory(raw);
    selected = concept(secondCode);
    requireNoFalseMiss(raw, secondCode);
  });

  it('cannot reject a newly exposed present ID through a frozen own Symbol.iterator closure', () => {
    let selected = concept(firstCode);
    const detailed = concept(detailCode, true);
    const concepts = [selected, detailed];
    Object.defineProperty(concepts, Symbol.iterator, { value: function* () { yield selected; yield detailed; } });
    Object.freeze(concepts);
    const raw = resource(concepts);
    parseMixedNamedInventory(raw);
    selected = concept(secondCode);
    requireNoFalseMiss(raw, secondCode);
  });

  it('cannot retain verified authority after a frozen own source iterator exposes an unknown contract', () => {
    let selected = declaration();
    const extensions: unknown[] = [selected];
    Object.defineProperty(extensions, Symbol.iterator, { value: function* () { yield selected; } });
    Object.freeze(extensions);
    const raw = resource(Object.freeze([concept(firstCode), concept(detailCode, true)]) as unknown as unknown[], extensions);
    parseMixedNamedInventory(raw);
    selected = declaration('records.fhirsmith.terminology-projection.unknown');
    expect(parseMixedNamedInventory(raw).kind).toBe('unverified');
  });

  it('reparses changed ordinary data arrays rather than caching occurrence verdicts', () => {
    const concepts = [concept(firstCode), concept(detailCode, true)];
    const raw = resource(concepts);
    const before = parseMixedNamedInventory(raw);
    expect(before.kind).toBe('named-inventory');
    concepts[0] = concept(secondCode);
    const after = parseMixedNamedInventory(raw);
    expect(after.kind).toBe('named-inventory');
    if (after.kind !== 'named-inventory') throw new Error('Ordinary data mutation must be reinterpreted');
    const membership = assessSelectedNamedMembership(after.definition, scope, secondCode);
    expect(membership.kind).toBe('present');
    expect(importedNamedCodeRejection(membership, secondCode)).toBeUndefined();
  });

  it('retains reusable immutable data membership without turning an existing ID into a miss', () => {
    const raw = resource(Object.freeze([concept(firstCode), concept(detailCode, true)]) as unknown as unknown[]);
    const first = parseMixedNamedInventory(raw);
    const second = parseMixedNamedInventory(raw);
    expect(first.kind).toBe('named-inventory');
    expect(second.kind).toBe('named-inventory');
    requireNoFalseMiss(raw, firstCode);
  });

  it('cannot retain detail authority through a frozen own map-method closure', () => {
    let complete = true;
    const fields = [scalar('completeSourceDescriptions', true, 'valueBoolean'), scalar('sourceDescriptionCount', 0, 'valueInteger')];
    Object.defineProperty(fields, 'map', { value: () => [scalar('completeSourceDescriptions', complete, 'valueBoolean'),
      scalar('sourceDescriptionCount', 0, 'valueInteger')] });
    Object.freeze(fields);
    const detailed = Object.freeze({ code: detailCode, extension: Object.freeze([Object.freeze({ url: prefix + 'label-coverage', extension: fields })]) });
    const raw = resource(Object.freeze([concept(firstCode), detailed]) as unknown as unknown[]);
    parseMixedNamedInventory(raw);
    complete = false;
    expect(parseMixedNamedInventory(raw).kind).toBe('unverified');
  });

  it('cannot mark a present code using the real absence assessment of another code', () => {
    const raw = resource(Object.freeze([concept(firstCode), concept(detailCode, true)]) as unknown as unknown[]);
    const parsed = parseMixedNamedInventory(raw);
    if (parsed.kind !== 'named-inventory') throw new Error('Expected owned metadata definition');
    const absent = assessSelectedNamedMembership(parsed.definition, scope, '721912009');
    expect(absent.kind).toBe('absent-named-concept');
    expect(canAssertNamedCodeRejection(absent, firstCode)).toBe(false);
    expect(importedNamedCodeRejection(absent, firstCode)).toBeUndefined();
    const actual = importedNamedCodeRejection(absent, '721912009');
    expect(actual).toMatchObject({ valid: false, reason: 'code-unknown', incompleteCodeSystem: false });
    if (!actual) throw new Error('Exact same-episode named absence must still be enforceable');
    expect(isImportedNamedCodeRejection(actual, '721912009', scope.selectedCanonical, 'R4', edition)).toBe(true);
    expect(isImportedNamedCodeRejection({ ...actual }, '721912009', scope.selectedCanonical, 'R4', edition)).toBe(false);
  });

  it('cannot manufacture an opaque rejection witness from a copied public assessment', () => {
    const raw = resource(Object.freeze([concept(firstCode), concept(detailCode, true)]) as unknown as unknown[]);
    const parsed = parseMixedNamedInventory(raw);
    if (parsed.kind !== 'named-inventory') throw new Error('Expected owned metadata definition');
    const actual = assessSelectedNamedMembership(parsed.definition, scope, '721912009');
    expect(actual.kind).toBe('absent-named-concept');
    const fabricated = { ...actual };
    expect(canAssertNamedCodeRejection(fabricated, '721912009')).toBe(false);
    expect(importedNamedCodeRejection(fabricated, '721912009')).toBeUndefined();
  });

  it('binds the actual absence and returned witness to a frozen snapshot before caller scope mutation', () => {
    const raw = resource(Object.freeze([concept(firstCode), concept(detailCode, true)]) as unknown as unknown[]);
    const parsed = parseMixedNamedInventory(raw);
    if (parsed.kind !== 'named-inventory') throw new Error('Expected owned metadata definition');
    const caller = { ...scope };
    const actual = assessSelectedNamedMembership(parsed.definition, caller, '721912009');
    expect(actual.kind).toBe('absent-named-concept');
    if (actual.kind !== 'absent-named-concept') throw new Error('Expected exact scoped absence');
    const otherEdition = 'http://snomed.info/sct/999000041000000102/version/20250701';
    caller.sourceScopeKey = 'different-source-after-call';
    caller.selectedBusinessVersion = otherEdition;
    caller.requestedBusinessVersion = otherEdition;
    caller.fhirFamily = 'R5';
    expect(Object.isFrozen(actual)).toBe(true);
    expect(Object.isFrozen(actual.scope)).toBe(true);
    expect(actual.scope).toEqual(scope);
    const result = importedNamedCodeRejection(actual, '721912009');
    expect(result).toMatchObject({ valid: false, reason: 'code-unknown' });
    if (!result) throw new Error('Caller mutation must not change the completed exact scope proof');
    expect(isImportedNamedCodeRejection(result, '721912009', scope.selectedCanonical, 'R4', edition)).toBe(true);
    expect(isImportedNamedCodeRejection(result, '721912009', scope.selectedCanonical, 'R5', otherEdition)).toBe(false);
    expect(result.message).toContain(edition);
    expect(result.message).not.toContain(otherEdition);
  });

  it('never binds a selected edition that differs between accessor validation and scope capture', () => {
    const raw = resource(Object.freeze([concept(firstCode), concept(detailCode, true)]) as unknown as unknown[]);
    const parsed = parseMixedNamedInventory(raw);
    if (parsed.kind !== 'named-inventory') throw new Error('Expected owned metadata definition');
    let reads = 0;
    const caller = { ...scope };
    Object.defineProperty(caller, 'selectedBusinessVersion', { enumerable: true, get: () => ++reads === 1
      ? edition : 'http://snomed.info/sct/999000041000000102/version/20250701' });
    const assessment = assessSelectedNamedMembership(parsed.definition, caller, '721912009');
    if (assessment.kind === 'unverified') {
      expect(assessment.kind).toBe('unverified');
      return;
    }
    expect(assessment.kind).toBe('absent-named-concept');
    if (assessment.kind !== 'absent-named-concept') throw new Error('Expected absent metadata ID or unsafe-scope U');
    expect(assessment.scope.selectedBusinessVersion).toBe(parsed.definition.businessVersion);
    expect(assessment.scope.selectedBusinessVersion).toBe(assessment.scope.requestedBusinessVersion);
  });

  it('cannot substitute a foreign intrinsic index by mutating the returned cached parse envelope', () => {
    const original = resource(Object.freeze([concept(firstCode), concept(detailCode, true)]) as unknown as unknown[]);
    const other = resource(Object.freeze([concept(secondCode), concept(detailCode, true)]) as unknown as unknown[]);
    const parsed = parseMixedNamedInventory(original);
    const foreign = parseMixedNamedInventory(other);
    if (parsed.kind !== 'named-inventory' || foreign.kind !== 'named-inventory') throw new Error('Expected two owned metadata definitions');
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Reflect.set(parsed, 'definition', foreign.definition)).toBe(false);
    const again = parseMixedNamedInventory(original);
    if (again.kind !== 'named-inventory') throw new Error('Original immutable definition must remain selected');
    expect(again.definition.resource).toBe(original);
    const membership = assessSelectedNamedMembership(again.definition, scope, firstCode);
    expect(membership.kind).toBe('present');
    expect(importedNamedCodeRejection(membership, firstCode)).toBeUndefined();
  });
});


describe('owned named inventory equality and display presence', () => {
  it('reuses its immutable named index for equality without borrowing relationship coverage', () => {
    const raw = resource(Object.freeze([concept(firstCode), concept(detailCode, true)]) as unknown as unknown[]) as unknown as CodeSystem;
    const parsed = parseMixedNamedInventory(raw);
    for (let round = 0; round < 3; round++) {
      expect(findImportedInventoryConcept(raw, firstCode)?.code).toBe(firstCode);
      expect(findImportedInventoryConcept(raw, secondCode)).toBeNull();
      expect(conceptFilterMembership(raw, firstCode, { property: 'concept', op: '=', value: firstCode })).toBe(true);
      expect(conceptFilterMembership(raw, firstCode, { property: 'concept', op: '=', value: detailCode })).toBe(false);
      expect(conceptFilterMembership(raw, firstCode, { property: 'concept', op: '=', value: secondCode })).toBeNull();
      expect(conceptFilterMembership(raw, firstCode, { property: 'concept', op: 'is-not-a', value: detailCode })).toBeNull();
      expect(parseMixedNamedInventory(raw)).toBe(parsed);
    }
  });

  it.each(['resource', 'concept'] as const)('cannot retain equality through a mutable %s modifier array beneath a frozen capture', location => {
    const modifiers: unknown[] = [];
    const first = location === 'concept' ? Object.freeze({ ...concept(firstCode), modifierExtension: modifiers }) : concept(firstCode);
    const base = resource(Object.freeze([first, concept(detailCode, true)]) as unknown as unknown[]);
    const raw = (location === 'resource' ? Object.freeze({ ...base, modifierExtension: modifiers }) : base) as unknown as CodeSystem;
    expect(conceptFilterMembership(raw, firstCode, { property: 'concept', op: '=', value: firstCode })).toBe(true);
    modifiers.push({ url: 'http://example.test/modifier' });
    expect(findImportedInventoryConcept(raw, firstCode)).toBeNull();
    expect(conceptFilterMembership(raw, firstCode, { property: 'concept', op: '=', value: firstCode })).toBeNull();
  });
});
