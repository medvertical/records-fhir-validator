import { describe, expect, it, vi } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types';
import type { ProfileReferenceSource } from '../profile-reference-authority';
import { createProfileConformanceCheck } from '../multi-aspect-profile-conformance';
import { validateReferenceTargetProfileConformance } from '../multi-aspect-target-profile-conformance';
import { recordSnapshotTypeSources } from '../snapshot-type-profile-authority';
import { lookupProfilePackageProvenance, recordProfilePackageProvenance } from '../../package/canonical-pin-provenance';
import { ReferenceTargetValidator } from '../../validators/reference-target-validator';
import type { ProfileConformanceCheck } from '../../validators/sd-fhirpath-profile-conformance';

const canonical = (name: string) => `https://example.test/StructureDefinition/${name}`;
const coding = (code: string) => ({ system: 'https://example.test/codes', code });
const definition = (name: string, type: string, elements: ElementDefinition[]): StructureDefinition => ({
  resourceType: 'StructureDefinition', url: canonical(name), name, version: '1.0.0',
  fhirVersion: '4.0.1', type, kind: 'resource', derivation: 'constraint', status: 'active', abstract: false,
  snapshot: { element: elements },
});
function targetDefinition(name: string, path = 'code.coding', min = 1): StructureDefinition {
  return definition(name, 'Observation', [
    { id: 'Observation', path: 'Observation' },
    { id: 'Observation.code', path: 'Observation.code', min: 1,
      ...(path === 'code' ? { patternCodeableConcept: { coding: [coding(name)] } } : {}) },
    { id: 'Observation.code.coding', path: 'Observation.code.coding', min: 1, max: '*' },
    { id: 'Observation.code.coding:identity', path: 'Observation.code.coding', sliceName: 'identity',
      min, max: '1', type: [{ code: 'Coding' }], patternCoding: coding(name) },
  ]);
}
function reportDefinition(path = 'code.coding', alternatives: string[] = []): StructureDefinition {
  return definition('Report', 'DiagnosticReport', [
    { id: 'DiagnosticReport', path: 'DiagnosticReport' },
    { id: 'DiagnosticReport.result', path: 'DiagnosticReport.result', type: [{ code: 'Reference',
      targetProfile: ['http://hl7.org/fhir/StructureDefinition/Observation'] }],
      slicing: { discriminator: [{ type: 'value', path: `resolve().${path}` }], rules: 'open' } },
    ...['A', 'B'].map(name => ({ id: `DiagnosticReport.result:${name}`, path: 'DiagnosticReport.result',
      sliceName: name, min: 0, max: '*', type: [{ code: 'Reference',
        targetProfile: [`${canonical(name)}|1.0.0`, ...(name === 'A' ? alternatives : [])] }] })),
  ]);
}
type Target = { resourceType: string; id: string; code: { coding: ReturnType<typeof coding>[] } };
const target = (name: string, id = name): Target => ({ resourceType: 'Observation', id, code: { coding: [coding(name)] } });
const report = (ids: string[]) => ({ resourceType: 'DiagnosticReport', result: ids.map(id => ({ reference: `urn:uuid:${id}` })) });
type Loader = (url: string, source: ProfileReferenceSource) => Promise<StructureDefinition | null>;
function fixture(path = 'code.coding') {
  const definitions = new Map(['A', 'B'].map(name => [`${canonical(name)}|1.0.0`, targetDefinition(name, path)]));
  const load: Loader = async url => definitions.get(url) ?? null;
  return { profile: reportDefinition(path), definitions, load };
}
async function validate(profile: StructureDefinition, resource: ReturnType<typeof report>,
  targets: Map<string, Target>, load: Loader, verdict: boolean | undefined | ProfileConformanceCheck = false) {
  const incomplete: ValidationIssue[] = [];
  const conformsTo = vi.fn(async (_target: Record<string, unknown>, _profile: string,
    _source?: ProfileReferenceSource) => typeof verdict === 'function' ? verdict(_target, _profile, _source) : verdict);
  const issues = await validateReferenceTargetProfileConformance({ resource, structureDef: profile,
    referenceTargetValidator: new ReferenceTargetValidator(), resolveReference: reference => targets.get(reference) ?? null,
    conformsTo, loadReferenceTargetDefinition: load, onIncomplete: issue => incomplete.push(issue) });
  return { issues, incomplete, conformsTo };
}
const targetsFor = (...resources: Target[]) => new Map(resources.map(resource => [`urn:uuid:${resource.id}`, resource]));

