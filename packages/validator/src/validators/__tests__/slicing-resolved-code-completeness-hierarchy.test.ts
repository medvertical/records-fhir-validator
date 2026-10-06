import { describe, expect, it } from 'vitest';
import { SlicingValidator } from '../slicing-validator.js';
import type { SlicingDefinition, StructureDefinition } from '../../core/structure-definition-types.js';
import metadata from '../__fixtures__/slicing-resolved-code-mii-patho-metadata.json';
const original = metadata.report as unknown as StructureDefinition;
const targets = metadata.targets as unknown as StructureDefinition[];
const elementPath = 'DiagnosticReport.result';
const names = ['intraoperative-observations', 'macroscopic-observations'];
const code = (index: number) => structuredClone(targets[index].snapshot!.element[0].patternCodeableConcept) as { coding: Array<{ system: string; code: string }> };
const slicing = (profile: StructureDefinition) => profile.snapshot!.element.find(element => element.id === elementPath)!.slicing as SlicingDefinition;
function profile(): StructureDefinition {
  const result = structuredClone(original);
  result.snapshot!.element = result.snapshot!.element.filter(element => !element.id?.startsWith(`${elementPath}:`)
    || names.some(name => element.id?.startsWith(`${elementPath}:${name}`)));
  for (const element of result.snapshot!.element) {
    if (element.id === elementPath) element.min = 0;
    if (element.sliceName) { element.min = 0; element.max = '1'; }
  }
  slicing(result).ordered = false;
  return result;
}
function composite(profile: StructureDefinition, display = ['same', 'same']): void {
  slicing(profile).discriminator!.push({ type: 'value', path: 'display' });
  for (const [index, name] of names.entries()) profile.snapshot!.element.push({
    id: `${elementPath}:${name}.display`, path: `${elementPath}.display`, min: 1, max: '1', fixedString: display[index],
  });
}
function combined() { const result = code(0); result.coding.push(...code(1).coding); return result; }
async function validate(profile: StructureDefinition, indices: number[], display?: string[]) {
  const references = indices.map((_, index) => ({ reference: `Observation/${index}`, ...(display ? { display: display[index] } : {}) }));
  const values = new Map(indices.map((target, index) => [`Observation/${index}`, { resourceType: 'Observation', code: target === -1 ? combined() : code(target) }]));
  const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
  validator.setTypeProfileResolver(async canonical => structuredClone(targets.find(target => target.url === canonical) ?? null));
  return validator.validateSlicing(references, elementPath, profile, reference => values.get(reference) ?? null, elementPath, 'R4');
}
function missingAlternative(profile: StructureDefinition): void {
  profile.snapshot!.element.find(element => element.sliceName === names[1])!.type![0].targetProfile = ['http://example.test/unavailable-code-definition'];
}
function hierarchy(twoChildren = false): StructureDefinition {
  const result = profile(), replacements = new Map([[names[0], 'observations'], [names[1], 'observations/intraoperative']]);
  for (const element of result.snapshot!.element) {
    for (const [previous, replacement] of replacements) if (element.id?.startsWith(`${elementPath}:${previous}`)) {
      element.id = element.id.replace(`${elementPath}:${previous}`, `${elementPath}:${replacement}`);
      if (element.sliceName) element.sliceName = replacement;
    }
    if (element.sliceName) { element.type![0].targetProfile = [targets[0].url]; element.max = '*'; }
  }
  result.snapshot!.element.find(element => element.sliceName === 'observations')!.slicing = {
    discriminator: [{ type: 'value', path: 'resolve().code' }], rules: 'open', ordered: false,
  };
  if (twoChildren) {
    const children = structuredClone(result.snapshot!.element.filter(element => element.id?.startsWith(`${elementPath}:observations/intraoperative`)));
    for (const element of children) {
      element.id = element.id!.replace(':observations/intraoperative', ':observations/macroscopic');
      if (element.sliceName) { element.sliceName = 'observations/macroscopic'; element.type![0].targetProfile = [targets[1].url]; }
    }
    result.snapshot!.element.push(...children);
  }
  return result;
}
const unresolved = (issues: Awaited<ReturnType<typeof validate>>) => issues.filter(issue => String((issue.details as Record<string, unknown> | undefined)?.reason).startsWith('unresolved-'));
const cardinality = (issues: Awaited<ReturnType<typeof validate>>, kind: 'min' | 'max') => issues.filter(issue => issue.code === `profile-slice-${kind}-cardinality`);

