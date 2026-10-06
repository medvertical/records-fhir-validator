import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ElementDefinition, StructureDefinition } from '../../core/structure-definition-types.js';
import { SlicingValidator } from '../slicing-validator.js';
import metadata from '../__fixtures__/slicing-exists-mii-document-metadata.json';

interface SliceFixture {
  name: string;
  min?: number;
  max?: string;
  urlMin?: number;
  urlMax?: string;
  dataMin?: number;
  dataMax?: string;
  title?: string;
}
const url = { attachment: { url: 'https://records-canary.invalid/control.txt' } };
const binary = { attachment: { data: 'QQ==' } };
const absentReason = { extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason', valueCode: 'unknown' }] };
const binarySlice: SliceFixture = { name: 'binary', urlMax: '0', dataMin: 1 };
const urlSlice: SliceFixture = { name: 'url', urlMin: 1, urlMax: '1', dataMax: '0' };

function fixture(slices: SliceFixture[], composite = false): StructureDefinition {
  const path = 'DocumentReference.content';
  const element: ElementDefinition[] = [{ id: path, path, min: 1, max: '*', slicing: {
    discriminator: [{ type: 'exists', path: 'attachment.url' }, ...(composite ? [{ type: 'pattern' as const, path: 'attachment.title' }] : [])],
    rules: 'open', ordered: false,
  } }];
  for (const slice of slices) {
    const id = `${path}:${slice.name}`;
    element.push({ id, path, sliceName: slice.name, min: slice.min ?? 0, max: slice.max ?? '*', type: [{ code: 'BackboneElement' }] });
    element.push({ id: `${id}.attachment`, path: `${path}.attachment`, min: 1, max: '1' });
    element.push({ id: `${id}.attachment.url`, path: `${path}.attachment.url`, min: slice.urlMin, max: slice.urlMax });
    element.push({ id: `${id}.attachment.data`, path: `${path}.attachment.data`, min: slice.dataMin, max: slice.dataMax });
    if (slice.title !== undefined) element.push({ id: `${id}.attachment.title`, path: `${path}.attachment.title`, patternString: slice.title });
  }
  return { resourceType: 'StructureDefinition', name: 'ExistsFixture', status: 'active', kind: 'resource', abstract: false, url: 'https://independent.test/StructureDefinition/exists-unit-contract', type: 'DocumentReference', snapshot: { element } };
}
async function validate(profile: StructureDefinition, elements: unknown[]): Promise<ValidationIssue[]> {
  const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => { throw new Error('No terminology dependency in exists contract'); } } });
  return validator.validateSlicing(elements, 'DocumentReference.content', profile, null, 'DocumentReference.content');
}
const errors = (issues: ValidationIssue[]) => issues.filter(issue => ['error', 'fatal'].includes(issue.severity));
const incomplete = (issues: ValidationIssue[]) => issues.some(issue => typeof issue.details === 'object' && issue.details?.validationComplete === false);
const cardinality = (issues: ValidationIssue[], code: string, name: string) => issues.some(issue => issue.code === code && typeof issue.details === 'object' && issue.details?.sliceName === name);

