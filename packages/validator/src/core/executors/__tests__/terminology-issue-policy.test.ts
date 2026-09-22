import { describe, expect, it, vi } from 'vitest';
import { validateCodeSystemReference } from '../terminology-code-system-reference-rules';
import { validateKnownLoincDisplays } from '../terminology-display-rules';
import { validateExternalCodeSystems } from '../terminology-external-code-system-rules';
import { validateUcumAtPath } from '../terminology-ucum-rules';

describe('terminology issue policy', () => {
  it('creates deterministic IDs for repeated external coding findings', async () => {
    const valuesetValidator = {
      validateCodeInCodeSystem: vi.fn(),
    };
    const coding = { code: 'yes' };

    const first = await validateExternalCodeSystems(
      coding,
      'Questionnaire.item[0].answerOption[0].valueCoding',
      valuesetValidator,
      'R4',
    );
    const second = await validateExternalCodeSystems(
      coding,
      'Questionnaire.item[0].answerOption[0].valueCoding',
      valuesetValidator,
      'R4',
    );

    expect(first.map((issue) => issue.id)).toEqual(second.map((issue) => issue.id));
    expect(first[0]).toMatchObject({
      resourceType: 'Questionnaire',
      validationMethod: 'terminology-validation',
    });
  });

  it('does not add a generic not-found warning to a precise canonical error', async () => {
    const coding = {
      system: 'http://hl7.org/fhir/observation-category',
      code: 'vital-signs',
    };

    const syntaxIssues = await validateCodeSystemReference(
      coding,
      'Observation.category.coding',
      0,
      true,
      'syntax',
      'R4',
    );
    const notFoundIssues = await validateCodeSystemReference(
      coding,
      'Observation.category.coding',
      0,
      true,
      'not-found',
      'R4',
    );

    expect(syntaxIssues.map((issue) => issue.code)).toEqual(['terminology-code-system-canonical-mismatch']);
    expect(notFoundIssues).toEqual([]);
  });

  it('walks cyclic resources safely and keeps LOINC findings deterministic', () => {
    const resource: Record<string, unknown> = {
      resourceType: 'Observation',
      code: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '8716-3',
            display: 'Wrong label',
          },
        ],
      },
    };
    resource.self = resource;

    const first = validateKnownLoincDisplays(resource);
    const second = validateKnownLoincDisplays(resource);

    expect(first).toHaveLength(1);
    expect(first[0]?.id).toBe(second[0]?.id);
    expect(first[0]?.path).toBe('Observation.code.coding[0].display');
  });

  it('normalizes harmless LOINC display differences consistently', () => {
    const issues = validateKnownLoincDisplays({
      resourceType: 'Observation',
      code: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '8716-3',
            display: '  VITAL   signs NOTE ',
          },
        ],
      },
    });

    expect(issues).toEqual([]);
  });

  it('accepts the authoritative LOINC display for the patient summary document', () => {
    const issues = validateKnownLoincDisplays({
      resourceType: 'Composition',
      type: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '60591-5',
            display: 'Patient summary Document',
          },
        ],
      },
    });

    expect(issues).toEqual([]);
  });

  it('handles malformed UCUM definitions and emits distinct stable array paths', () => {
    expect(
      validateUcumAtPath(
        { resourceType: 'Observation', valueQuantity: { code: 'invalid-unit' } },
        { type: {} },
        'Observation.value[x]',
      ),
    ).toEqual([]);

    const resource = {
      resourceType: 'Observation',
      referenceRange: [
        { low: { system: 'http://unitsofmeasure.org', code: 'invalid-unit' } },
        { low: { system: 'http://unitsofmeasure.org', code: 'invalid-unit' } },
      ],
    };
    const definition = { type: [{ code: 'SimpleQuantity' }] };
    const first = validateUcumAtPath(resource, definition, 'Observation.referenceRange.low');
    const second = validateUcumAtPath(resource, definition, 'Observation.referenceRange.low');

    expect(first.map((issue) => issue.id)).toEqual(second.map((issue) => issue.id));
    expect(new Set(first.map((issue) => issue.id)).size).toBe(2);
  });
});
