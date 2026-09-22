import type { StructureDefinition } from '../../core/structure-definition-types.js';

export function testStructureDefinition(overrides: Partial<StructureDefinition>): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    url: 'http://example.org/StructureDefinition/test',
    name: 'TestProfile',
    status: 'draft',
    kind: 'resource',
    abstract: false,
    type: 'Observation',
    ...overrides,
  } as StructureDefinition;
}
