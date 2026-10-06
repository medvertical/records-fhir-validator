import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import { SlicingValidator } from '../slicing-validator.js';

const field = 'List.entry';
const core = 'http://hl7.org/fhir/StructureDefinition/';

function profile(min = 2, discriminator: 'type' | 'profile' = 'type'): StructureDefinition {
  return {
    resourceType: 'StructureDefinition', url: 'https://synthetic.records.example/snapshot-proof',
    name: 'SnapshotProof', status: 'active', kind: 'resource', abstract: false, type: 'List',
    snapshot: { element: [
      { id: 'List', path: 'List', min: 0, max: '*' },
      { id: field, path: field, min: 0, max: '*', slicing: { discriminator: [{ type: discriminator, path: 'item.resolve()' }], rules: 'closed' } },
      ...(['Observation', 'Patient'] as const).flatMap((type, index) => {
        const sliceName = index === 0 ? 'A' : 'B';
        return [
          { id: `${field}:${sliceName}`, path: field, sliceName, min: index === 0 ? min : 0, max: '*' },
          { id: `${field}:${sliceName}.item`, path: `${field}.item`, min: 1, max: '1', type: [{ code: 'Reference', targetProfile: [`${core}${type}`] }] },
        ];
      }),
    ] },
  };
}

async function validate(definition: StructureDefinition, targetType?: 'Observation' | 'Patient') {
  const elements = [{ item: { reference: 'urn:uuid:snapshot-control' } }];
  const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
  validator.setTypeProfileResolver(async canonical => ({
    ...definition, url: canonical, type: canonical.slice(core.length),
    snapshot: { element: [] }, differential: undefined,
  }));
  return validator.validateSlicing(elements, field, definition,
    () => targetType ? { resourceType: targetType } : null,
    field, 'R4', { resourceType: 'List', entry: elements }, field);
}

const finiteMinimum = (issues: Awaited<ReturnType<typeof validate>>) => issues.filter(issue =>
  issue.code === 'profile-slice-min-cardinality' && typeof issue.details === 'object'
  && issue.details.cardinalityUpperBound !== undefined);

describe('Finite slice bounds require snapshot metadata', () => {
  describe.each(['type', 'profile'] as const)('%s discriminator', discriminator => {
    it.each([
      { name: 'empty', elements: [] },
      { name: 'all-invalid', elements: [null, {}, 7, [], { path: '' }] },
    ])('$name snapshot cannot borrow a complete differential', async ({ elements }) => {
      const definition = profile(2, discriminator);
      definition.differential = definition.snapshot;
      (definition as unknown as Record<string, unknown>).snapshot = { element: elements };
      const issues = await validate(definition);
      expect(finiteMinimum(issues)).toEqual([]);
      expect(issues.some(issue => typeof issue.details === 'object'
        && issue.details.validationComplete === false)).toBe(true);
    });
  });

  it.each(['absent', 'missing-element', 'nonarray', 'root-only'] as const)('%s snapshot remains outside the finite proof', async mode => {
    const definition = profile();
    definition.differential = definition.snapshot;
    if (mode === 'absent') delete definition.snapshot;
    else (definition as unknown as Record<string, unknown>).snapshot = {
      element: mode === 'root-only' ? [definition.snapshot!.element![0]]
        : mode === 'nonarray' ? { id: 'List' } : undefined,
    };
    expect(finiteMinimum(await validate(definition))).toEqual([]);
  });

  it.each(['absent', 'conflicting', 'invalid'] as const)('%s differential cannot change a complete snapshot minimum', async mode => {
    const definition = profile();
    if (mode === 'conflicting') definition.differential = {
      element: definition.snapshot!.element!.map(element => ({ ...element, min: 0 })),
    };
    if (mode === 'invalid') (definition as unknown as Record<string, unknown>).differential = { element: [null, {}] };
    expect(finiteMinimum(await validate(definition))).toMatchObject([
      { severity: 'error', details: { cardinalityUpperBound: 1, occurrenceCount: 1 } },
    ]);
  });

  it.each([false, true])('feasible unknown membership stays incomplete with empty snapshot=%s', async empty => {
    const definition = profile(1);
    if (empty) { definition.differential = definition.snapshot; definition.snapshot = { element: [] }; }
    const issues = await validate(definition);
    expect(finiteMinimum(issues)).toEqual([]);
    expect(issues.some(issue => typeof issue.details === 'object'
      && issue.details.validationComplete === false)).toBe(true);
  });

  it('known membership remains accepted', async () => {
    expect((await validate(profile(1), 'Observation')).filter(issue => issue.severity === 'error')).toEqual([]);
  });

  it('known nonmembership retains its ordinary minimum', async () => {
    const issues = await validate(profile(1), 'Patient');
    expect(issues.filter(issue => issue.code === 'profile-slice-min-cardinality')).toHaveLength(1);
    expect(finiteMinimum(issues)).toEqual([]);
  });
});