describe('exists slicing uses the exact element cardinality', () => {
  for (const reverse of [false, true]) {
    it(`accepts the actual MII URL slice with reverse=${reverse}`, async () => {
      const element = metadata.element as ElementDefinition[];
      const profile: StructureDefinition = { resourceType: 'StructureDefinition', name: 'ExistsFixture', status: 'active', kind: 'resource', abstract: false, url: metadata.canonical, version: metadata.version, type: 'DocumentReference', snapshot: { element: reverse ? [...element].reverse() : element } };
      expect(errors(await validate(profile, [url]))).toEqual([]);
    });
    it(`recognizes the actual MII binary slice with reverse=${reverse}`, async () => {
      const element = metadata.element as ElementDefinition[];
      const profile: StructureDefinition = { resourceType: 'StructureDefinition', name: 'ExistsFixture', status: 'active', kind: 'resource', abstract: false, url: metadata.canonical, version: metadata.version, type: 'DocumentReference', snapshot: { element: reverse ? [...element].reverse() : element } };
      const issues = await validate(profile, [binary]);
      expect(errors(issues)).toEqual([]);
      expect(issues.some(issue => issue.code === 'profile-slice-open-unmatched')).toBe(false);
    });
  }
  it('keeps the known binary data minimum when the discriminator proves absence of URL', async () => {
    expect((await validate(fixture([binarySlice, urlSlice]), [{ attachment: { title: 'missing' } }])).some(issue => issue.code === 'structural-cardinality-min')).toBe(true);
  });
  it('counts a meaningful primitive sidecar as present', async () => {
    expect(errors(await validate(fixture([binarySlice, urlSlice]), [{ attachment: { _url: absentReason } }]))).toEqual([]);
  });
  it('does not treat an empty sidecar as an existing URL', async () => {
    const issues = await validate(fixture([binarySlice, urlSlice]), [{ attachment: { data: 'QQ==', _url: {} } }]);
    expect(errors(issues)).toEqual([]);
    expect(issues.some(issue => issue.code === 'profile-slice-open-unmatched')).toBe(false);
  });
  it('keeps a genuine matched URL maximum', async () => {
    expect(cardinality(await validate(fixture([binarySlice, { ...urlSlice, max: '1' }]), [url, url]), 'profile-slice-max-cardinality', 'url')).toBe(true);
  });
  it('keeps a genuine unrelated URL minimum', async () => {
    expect(cardinality(await validate(fixture([binarySlice, { ...urlSlice, min: 1 }]), [binary]), 'profile-slice-min-cardinality', 'url')).toBe(true);
  });
  it('leaves optional discriminator metadata unverified', async () => {
    const issues = await validate(fixture([{ name: 'optional', urlMin: 0, urlMax: '1' }]), [url]);
    expect(errors(issues)).toEqual([]);
    expect(incomplete(issues)).toBe(true);
  });
  it('does not infer existence from a required ancestor', async () => {
    const issues = await validate(fixture([{ name: 'ancestor' }]), [url]);
    expect(errors(issues)).toEqual([]);
    expect(incomplete(issues)).toBe(true);
  });
  it('retains a possible minimum1 occurrence instead of reporting actual0', async () => {
    const issues = await validate(fixture([urlSlice, { name: 'unknown', min: 1, urlMin: 0, urlMax: '1' }]), [url]);
    expect(cardinality(issues, 'profile-slice-min-cardinality', 'unknown')).toBe(false);
    expect(incomplete(issues)).toBe(true);
  });
  it('retains the proved upper bound1 below minimum2', async () => {
    const issues = await validate(fixture([{ name: 'unknown', min: 2, urlMin: 0, urlMax: '1' }]), [url]);
    expect(cardinality(issues, 'profile-slice-min-cardinality', 'unknown')).toBe(true);
    expect(incomplete(issues)).toBe(true);
  });
  it('does not assign unknown exists metadata through a matching composite title', async () => {
    const issues = await validate(fixture([{ name: 'unknown', min: 1, urlMin: 0, urlMax: '1', title: 'match', dataMin: 1 }], true), [{ attachment: { title: 'match' } }]);
    expect(errors(issues)).toEqual([]);
    expect(incomplete(issues)).toBe(true);
  });
  it('keeps an independent composite mismatch despite unknown exists metadata', async () => {
    const issues = await validate(fixture([{ name: 'unknown', min: 1, urlMin: 0, urlMax: '1', title: 'match' }], true), [{ attachment: { title: 'different' } }]);
    expect(cardinality(issues, 'profile-slice-min-cardinality', 'unknown')).toBe(true);
    expect(incomplete(issues)).toBe(true);
  });
  it('reports ambiguous proved membership without arbitrarily applying child minima', async () => {
    const issues = await validate(fixture([{ ...urlSlice, name: 'first', min: 1, dataMin: 1, dataMax: undefined }, { ...urlSlice, name: 'second', min: 1 }]), [url]);
    expect(issues.some(issue => issue.code?.includes('ambiguous'))).toBe(true);
    expect(issues.some(issue => issue.code === 'structural-cardinality-min')).toBe(false);
    expect(cardinality(issues, 'profile-slice-min-cardinality', 'second')).toBe(false);
  });
});