describe('resolved-code metadata and hierarchical membership', () => {
  it.each([0, 4])('reports unavailable composite code metadata with available target %s', async index => {
    const definition = profile(); missingAlternative(definition); composite(definition);
    const issues = await validate(definition, [index], ['same']);
    expect(unresolved(issues)).toHaveLength(1); expect(unresolved(issues)[0].severity).toBe('information');
    expect(issues.some(issue => issue.severity === 'error')).toBe(false);
  });
  it('retains one existing code-only advisory instead of duplicating it', async () => {
    const definition = profile(); missingAlternative(definition);
    expect(unresolved(await validate(definition, [0]))).toHaveLength(1);
  });
  it('retains a proved closed negative beside available-target metadata uncertainty', async () => {
    const definition = profile(); missingAlternative(definition); composite(definition);
    const issues = await validate(definition, [0, 4], ['neither', 'same']);
    expect(issues.filter(issue => issue.code === 'profile-slice-closed-unmatched')).toHaveLength(1);
    expect(unresolved(issues)).toHaveLength(1); expect((unresolved(issues)[0].details as Record<string, unknown> | undefined)?.unresolvedElementIndices).toEqual([1]);
  });
  it('keeps visible metadata uncertainty beside the retained known-match max policy', async () => {
    const definition = profile(); missingAlternative(definition); composite(definition);
    expect(unresolved(await validate(definition, [0, 0], ['same', 'same']))).toHaveLength(1);
  });
  it.each(['observations', 'observations/intraoperative'])('counts one known chain occurrence for required %s', async sliceName => {
    const definition = hierarchy(); definition.snapshot!.element.find(element => element.sliceName === sliceName)!.min = 1;
    const issues = await validate(definition, [0]); expect(cardinality(issues, 'min')).toHaveLength(0);
    expect(issues.some(issue => issue.code === 'profile-slice-ambiguous-match')).toBe(false);
  });
  it.each(['observations', 'observations/intraoperative'])('retains a proved chain maximum for %s', async sliceName => {
    const definition = hierarchy(); definition.snapshot!.element.find(element => element.sliceName === sliceName)!.max = '1';
    const maximum = cardinality(await validate(definition, [0, 0]), 'max');
    expect(maximum).toHaveLength(1); expect((maximum[0].details as Record<string, unknown> | undefined)?.sliceName).toBe(sliceName); expect((maximum[0].details as Record<string, unknown> | undefined)?.actual).toBe(2);
  });
  it('counts a proved common ancestor maximum beside ambiguous children', async () => {
    const definition = hierarchy(true); definition.snapshot!.element.find(element => element.sliceName === 'observations')!.max = '1';
    const issues = await validate(definition, [-1, -1]);
    expect(issues.filter(issue => issue.code === 'profile-slice-ambiguous-match')).toHaveLength(2);
    const maximum = cardinality(issues, 'max'); expect(maximum).toHaveLength(1);
    expect((maximum[0].details as Record<string, unknown> | undefined)?.sliceName).toBe('observations'); expect((maximum[0].details as Record<string, unknown> | undefined)?.actual).toBe(2);
  });
  it('does not double-count definite ancestor membership as possible membership', async () => {
    const definition = hierarchy(true); definition.snapshot!.element.find(element => element.sliceName === 'observations')!.min = 2;
    const minimum = cardinality(await validate(definition, [-1]), 'min');
    expect(minimum).toHaveLength(1); expect((minimum[0].details as Record<string, unknown> | undefined)?.actual).toBe(1);
  });
  it('retains proved root ordering beside child ambiguity', async () => {
    const definition = hierarchy(true), other = structuredClone(original.snapshot!.element.filter(element => element.id?.startsWith(`${elementPath}:diagnostic-conclusion`)));
    for (const element of other) if (element.sliceName) { element.min = 0; element.max = '*'; }
    definition.snapshot!.element.push(...other); slicing(definition).ordered = true;
    const issues = await validate(definition, [4, -1]);
    expect(issues.some(issue => issue.code === 'profile-slice-ordering-violation')).toBe(true);
    expect(issues.filter(issue => issue.code === 'profile-slice-ambiguous-match')).toHaveLength(1);
  });
  it('does not apply root order to unordered reslices within the same parent', async () => {
    const definition = hierarchy(); definition.snapshot!.element.find(element => element.sliceName === 'observations/intraoperative')!.type![0].targetProfile = [targets[1].url];
    slicing(definition).ordered = true;
    expect((await validate(definition, [-1, 0])).some(issue => issue.code === 'profile-slice-ordering-violation')).toBe(false);
  });
});
