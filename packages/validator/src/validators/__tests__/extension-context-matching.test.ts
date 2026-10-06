import { describe, expect, it } from 'vitest';
import {
  checkExtensionContextUsage,
  extractExtensionContexts,
  type ExtensionUsageSite,
  type NormalizedExtensionContext,
} from '../extension-context-matching';
import type { StructureDefinition } from '../../core/structure-definition-types';

const rootSite = (resourceType: string): ExtensionUsageSite => ({
  resourceType,
  elementPath: resourceType,
  attachment: 'resource-root',
});

const elementSite = (resourceType: string, elementPath: string): ExtensionUsageSite => ({
  resourceType,
  elementPath,
  attachment: 'element',
});

const element = (expression: string): NormalizedExtensionContext =>
  ({ type: 'element', expression });

describe('extractExtensionContexts', () => {
  const baseSd = {
    resourceType: 'StructureDefinition',
    url: 'https://acme.test/StructureDefinition/x',
    name: 'X',
    status: 'active',
    kind: 'complex-type',
    abstract: false,
    type: 'Extension',
  } as StructureDefinition;

  it('reads the R4/R5 shape', () => {
    const contexts = extractExtensionContexts({
      ...baseSd,
      context: [{ type: 'element', expression: 'Patient' }],
    } as StructureDefinition);
    expect(contexts).toEqual([{ type: 'element', expression: 'Patient' }]);
  });

  it('reads the legacy DSTU3 shape', () => {
    const contexts = extractExtensionContexts({
      ...baseSd,
      contextType: 'resource',
      context: ['Patient', 'RelatedPerson'],
    } as StructureDefinition);
    expect(contexts).toEqual([
      { type: 'element', expression: 'Patient' },
      { type: 'element', expression: 'RelatedPerson' },
    ]);
  });

  it('returns null when no contexts are declared', () => {
    expect(extractExtensionContexts(baseSd)).toBeNull();
    expect(extractExtensionContexts({ ...baseSd, context: [] } as StructureDefinition)).toBeNull();
  });

  it('marks malformed entries as unknown instead of dropping them', () => {
    const contexts = extractExtensionContexts({
      ...baseSd,
      context: [{ type: 'element' }],
    } as StructureDefinition);
    expect(contexts).toEqual([{ type: 'unknown', expression: '' }]);
  });
});

