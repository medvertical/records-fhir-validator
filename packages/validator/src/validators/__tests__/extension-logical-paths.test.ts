import { describe, expect, it } from 'vitest';
import type { ElementDefinition, StructureDefinition } from '../../core/structure-definition-types';
import { namesElement, resolveLogicalPaths } from '../extension-logical-paths';

const CORE = 'http://hl7.org/fhir/StructureDefinition/';

function sd(type: string, base: string | null, elements: Array<Partial<ElementDefinition> & { path: string }>): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    url: `${CORE}${type}`,
    type,
    ...(base ? { baseDefinition: `${CORE}${base}` } : {}),
    snapshot: { element: [{ id: type, path: type }, ...elements.map(element => ({ id: element.path, ...element }))] },
  } as StructureDefinition;
}

const definitions: Record<string, StructureDefinition> = {
  PlanDefinition: sd('PlanDefinition', 'DomainResource', [
    { path: 'PlanDefinition.action', type: [{ code: 'BackboneElement' }] },
    { path: 'PlanDefinition.action.documentation', type: [{ code: 'RelatedArtifact' }] },
    { path: 'PlanDefinition.action.action', contentReference: '#PlanDefinition.action' },
  ]),
  Observation: sd('Observation', 'DomainResource', [
    { path: 'Observation.value[x]', type: [{ code: 'Quantity' }, { code: 'string' }] },
  ]),
  DomainResource: sd('DomainResource', 'Resource', []),
  Resource: sd('Resource', null, []),
  RelatedArtifact: sd('RelatedArtifact', 'Element', [{ path: 'RelatedArtifact.document', type: [{ code: 'Attachment' }] }]),
  Attachment: sd('Attachment', 'Element', []),
  Quantity: sd('Quantity', 'Element', []),
  BackboneElement: sd('BackboneElement', 'Element', []),
  Element: sd('Element', null, []),
};
const lookup = async (type: string) => definitions[type] ?? null;

describe('resolveLogicalPaths', () => {
  it('names an element by its instance path, its datatype and the datatype-rooted path', async () => {
    const paths = await resolveLogicalPaths('PlanDefinition', 'PlanDefinition.action.documentation.document', lookup);

    expect(paths).toEqual(expect.arrayContaining([
      'PlanDefinition.action.documentation.document',
      'RelatedArtifact.document',
      'Attachment',
      'Element',
    ]));
    expect(paths).not.toContain('PlanDefinition.action');
  });

  it('names a re-entered backbone element by its contentReference target', async () => {
    const paths = await resolveLogicalPaths('PlanDefinition', 'PlanDefinition.action.action', lookup);

    expect(paths).toEqual(expect.arrayContaining(['PlanDefinition.action.action', 'PlanDefinition.action']));
  });

  it('names a choice element by [x], ofType and its concrete name', async () => {
    const paths = await resolveLogicalPaths('Observation', 'Observation.valueQuantity', lookup) ?? [];

    expect(namesElement(paths, 'Observation.value[x]')).toBe(true);
    expect(namesElement(paths, 'Observation.valueQuantity')).toBe(true);
    expect(namesElement(paths, 'Quantity')).toBe(true);
    expect(namesElement(paths, 'Observation.code')).toBe(false);
    // NZ Base allows its information-source extension on `Patient.deceased`.
    expect(namesElement(paths, 'Observation.value')).toBe(true);
  });

  it('gives up on an element it cannot resolve', async () => {
    await expect(resolveLogicalPaths('PlanDefinition', 'PlanDefinition.unknown.child', lookup)).resolves.toBeNull();
    await expect(resolveLogicalPaths('Unknown', 'Unknown.child', lookup)).resolves.toBeNull();
  });
});
