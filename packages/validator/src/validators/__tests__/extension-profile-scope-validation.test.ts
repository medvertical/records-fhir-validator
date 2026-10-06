import { describe, expect, it, vi } from 'vitest';
import { validateProfileScopedExtensionInstances } from '../extension-profile-scope-validation';
import type { ExtensionDefinitionContext } from '../extension-definition-extractor';
import type { ExtensionDefinition, ExtensionValidationContext } from '../extension-types';

describe('validateProfileScopedExtensionInstances', () => {
  // Da Vinci PAS ClaimResponse: item.adjudication.extension:reviewAction.
  it('hands each extension its place in the instance', async () => {
    const url = 'http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewAction';
    const definition: ExtensionDefinition = { url, path: 'ClaimResponse.item.adjudication.extension', min: 0, max: '1' };
    const definitionContext: ExtensionDefinitionContext = {
      byUrl: new Map([[url, definition]]),
      byPath: new Map([['ClaimResponse.item.adjudication.extension', new Map([[url, [definition]]])]]),
      elements: [],
    };
    const reviewAction = { url, extension: [{ url: 'number', valueString: '1' }] };
    const resource = {
      resourceType: 'ClaimResponse',
      item: [
        { adjudication: [{ category: { text: 'submitted' } }] },
        { adjudication: [{ category: { text: 'submitted' } }, { extension: [{ url: 'http://example.org/other' }, reviewAction] }] },
      ],
    };
    const validateInstance = vi.fn(async () => []);

    await validateProfileScopedExtensionInstances({
      resource,
      definitionContext,
      context: {
        resource,
        profileUrl: 'http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claimresponse',
        getValueAtPath: (target: unknown, path: string) => path === 'ClaimResponse.item.adjudication'
          ? resource.item.flatMap(item => item.adjudication)
          : undefined,
      } as unknown as ExtensionValidationContext,
      validateInstance,
    });

    expect(validateInstance).toHaveBeenCalledWith(reviewAction, definition, 'extension', 'ClaimResponse.item[1].adjudication[1].extension');
  });
});
