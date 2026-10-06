import { describe, expect, it, vi } from 'vitest';
import { ComplexTypeValidator } from '../complex-type-validator';

describe('ComplexTypeValidator Attachment content', () => {
  const sdLoader = {
    loadProfile: vi.fn().mockResolvedValue(null),
  } as any;

  // `document` also names BackboneElements elsewhere, so only the element's
  // type tells an Attachment apart here.
  it('warns for a content-less attachment under an element name the walker cannot trust', async () => {
    const validator = new ComplexTypeValidator(sdLoader);

    const issues = await validator.validateComplexTypeSubElements(
      {
        extension: [{
          url: 'http://hl7.org/fhir/StructureDefinition/cqf-strengthOfRecommendation',
          valueCodeableConcept: { text: 'Strong' },
        }],
      },
      {
        id: 'RelatedArtifact.document',
        path: 'RelatedArtifact.document',
        type: [{ code: 'Attachment' }],
      },
      'PlanDefinition.action[0].documentation[0].document',
      'http://hl7.org/fhir/StructureDefinition/PlanDefinition',
    );

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'attachment-no-content',
        severity: 'warning',
        path: 'PlanDefinition.action[0].documentation[0].document',
      }),
    ]);
  });

  it('accepts an attachment that describes its content', async () => {
    const validator = new ComplexTypeValidator(sdLoader);

    const issues = await validator.validateComplexTypeSubElements(
      { contentType: 'application/pdf', title: 'Guideline' },
      {
        id: 'RelatedArtifact.document',
        path: 'RelatedArtifact.document',
        type: [{ code: 'Attachment' }],
      },
      'PlanDefinition.relatedArtifact[0].document',
      'http://hl7.org/fhir/StructureDefinition/PlanDefinition',
    );

    expect(issues.some(issue => issue.code === 'attachment-no-content')).toBe(false);
  });
});