describe('checkExtensionContextUsage — element contexts', () => {
  it('flags a resource root that no declared resource-type context covers', () => {
    const verdict = checkExtensionContextUsage(
      [element('CapabilityStatement'), element('CodeSystem'), element('Citation.citedArtifact')],
      rootSite('ArtifactAssessment'),
    );
    expect(verdict).toBe('violation');
  });

  it('allows a matching resource-type context', () => {
    expect(checkExtensionContextUsage([element('Patient')], rootSite('Patient'))).toBe('allowed');
  });

  it('allows Element and DomainResource wildcards', () => {
    expect(checkExtensionContextUsage([element('Element')], elementSite('Patient', 'Patient.name')))
      .toBe('allowed');
    expect(checkExtensionContextUsage([element('DomainResource')], rootSite('Observation')))
      .toBe('allowed');
  });

  it('rejects DomainResource for non-domain resource roots', () => {
    expect(checkExtensionContextUsage([element('DomainResource')], rootSite('Bundle')))
      .toBe('violation');
  });

  it('matches exact element paths but never claims a violation below the root', () => {
    expect(checkExtensionContextUsage(
      [element('Patient.name')],
      elementSite('Patient', 'Patient.name'),
    )).toBe('allowed');
    // contentReference re-entries rewrite the definition path (for example
    // Questionnaire.item.item), so a literal mismatch is not proof of misuse.
    expect(checkExtensionContextUsage(
      [element('Patient.address')],
      elementSite('Patient', 'Patient.name'),
    )).toBe('indeterminate');
    expect(checkExtensionContextUsage(
      [element('Questionnaire.item.answerOption')],
      elementSite('Questionnaire', 'Questionnaire.item.item.answerOption'),
    )).toBe('indeterminate');
  });

  it('matches choice elements through the [x] marker', () => {
    expect(checkExtensionContextUsage(
      [element('Observation.value[x]')],
      elementSite('Observation', 'Observation.valueQuantity'),
    )).toBe('allowed');
  });

  it('stays indeterminate when a choice stem lacks the [x] marker', () => {
    expect(checkExtensionContextUsage(
      [element('Observation.value')],
      elementSite('Observation', 'Observation.valueQuantity'),
    )).toBe('indeterminate');
  });

  it('stays indeterminate for possible datatype contexts at non-root sites', () => {
    // HumanName may be the element's datatype; v1 has no type resolution.
    expect(checkExtensionContextUsage(
      [element('HumanName')],
      elementSite('Patient', 'Patient.name'),
    )).toBe('indeterminate');
    expect(checkExtensionContextUsage(
      [element('Timing.repeat')],
      elementSite('MedicationRequest', 'MedicationRequest.dosageInstruction.timing.repeat'),
    )).toBe('indeterminate');
  });

  it('decides element contexts below the root once the element\'s logical paths are known', () => {
    const documentSite: ExtensionUsageSite = {
      ...elementSite('PlanDefinition', 'PlanDefinition.action.documentation.document'),
      logicalPaths: ['Attachment', 'Element', 'PlanDefinition.action.documentation.document', 'RelatedArtifact.document'],
    };
    const nestedActionSite: ExtensionUsageSite = {
      ...elementSite('PlanDefinition', 'PlanDefinition.action.action'),
      logicalPaths: ['BackboneElement', 'Element', 'PlanDefinition.action', 'PlanDefinition.action.action'],
    };

    expect(checkExtensionContextUsage([element('PlanDefinition.action')], documentSite)).toBe('violation');
    expect(checkExtensionContextUsage([element('Attachment')], documentSite)).toBe('allowed');
    expect(checkExtensionContextUsage([element('RelatedArtifact.document')], documentSite)).toBe('allowed');
    expect(checkExtensionContextUsage([element('PlanDefinition.action')], nestedActionSite)).toBe('allowed');
    // FHIRPath contexts may name a choice without [x]; they keep the literal comparison.
    expect(checkExtensionContextUsage([{ type: 'fhirpath', expression: 'PlanDefinition.action' }], documentSite))
      .toBe('indeterminate');
  });

  it('stays indeterminate for abstract canonical bases and logical models', () => {
    expect(checkExtensionContextUsage([element('CanonicalResource')], rootSite('ValueSet')))
      .toBe('indeterminate');
    expect(checkExtensionContextUsage(
      [element('http://hl7.org/fhir/StructureDefinition/Definition')],
      rootSite('PlanDefinition'),
    )).toBe('indeterminate');
  });
});

describe('checkExtensionContextUsage — fhirpath and extension contexts', () => {
  it('evaluates plain-path fhirpath contexts', () => {
    expect(checkExtensionContextUsage(
      [{ type: 'fhirpath', expression: 'Patient.name | Patient.address' }],
      elementSite('Patient', 'Patient.address'),
    )).toBe('allowed');
    expect(checkExtensionContextUsage(
      [{ type: 'fhirpath', expression: 'Patient.name' }],
      elementSite('Patient', 'Patient.telecom'),
    )).toBe('indeterminate');
  });

  it('skips fhirpath contexts with functions or filters', () => {
    expect(checkExtensionContextUsage(
      [{ type: 'fhirpath', expression: "Patient.address.where(use = 'home')" }],
      elementSite('Patient', 'Patient.telecom'),
    )).toBe('indeterminate');
  });

  it('matches extension contexts against the wrapping extension url', () => {
    const contexts: NormalizedExtensionContext[] = [
      { type: 'extension', expression: 'https://acme.test/StructureDefinition/parent' },
    ];
    expect(checkExtensionContextUsage(contexts, {
      resourceType: 'Patient',
      elementPath: 'Patient.extension',
      attachment: 'nested-extension',
      parentExtensionUrl: 'https://acme.test/StructureDefinition/parent',
    })).toBe('allowed');
    expect(checkExtensionContextUsage(contexts, rootSite('Patient'))).toBe('violation');
  });

  it('stays indeterminate for element contexts at nested-extension sites', () => {
    expect(checkExtensionContextUsage(
      [element('Condition.bodySite')],
      {
        resourceType: 'Patient',
        elementPath: 'Patient.extension',
        attachment: 'nested-extension',
        parentExtensionUrl: 'https://acme.test/StructureDefinition/parent',
      },
    )).toBe('indeterminate');
  });

  it('treats unknown-shaped contexts as indeterminate', () => {
    expect(checkExtensionContextUsage(
      [element('CodeSystem'), { type: 'unknown', expression: '' }],
      rootSite('Patient'),
    )).toBe('indeterminate');
  });
});