describe('Resolved reference slices and their own target definitions', () => {
  it.each(['code', 'code.coding'])('checks every occurrence against only its selected %s slice', async path => {
    const { profile, load } = fixture(path);
    const resource = report(['one', 'two', 'three']);
    const targets = targetsFor(target('A', 'one'), target('B', 'two'), target('A', 'three'));
    const before = JSON.stringify({ profile, resource });
    const failed = await validate(profile, resource, targets, load);
    expect(failed.issues.map(issue => [issue.code, issue.path]).sort()).toEqual([
      ['reference-target-profile-noncompliant', 'DiagnosticReport.result[0]'],
      ['reference-target-profile-noncompliant', 'DiagnosticReport.result[1]'],
      ['reference-target-profile-noncompliant', 'DiagnosticReport.result[2]'],
    ]);
    expect(failed.conformsTo.mock.calls.map(call => [call[0].id, call[1]]).sort()).toEqual([
      ['one', `${canonical('A')}|1.0.0`], ['three', `${canonical('A')}|1.0.0`], ['two', `${canonical('B')}|1.0.0`],
    ]);
    expect(failed.incomplete).toEqual([]);
    expect((await validate(profile, resource, targets, load, true)).issues).toEqual([]);
    expect(JSON.stringify({ profile, resource })).toBe(before);
  });

  it('keeps a proved rejection beside an unresolved occurrence', async () => {
    const { profile, load } = fixture();
    const result = await validate(profile, report(['A', 'absent']), targetsFor(target('A')), load);
    expect(result.issues.map(issue => issue.path)).toEqual(['DiagnosticReport.result[0]']);
    expect(result.incomplete).toEqual([expect.objectContaining({ path: 'DiagnosticReport.result[1]',
      severity: 'information', details: expect.objectContaining({ validationComplete: false }) })]);
  });

  it('keeps code object assertions separate from required Coding identities', async () => {
    const { profile, definitions, load } = fixture();
    for (const name of ['A', 'B']) definitions.get(`${canonical(name)}|1.0.0`)!.snapshot!.element[1]
      .patternCodeableConcept = { text: name };
    const codingResult = await validate(profile, report(['A']), targetsFor(target('A')), load);
    expect(codingResult.issues).toHaveLength(1);
    const conceptResult = await validate(reportDefinition('code'), report(['A']), targetsFor(target('A')), load);
    expect(conceptResult.issues).toEqual([]);
    expect(conceptResult.incomplete).toEqual([]);
  });

  it('requires every mandatory Coding assertion used to identify the target', async () => {
    const { profile, definitions, load } = fixture();
    definitions.get(`${canonical('A')}|1.0.0`)!.snapshot!.element.push({
      id: 'Observation.code.coding:second', path: 'Observation.code.coding', sliceName: 'second',
      min: 1, max: '1', type: [{ code: 'Coding' }], patternCoding: coding('second'),
    });
    expect((await validate(profile, report(['A']), targetsFor(target('A')), load)).issues).toEqual([]);
    const complete = target('A'); complete.code.coding.push(coding('second'));
    expect((await validate(profile, report(['A']), targetsFor(complete), load)).issues).toHaveLength(1);
  });

  it.each([true, false, undefined])('retains OR target profile alternatives after selection (%s)', async verdict => {
    const { definitions, load } = fixture();
    const alternative = targetDefinition('Alternative');
    alternative.snapshot!.element[3].patternCoding = coding('A');
    definitions.set(`${canonical('Alternative')}|1.0.0`, alternative);
    const profile = reportDefinition('code.coding', [`${canonical('Alternative')}|1.0.0`]);
    const result = await validate(profile, report(['A']), targetsFor(target('A')), load,
      async (_resource, url) => url === `${canonical('Alternative')}|1.0.0` ? false : verdict);
    expect(result.issues).toHaveLength(verdict === false ? 1 : 0);
    expect(result.conformsTo.mock.calls.map(call => call[1]).sort()).toEqual([
      `${canonical('A')}|1.0.0`, `${canonical('Alternative')}|1.0.0`,
    ].sort());
  });

  it.each([
    'optional', 'optional-code', 'missing-pattern', 'missing-snapshot', 'wrong-version', 'duplicate-identity', 'wrong-canonical',
  ])('keeps %s target metadata undecided', async scenario => {
      const { profile, definitions, load } = fixture();
      const own = definitions.get(`${canonical('A')}|1.0.0`)!;
      if (scenario === 'optional') own.snapshot!.element[3].min = 0;
      if (scenario === 'optional-code') own.snapshot!.element[1].min = 0;
      if (scenario === 'missing-pattern') delete own.snapshot!.element[3].patternCoding;
      if (scenario === 'missing-snapshot') { own.differential = own.snapshot; delete own.snapshot; }
      if (scenario === 'wrong-version') own.version = '2.0.0';
      if (scenario === 'wrong-canonical') own.url = canonical('Foreign');
      if (scenario === 'duplicate-identity') own.snapshot!.element.push({ ...own.snapshot!.element[3] });
      const result = await validate(profile, report(['A']), targetsFor(target('A')), load);
      expect(result.issues).toEqual([]);
      expect(result.conformsTo).not.toHaveBeenCalled();
      expect(result.incomplete).toHaveLength(1);
    });

  it('retains a known match with unknown sibling evidence and leaves ambiguous matches undecided', async () => {
    const { profile, definitions, load } = fixture();
    definitions.delete(`${canonical('B')}|1.0.0`);
    const unknown = await validate(profile, report(['A']), targetsFor(target('A')), load);
    expect(unknown.issues.map(issue => issue.path)).toEqual(['DiagnosticReport.result[0]']);
    expect(unknown.incomplete).toHaveLength(1);
    definitions.set(`${canonical('B')}|1.0.0`, targetDefinition('B'));
    const both = target('A'); both.code.coding.push(coding('B'));
    const ambiguous = await validate(profile, report(['A']), targetsFor(both), load);
    expect(ambiguous.issues).toEqual([]);
    expect(ambiguous.conformsTo).not.toHaveBeenCalled();
    expect(ambiguous.incomplete).toHaveLength(1);
  });

  it('does not choose an unknown targetProfile alternative, even beside a known discriminator', async () => {
    const { definitions, load } = fixture();
    const profile = reportDefinition('code.coding', [`${canonical('Unavailable')}|1.0.0`]);
    expect(definitions.has(`${canonical('A')}|1.0.0`)).toBe(true);
    const result = await validate(profile, report(['A']), targetsFor(target('A')), load);
    expect(result.issues).toEqual([]);
    expect(result.incomplete).toHaveLength(1);
  });

  it('retains unsliced target obligations when slice selection is unavailable', async () => {
    const { profile } = fixture();
    profile.snapshot!.element[1].type = [{ code: 'Reference', targetProfile: [canonical('AllResults')] }];
    const result = await validate(profile, report(['A']), targetsFor(target('A')), async () => null);
    expect(result.issues.map(issue => issue.path)).toEqual(['DiagnosticReport.result[0]']);
    expect(result.conformsTo.mock.calls.map(call => call[1])).toEqual([canonical('AllResults')]);
    expect(result.incomplete).toHaveLength(1);
  });

  it.each(['duplicate-base', 'duplicate-slice'])('keeps %s selected owner identities undecided', async scenario => {
    const { profile, load } = fixture();
    const index = scenario === 'duplicate-base' ? 1 : 2;
    profile.snapshot!.element.push({ ...profile.snapshot!.element[index] });
    const result = await validate(profile, report(['A']), targetsFor(target('A')), load);
    expect(result.issues).toEqual([]);
    expect(result.conformsTo).not.toHaveBeenCalled();
    expect(result.incomplete.length).toBeGreaterThan(0);
  });

  it('does not carry occurrence selection into the next validation pass', async () => {
    const { profile, load } = fixture();
    const resource = report(['same']);
    const first = await validate(profile, resource, targetsFor(target('A', 'same')), load);
    const second = await validate(profile, resource, targetsFor(target('B', 'same')), load);
    expect(first.conformsTo.mock.calls[0][1]).toBe(`${canonical('A')}|1.0.0`);
    expect(second.conformsTo.mock.calls[0][1]).toBe(`${canonical('B')}|1.0.0`);
  });

  it('uses the issued snapshot declaration owner for loading and conformance', async () => {
    const { profile, load } = fixture();
    const inherited = definition('BaseReport', 'DiagnosticReport', []);
    recordProfilePackageProvenance(inherited, 'example.base#3.0.0');
    recordProfilePackageProvenance(profile, 'example.child#4.0.0');
    recordSnapshotTypeSources([profile.snapshot!.element[2]], inherited);
    const owners: Array<ProfileReferenceSource> = [];
    const result = await validate(profile, report(['A']), targetsFor(target('A')), async (url, source) => {
      if (url === `${canonical('A')}|1.0.0`) owners.push(source);
      return load(url, source);
    });
    expect(result.issues).toHaveLength(1);
    expect(owners).toEqual([expect.objectContaining({ url: inherited.url, version: inherited.version })]);
    expect(lookupProfilePackageProvenance(owners[0])).toEqual({ name: 'example.base', version: '3.0.0' });
    expect(result.conformsTo.mock.calls[0][2]).toBe(owners[0]);
    const unavailable = await validate(profile, report(['A']), targetsFor(target('A')), async (url, source) =>
      lookupProfilePackageProvenance(source)?.name === 'example.base' ? null : load(url, source));
    expect(unavailable.issues).toEqual([]);
    expect(unavailable.incomplete).toHaveLength(1);
  });

  it('propagates a proved report failure to its parent Reference while retaining report uncertainty', async () => {
    const { profile, load } = fixture();
    const nested = await validate(profile, report(['A', 'missing']), targetsFor(target('A')), load);
    const parent = definition('Procedure', 'Procedure', [{ id: 'Procedure.report', path: 'Procedure.report',
      type: [{ code: 'Reference', targetProfile: [`${profile.url}|1.0.0`] }] }]);
    const incomplete: ValidationIssue[] = [];
    const check = createProfileConformanceCheck({ fhirVersion: 'R4', recursionDepth: 0, referencingProfile: parent,
      sdLoader: { loadReferencedProfile: async () => profile } as never,
      validateOne: (async () => ({ aspects: [{ aspect: 'reference', isValid: false,
        issues: [...nested.issues, ...nested.incomplete] }] })) as never,
      onIncomplete: issue => incomplete.push(issue) });
    const issues = await validateReferenceTargetProfileConformance({ resource: {
      resourceType: 'Procedure', report: [{ reference: 'urn:uuid:report' }] }, structureDef: parent,
      referenceTargetValidator: new ReferenceTargetValidator(), resolveReference: () => report(['A', 'missing']),
      conformsTo: check });
    expect(issues.map(issue => [issue.code, issue.path])).toEqual([
      ['reference-target-profile-noncompliant', 'Procedure.report[0]'],
    ]);
    expect(incomplete).toEqual([expect.objectContaining({ code: 'profile-conformance-incomplete' })]);
  });
});
