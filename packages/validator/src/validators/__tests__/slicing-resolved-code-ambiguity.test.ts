import { describe, expect, it } from 'vitest';
import { SlicingValidator } from '../slicing-validator.js';
import type { StructureDefinition, SlicingDefinition } from '../../core/structure-definition-types.js';
import metadata from '../__fixtures__/slicing-resolved-code-mii-patho-metadata.json';

const original = metadata.report as unknown as StructureDefinition;
const definitions = metadata.targets as unknown as StructureDefinition[];
const names = ['intraoperative-observations', 'macroscopic-observations'];
const elementPath = 'DiagnosticReport.result';
type Code = { coding: Array<{ system: string; code: string }> };
const code = (index: number) => structuredClone(definitions[index].snapshot!.element.find(element => element.path === 'Observation.code')!.patternCodeableConcept) as Code;

function profile(): StructureDefinition {
  const result = structuredClone(original);
  result.snapshot!.element = result.snapshot!.element.filter(element =>
    !element.id?.startsWith(`${elementPath}:`) || names.some(name => element.id?.startsWith(`${elementPath}:${name}`)),
  );
  for (const element of result.snapshot!.element) if (element.path === elementPath) element.min = 0;
  return result;
}
const slicing = (definition: StructureDefinition) => definition.snapshot!.element.find(element => element.id === elementPath)!.slicing as SlicingDefinition;

async function check(definition: StructureDefinition, references: unknown[], values: ReadonlyMap<string, unknown>) {
  const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
  validator.setTypeProfileResolver(async canonical => structuredClone(definitions.find(target => target.url === canonical) ?? null));
  return validator.validateSlicing(references, elementPath, definition, reference => values.get(reference) ?? null, elementPath, 'R4');
}

describe('resolved-code slice evidence boundaries', () => {
  it.each(['unknown', 'resolve().identifier.value', 'resolve().code.coding'].flatMap(path =>
    (['open', 'openAtEnd'] as const).map(rules => ({ path, rules })),
  ))('retains blocked metadata policy outside code: $path/$rules', async ({ path, rules }) => {
    const definition = profile();
    slicing(definition).rules = rules;
    slicing(definition).ordered = true;
    slicing(definition).discriminator = [{ type: 'value', path }, { type: 'value', path: 'display' }];
    for (const element of definition.snapshot!.element) if (element.sliceName) element.type![0].targetProfile = [];
    for (const [index, name] of names.entries()) definition.snapshot!.element.push({
      id: `${elementPath}:${name}.display`, path: `${elementPath}.display`, min: 1, max: '1', fixedString: index === 0 ? 'first' : 'second',
    });
    const references = [{ reference: 'Observation/second', display: 'second' }, { reference: 'Observation/first', display: 'first' }];
    const values = new Map(references.map(reference => [reference.reference, { resourceType: 'Observation', code: code(4) }]));
    const issues = await check(definition, references, values);
    expect(issues.some(issue => (issue.details as Record<string, unknown> | undefined)?.reason === 'unresolved-discriminator-metadata')).toBe(true);
    expect(issues.some(issue => issue.code === 'profile-slice-ordering-violation')).toBe(false);
  });

  it.each((['two-original-patterns', 'same-target-pattern'] as const).flatMap(kind =>
    (['optional-one', 'both-required-one', 'duplicate-optional-max-one'] as const).map(cardinality => ({ kind, cardinality })),
  ))('reports actual multiple matches without arbitrary counts: $kind/$cardinality', async ({ kind, cardinality }) => {
    const definition = profile();
    slicing(definition).ordered = false;
    slicing(definition).rules = 'closed';
    if (kind === 'same-target-pattern') definition.snapshot!.element.find(element => element.sliceName === names[1])!.type![0].targetProfile = [definitions[0].url];
    for (const element of definition.snapshot!.element) if (element.sliceName) {
      element.min = cardinality === 'both-required-one' ? 1 : 0;
      element.max = '1';
    }
    const combined = code(0);
    if (kind === 'two-original-patterns') combined.coding.push(...code(1).coding);
    const references = Array.from({ length: cardinality === 'duplicate-optional-max-one' ? 2 : 1 }, (_, index) => ({ reference: `Observation/both-${index}` }));
    const values = new Map(references.map(reference => [reference.reference, { resourceType: 'Observation', code: combined }]));
    const issues = await check(definition, references, values);
    const ambiguity = issues.filter(issue => issue.code === 'profile-slice-ambiguous-match');
    expect(ambiguity).toHaveLength(references.length);
    for (const [index, issue] of ambiguity.entries()) {
      expect(issue.severity).toBe('error');
      expect(issue.path).toBe(`${elementPath}[${index}]`);
      expect((issue.details as Record<string, unknown> | undefined)?.sliceNames).toEqual(names);
    }
    expect(issues.some(issue => /slice-(?:min|max)-cardinality|slice-closed-unmatched/.test(issue.code!))).toBe(false);
  });

  it.each([0, 1])('keeps an individual original code uniquely assigned: $0', async index => {
    const definition = profile();
    slicing(definition).ordered = false;
    const references = [{ reference: 'Observation/one' }];
    const values = new Map([['Observation/one', { resourceType: 'Observation', code: code(index) }]]);
    const issues = await check(definition, references, values);
    expect(issues.some(issue => issue.severity === 'error' || issue.severity === 'fatal')).toBe(false);
  });

  it('keeps a proved maximum violation beside an ambiguous occurrence', async () => {
    const definition = profile();
    slicing(definition).ordered = false;
    const combined = code(0); combined.coding.push(...code(1).coding);
    const references = ['unique-a', 'both', 'unique-b'].map(id => ({ reference: `Observation/${id}` }));
    const values = new Map(references.map(reference => [reference.reference, {
      resourceType: 'Observation', code: reference.reference.endsWith('/both') ? combined : code(0),
    }]));
    const issues = await check(definition, references, values);
    expect(issues.filter(issue => issue.code === 'profile-slice-ambiguous-match')).toHaveLength(1);
    const maximum = issues.filter(issue => issue.code === 'profile-slice-max-cardinality');
    expect(maximum).toHaveLength(1);
    expect((maximum[0].details as Record<string, unknown> | undefined)?.sliceName).toBe(names[0]);
  });

  it('keeps a definitely absent required slice beside ambiguous other slices', async () => {
    const definition = profile();
    slicing(definition).ordered = false;
    const third = original.snapshot!.element.filter(element => element.id?.startsWith(`${elementPath}:diagnostic-conclusion`));
    definition.snapshot!.element.push(...structuredClone(third));
    const combined = code(0); combined.coding.push(...code(1).coding);
    const references = [{ reference: 'Observation/both' }];
    const values = new Map([['Observation/both', { resourceType: 'Observation', code: combined }]]);
    const issues = await check(definition, references, values);
    expect(issues.filter(issue => issue.code === 'profile-slice-ambiguous-match')).toHaveLength(1);
    const minimum = issues.filter(issue => issue.code === 'profile-slice-min-cardinality');
    expect(minimum).toHaveLength(1);
    expect((minimum[0].details as Record<string, unknown> | undefined)?.sliceName).toBe('diagnostic-conclusion');
  });
});
