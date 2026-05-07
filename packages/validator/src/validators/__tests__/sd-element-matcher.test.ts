import { describe, expect, it } from 'vitest';
import { sdElementMatcher } from '../sd-element-matcher';
import type { StructureDefinition } from '../../core/structure-definition-types';

describe('SDElementMatcher', () => {
  it('does not apply slice-scoped fixed values as global element rules', () => {
    const structureDef: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/PractitionerRoleProfile',
      name: 'PractitionerRoleProfile',
      status: 'draft',
      kind: 'resource',
      abstract: false,
      type: 'PractitionerRole',
      snapshot: {
        element: [
          { id: 'PractitionerRole', path: 'PractitionerRole' },
          { id: 'PractitionerRole.extension', path: 'PractitionerRole.extension' },
          { id: 'PractitionerRole.extension.url', path: 'PractitionerRole.extension.url' },
          {
            id: 'PractitionerRole.extension:qualification',
            path: 'PractitionerRole.extension',
            sliceName: 'qualification',
          },
          {
            id: 'PractitionerRole.extension:qualification.url',
            path: 'PractitionerRole.extension.url',
            fixedUri: 'http://hl7.org/fhir/us/davinci-pdex-plan-net/StructureDefinition/qualification',
          },
        ],
      },
    } as any;

    const resource = {
      resourceType: 'PractitionerRole',
      extension: [
        { url: 'http://example.org/other-extension' },
      ],
    };

    const result = sdElementMatcher.match(resource, structureDef);
    const urlMatch = result.matches.find(match => match.resourcePath === 'PractitionerRole.extension.url');

    expect(urlMatch?.element.fixedUri).toBeUndefined();
  });
});
