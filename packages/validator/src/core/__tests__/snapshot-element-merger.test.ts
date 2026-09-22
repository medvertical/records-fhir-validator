/**
 * The merged snapshot must keep the base resource's depth-first element order
 * and place added elements inside their parent's subtree. Sorting the snapshot
 * by path put `Patient.active` before `Patient.identifier:nhs` and reordered
 * slices alphabetically, which `ordered` slicing then judged against.
 */
import { describe, expect, it } from 'vitest';
import { SnapshotElementMerger } from '../snapshot-element-merger';
import type { ElementDefinition } from '../structure-definition-types';

const el = (path: string, extra: Partial<ElementDefinition> = {}): ElementDefinition =>
  ({ id: path, path, min: 0, max: '*', ...extra }) as ElementDefinition;

const basePatient: ElementDefinition[] = [
  el('Patient'),
  el('Patient.identifier'),
  el('Patient.identifier.use'),
  el('Patient.identifier.system'),
  el('Patient.active'),
  el('Patient.name'),
  el('Patient.name.family'),
  el('Patient.contact'),
  el('Patient.contact.telecom'),
  el('Patient.contact.gender'),
];

function order(elements: ElementDefinition[]): string[] {
  return elements.map(element => element.id ?? element.path ?? '');
}

describe('SnapshotElementMerger element order', () => {
  const merger = new SnapshotElementMerger();

  it('keeps base order and places slices after the sliced element, in declared order', () => {
    const snapshot = merger.merge(basePatient, [
      el('Patient.identifier', { slicing: { discriminator: [{ type: 'value', path: 'system' }], rules: 'open' } } as never),
      el('Patient.identifier', { id: 'Patient.identifier:nhs', sliceName: 'nhs', min: 1, max: '1' }),
      el('Patient.identifier.system', { id: 'Patient.identifier:nhs.system', min: 1 }),
      el('Patient.identifier', { id: 'Patient.identifier:local', sliceName: 'local' }),
      el('Patient.identifier.value', { id: 'Patient.identifier:local.value', min: 1 }),
      el('Patient.name', { min: 1 }),
    ], false);

    expect(order(snapshot)).toEqual([
      'Patient',
      'Patient.identifier',
      'Patient.identifier.use',
      'Patient.identifier.system',
      'Patient.identifier:nhs',
      'Patient.identifier:nhs.system',
      'Patient.identifier:local',
      'Patient.identifier:local.value',
      'Patient.active',
      'Patient.name',
      'Patient.name.family',
      'Patient.contact',
      'Patient.contact.telecom',
      'Patient.contact.gender',
    ]);
    expect(snapshot.find(element => element.id === 'Patient.name')?.min).toBe(1);
  });

  it('does not sort slices alphabetically', () => {
    const snapshot = merger.merge(basePatient, [
      el('Patient.identifier', { id: 'Patient.identifier:zulu', sliceName: 'zulu' }),
      el('Patient.identifier', { id: 'Patient.identifier:alpha', sliceName: 'alpha' }),
    ], false);

    expect(order(snapshot).slice(1, 6)).toEqual([
      'Patient.identifier',
      'Patient.identifier.use',
      'Patient.identifier.system',
      'Patient.identifier:zulu',
      'Patient.identifier:alpha',
    ]);
  });

  it('places an added child inside its parent subtree instead of at the end', () => {
    const snapshot = merger.merge(basePatient, [
      el('Patient.contact.telecom.extension', { min: 1 }),
    ], false);

    expect(order(snapshot).slice(-3)).toEqual([
      'Patient.contact.telecom',
      'Patient.contact.telecom.extension',
      'Patient.contact.gender',
    ]);
  });

  it('merges a second differential entry for an added path into the same element', () => {
    const snapshot = merger.merge(basePatient, [
      el('Patient.contact.telecom.extension', { min: 1 }),
      el('Patient.contact.telecom.extension', { max: '3' }),
    ], false);

    const added = snapshot.filter(element => element.path === 'Patient.contact.telecom.extension');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ min: 1, max: '3' });
  });

  it('appends an element whose parent the base does not know', () => {
    const snapshot = merger.merge(basePatient, [el('Patient.unknownParent.child')], false);

    expect(order(snapshot).at(-1)).toBe('Patient.unknownParent.child');
  });
});
