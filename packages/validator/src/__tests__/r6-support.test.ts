/**
 * R6 end-to-end verification (gap C-C7).
 *
 * R6 (FHIR 6.0.x-ballot) has partial support: structure + FHIRPath run via the
 * R5 model (fhirpath.js ships no R6 context), terminology/profile/reference are
 * limited and surface a partial-support warning. These tests prove an R6
 * resource actually flows through the pure engine — previously R6 was declared
 * and routed but never exercised end-to-end.
 */
import { describe, expect, it } from 'vitest';
import { ReferenceValidator } from '../reference/reference-validator-refactored';
import { sdFHIRPathExecutor } from '../validators/sd-fhirpath-executor';
import type { StructureDefinition } from '../core/structure-definition-types';

describe('R6 reference validation', () => {
  it('emits the partial-support warning for an R6 resource', async () => {
    const issues = await new ReferenceValidator().validateInternal(
      { resourceType: 'Observation', id: 'o1', subject: { reference: 'Patient/p1' } },
      'Observation',
      'R6',
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'r6-reference-limited',
      severity: 'info',
      aspect: 'reference',
    }));
  });

  it('does not emit the R6 warning for an R4 resource', async () => {
    const issues = await new ReferenceValidator().validateInternal(
      { resourceType: 'Observation', id: 'o1', subject: { reference: 'Patient/p1' } },
      'Observation',
      'R4',
    );

    expect(issues.some(i => i.code?.startsWith('r6-'))).toBe(false);
  });
});

describe('R6 FHIRPath constraint evaluation (via R5 model)', () => {
  const patientProfile: StructureDefinition = {
    resourceType: 'StructureDefinition',
    url: 'http://example.org/StructureDefinition/r6-patient',
    name: 'R6Patient',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Patient',
    snapshot: {
      element: [
        {
          id: 'Patient',
          path: 'Patient',
          constraint: [{
            key: 'r6-active',
            severity: 'error',
            human: 'Patient must be active',
            expression: 'active = true',
          }],
        },
      ],
    },
  };

  it('flags a constraint violation on an R6 resource without crashing', async () => {
    const issues = await sdFHIRPathExecutor.execute({
      resource: { resourceType: 'Patient', id: 'inactive', active: false },
      resourceType: 'Patient',
      structureDef: patientProfile,
      fhirVersion: 'R6',
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'constraint-violation-r6-active',
    }));
  });

  it('passes a conforming R6 resource', async () => {
    const issues = await sdFHIRPathExecutor.execute({
      resource: { resourceType: 'Patient', id: 'active', active: true },
      resourceType: 'Patient',
      structureDef: patientProfile,
      fhirVersion: 'R6',
    });

    expect(issues.filter(i => i.code === 'constraint-violation-r6-active')).toHaveLength(0);
  });
});
