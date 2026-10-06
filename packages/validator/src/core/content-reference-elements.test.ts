import { describe, expect, it } from 'vitest';
import {
  expandContentReferenceElements,
  instanceElementPaths,
  loadContentReferenceSources,
} from './content-reference-elements';
import type { ElementDefinition, StructureDefinition } from './structure-definition-types';

describe('contentReference element expansion ownership', () => {
  it('does not reuse an expansion across independent calls', () => {
    const elements: ElementDefinition[] = [
      { id: 'Questionnaire.item', path: 'Questionnaire.item' },
      {
        id: 'Questionnaire.item.item',
        path: 'Questionnaire.item.item',
        contentReference: '#Questionnaire.item',
      },
    ];
    expect(expandContentReferenceElements(elements)).not.toContainEqual(expect.objectContaining({
      id: 'Questionnaire.item.item.linkId',
    }));

    elements.push({
      id: 'Questionnaire.item.linkId',
      path: 'Questionnaire.item.linkId',
    });

    expect(expandContentReferenceElements(elements)).toContainEqual(expect.objectContaining({
      id: 'Questionnaire.item.item.linkId',
      path: 'Questionnaire.item.item.linkId',
    }));
  });

  it('recurses into nested content only as deep as the instance goes', () => {
    const elements: ElementDefinition[] = [
      { id: 'Questionnaire.item', path: 'Questionnaire.item' },
      { id: 'Questionnaire.item.linkId', path: 'Questionnaire.item.linkId' },
      { id: 'Questionnaire.item.item', path: 'Questionnaire.item.item', contentReference: '#Questionnaire.item' },
    ];
    const questionnaire = {
      resourceType: 'Questionnaire',
      item: [{ linkId: '1', item: [{ linkId: '1.1', item: [{ linkId: '1.1.1', _linkId: {} }] }] }],
    };
    const paths = instanceElementPaths(questionnaire);

    expect(paths).toContain('Questionnaire.item.item.item.linkId');
    const expanded = expandContentReferenceElements(elements, undefined, paths).map(element => element.path);
    expect(expanded).toContain('Questionnaire.item.item.item.linkId');
    expect(expanded).not.toContain('Questionnaire.item.item.item.item.linkId');
    // A shallow instance, or none, gets the snapshot's own recursion points only.
    const shallow = instanceElementPaths({ resourceType: 'Questionnaire', item: [{ linkId: '1' }] });
    for (const instance of [shallow, undefined]) {
      expect(expandContentReferenceElements(elements, undefined, instance).map(element => element.path))
        .not.toContain('Questionnaire.item.item.item.linkId');
    }
  });

  it('takes an absolute reference to the base resource from the base, as the reference validator does', async () => {
    const base = 'http://hl7.org/fhir/StructureDefinition/Composition';
    const profile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/lab-composition',
      snapshot: { element: [
        { id: 'Composition.section', path: 'Composition.section' },
        { id: 'Composition.section.text', path: 'Composition.section.text', min: 1 },
        { id: 'Composition.section.section', path: 'Composition.section.section', contentReference: `${base}#Composition.section` },
      ] },
    } as StructureDefinition;
    const baseDefinition = {
      resourceType: 'StructureDefinition',
      url: base,
      snapshot: { element: [
        { id: 'Composition.section', path: 'Composition.section' },
        { id: 'Composition.section.text', path: 'Composition.section.text', min: 0 },
        { id: 'Composition.section.section', path: 'Composition.section.section', contentReference: '#Composition.section' },
      ] },
    } as StructureDefinition;
    const sources = await loadContentReferenceSources(profile, async url => (url === base ? baseDefinition : null));
    const nestedText = (expanded: ElementDefinition[], path: string) =>
      expanded.find(element => element.path === path)?.min;

    const instance = { resourceType: 'Composition', section: [{ section: [{ section: [{ title: 'x' }] }] }] };
    const expanded = expandContentReferenceElements(
      profile.snapshot!.element, undefined, instanceElementPaths(instance), sources,
    );
    expect(nestedText(expanded, 'Composition.section.section.text')).toBe(0);
    expect(nestedText(expanded, 'Composition.section.section.section.text')).toBe(0);
    // Without the base definition the profile's own element stands in.
    expect(nestedText(expandContentReferenceElements(profile.snapshot!.element), 'Composition.section.section.text'))
      .toBe(1);
  });

  it('resolves the absolute contentReference form emitted by profile snapshots', () => {
    const elements: ElementDefinition[] = [
      { id: 'QuestionnaireResponse.item', path: 'QuestionnaireResponse.item' },
      { id: 'QuestionnaireResponse.item.linkId', path: 'QuestionnaireResponse.item.linkId' },
      {
        id: 'QuestionnaireResponse.item.item',
        path: 'QuestionnaireResponse.item.item',
        contentReference:
          'http://hl7.org/fhir/StructureDefinition/QuestionnaireResponse#QuestionnaireResponse.item',
      },
    ];

    expect(expandContentReferenceElements(elements)).toContainEqual(expect.objectContaining({
      id: 'QuestionnaireResponse.item.item.linkId',
      path: 'QuestionnaireResponse.item.item.linkId',
    }));
  });

  it('does not copy slice-scoped constraints to the recursion point', () => {
    const elements: ElementDefinition[] = [
      { id: 'Parameters.parameter', path: 'Parameters.parameter' },
      { id: 'Parameters.parameter.value[x]', path: 'Parameters.parameter.value[x]' },
      {
        id: 'Parameters.parameter:status.value[x]',
        path: 'Parameters.parameter.value[x]',
        binding: { strength: 'required', valueSet: 'http://hl7.org/fhir/ValueSet/subscription-status' },
      },
      {
        id: 'Parameters.parameter.part',
        path: 'Parameters.parameter.part',
        contentReference: 'http://hl7.org/fhir/StructureDefinition/Parameters#Parameters.parameter',
      },
      {
        id: 'Parameters.parameter:status.part',
        path: 'Parameters.parameter.part',
        contentReference: 'http://hl7.org/fhir/StructureDefinition/Parameters#Parameters.parameter',
      },
    ];

    const expanded = expandContentReferenceElements(elements);

    expect(expanded).toContainEqual(expect.objectContaining({
      id: 'Parameters.parameter.part.value[x]',
    }));
    expect(expanded).not.toContainEqual(expect.objectContaining({
      binding: expect.objectContaining({ strength: 'required' }),
      path: 'Parameters.parameter.part.value[x]',
    }));
    expect(expanded.filter(element => element.id?.startsWith('Parameters.parameter:status.part.'))).toEqual([]);
  });
});
