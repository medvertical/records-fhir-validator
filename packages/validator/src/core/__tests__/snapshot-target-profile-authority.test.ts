import { describe, expect, it } from 'vitest';
import { SnapshotElementMerger } from '../snapshot-element-merger.js';
import { cloneSnapshotElements, recordSnapshotTypeSources, snapshotTargetProfileSource, snapshotTypeSource } from '../snapshot-type-profile-authority.js';
import { copyProfilePackageProvenance, lookupProfilePackageProvenance, recordProfilePackageProvenance } from '../../package/canonical-pin-provenance.js';
import { validateReferenceTargetProfileConformance } from '../multi-aspect-target-profile-conformance.js';
import { ReferenceTargetValidator } from '../../validators/reference-target-validator.js';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';

const inherited = 'https://example.test/StructureDefinition/Inherited';
const override = 'https://example.test/StructureDefinition/Override';
const source = (name: string) => {
  const identity = { url: `https://example.test/StructureDefinition/${name}`, version: '7.0.0' };
  recordProfilePackageProvenance(identity, `${name}#1.0.0`); return identity;
};
const element = (profile: string[], targetProfile: string[]): ElementDefinition => ({
  id: 'Observation.subject', path: 'Observation.subject', type: [{ code: 'Reference', profile, targetProfile }],
});

describe('Independent issued type.profile and type.targetProfile authority', () => {
  it.each(['profile', 'targetProfile'] as const)('keeps inherited authority of the other field when %s is overridden', field => {
    const base = source('base'), child = source('child');
    const baseElements = [element([inherited], [inherited])];
    const differential: ElementDefinition[] = [{ id: 'Observation.subject', path: 'Observation.subject',
      type: [{ code: 'Reference', [field]: [override] }] }];
    const before = JSON.stringify([baseElements, differential]);
    recordSnapshotTypeSources(baseElements, base); recordSnapshotTypeSources(differential, child);
    const snapshot = new SnapshotElementMerger().merge(baseElements, differential, true);
    const copy = cloneSnapshotElements(snapshot)[0].type![0];
    expect(lookupProfilePackageProvenance(snapshotTypeSource(copy, child)))
      .toEqual({ name: field === 'profile' ? 'child' : 'base', version: '1.0.0' });
    expect(lookupProfilePackageProvenance(snapshotTargetProfileSource(copy, child)))
      .toEqual({ name: field === 'targetProfile' ? 'child' : 'base', version: '1.0.0' });
    expect(JSON.stringify([baseElements, differential])).toBe(before);
    const whole = { snapshot: { element: snapshot } }; const detached = structuredClone(whole);
    copyProfilePackageProvenance(whole, detached);
    expect(lookupProfilePackageProvenance(snapshotTargetProfileSource(detached.snapshot.element[0].type![0], child)))
      .toEqual({ name: field === 'targetProfile' ? 'child' : 'base', version: '1.0.0' });
  });

  it('rejects changed target-profile authority without retiring the independent profile authority', () => {
    const base = source('base'), child = source('child'); const elements = [element([inherited], [inherited])];
    recordSnapshotTypeSources(elements, base); const type = elements[0].type![0];
    type.targetProfile = [override];
    expect(snapshotTargetProfileSource(type, child)).toBe(child);
    expect(lookupProfilePackageProvenance(snapshotTypeSource(type, child))).toEqual({ name: 'base', version: '1.0.0' });
  });

  it.each([true, undefined, false] as const)('preserves same-canonical issued alternatives with second verdict %s', async second => {
    const base = source('base'), child = source('child');
    const firstElements = [element([], [inherited])], secondElements = [element([], [inherited])];
    recordSnapshotTypeSources(firstElements, base); recordSnapshotTypeSources(secondElements, child);
    const sd = { resourceType: 'StructureDefinition', url: child.url, type: 'Observation', snapshot: { element: [{
      id: 'Observation.subject', path: 'Observation.subject', type: [firstElements[0].type![0], secondElements[0].type![0]],
    }] } } as StructureDefinition;
    const calls: string[] = [];
    const issues = await validateReferenceTargetProfileConformance({
      resource: { resourceType: 'Observation', subject: { reference: '#own' } }, structureDef: sd,
      referenceTargetValidator: new ReferenceTargetValidator(), resolveReference: () => ({ resourceType: 'Patient' }),
      conformsTo: async (_target, canonical, definer) => {
        expect(canonical).toBe(inherited); const origin = definer && lookupProfilePackageProvenance(definer);
        calls.push(origin?.name ?? 'unknown'); return origin?.name === 'base' ? false : second;
      },
    });
    expect(calls).toEqual(['base', 'child']);
    expect(issues.filter(issue => issue.code === 'reference-target-profile-noncompliant')).toHaveLength(second === false ? 1 : 0);
  });
});
