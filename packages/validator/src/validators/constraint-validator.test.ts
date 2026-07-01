import { describe, it, expect, vi, beforeEach } from 'vitest';
import fhirpath from 'fhirpath';
import { ConstraintValidator } from './constraint-validator';
import { valueSetCache } from './valueset-cache';

describe('ConstraintValidator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    valueSetCache.clear();
  });

  it('skips reference constraints when element is absent', async () => {
    const validator = new ConstraintValidator();
    const evaluateSpy = vi.spyOn(fhirpath, 'evaluate');

    const resource = {
      resourceType: 'Patient',
      id: 'patient-1'
    };

    const elements = [
      {
        path: 'Patient.link.other',
        min: 1,
        constraint: [
          {
            key: 'ref-1',
            severity: 'error' as const,
            human: "SHALL have a contained resource if a local reference is provided",
            expression: "reference.startsWith('#').not() or (reference.substring(1).trace('url') in %rootResource.contained.id.trace('ids'))"
          }
        ]
      }
    ];

    const issues = await validator.validate(resource, elements as any, 'http://hl7.org/fhir/StructureDefinition/Patient');

    expect(issues).toEqual([]);
    expect(evaluateSpy).not.toHaveBeenCalled();
  });

  it('skips con-3 because CodeableConcept semantics are handled by the resource-specific validator', async () => {
    const validator = new ConstraintValidator();

    const issues = await validator.validate(
      {
        resourceType: 'Condition',
        id: 'encounter-diagnosis',
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'encounter-diagnosis',
          }],
        }],
      },
      [{
        path: 'Condition',
        constraint: [{
          key: 'con-3',
          severity: 'warning' as const,
          human: 'Condition.clinicalStatus SHALL be present if verificationStatus is not entered-in-error and category is problem-list-item',
          expression: "clinicalStatus.exists() or verificationStatus.coding.where(system='http://terminology.hl7.org/CodeSystem/condition-ver-status' and code = 'entered-in-error').exists() or category.select($this='problem-list-item').empty()",
        }],
      }] as any,
      'http://hl7.org/fhir/StructureDefinition/Condition',
    );

    expect(issues.find(issue => issue.ruleId === 'con-3')).toBeUndefined();
  });

  it('evaluates htmlChecks constraints through the narrative XHTML validator', async () => {
    const validator = new ConstraintValidator();

    const issues = await validator.validate(
      {
        resourceType: 'Patient',
        text: {
          status: 'generated',
          div: '<div xmlns="http://www.w3.org/1999/xhtml">ok</div>',
        },
      },
      [{
        path: 'Patient.text.div',
        constraint: [{
          key: 'txt-1',
          severity: 'error' as const,
          human: 'Narrative html checks',
          expression: 'htmlChecks()',
        }],
      }] as any,
      'http://hl7.org/fhir/StructureDefinition/Patient',
    );

    expect(issues.find(issue => issue.code === 'profile-constraint-evaluation-error')).toBeUndefined();
    expect(issues.find(issue => issue.ruleId === 'txt-1')).toBeUndefined();
    expect(validator.getDiagnostics().skippedConstraints.total).toBe(0);
  });

  it('reports htmlChecks failures as narrative XHTML issues', async () => {
    const validator = new ConstraintValidator();

    const issues = await validator.validate(
      {
        resourceType: 'Patient',
        text: {
          status: 'generated',
          div: '<div xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></div>',
        },
      },
      [{
        path: 'Patient.text.div',
        constraint: [{
          key: 'txt-1',
          severity: 'error' as const,
          human: 'Narrative html checks',
          expression: 'htmlChecks()',
        }],
      }] as any,
      'http://hl7.org/fhir/StructureDefinition/Patient',
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'narrative-forbidden-content',
      path: 'Patient.text.div',
      profile: 'http://hl7.org/fhir/StructureDefinition/Patient',
    }));
    expect(validator.getDiagnostics().skippedConstraints.total).toBe(0);
  });

  it('returns defensive copies of FHIRPath skip diagnostics and can clear them', async () => {
    const validator = new ConstraintValidator();

    const evaluateSpy = vi.spyOn(validator as any, 'evaluateFHIRPath').mockImplementation(() => {
      throw new Error('asynchronous function memberOf is not allowed');
    });

    await validator.validate(
      {
        resourceType: 'Patient',
        active: true,
      },
      [{
        path: 'Patient.active',
        constraint: [{
          key: 'async-only',
          severity: 'error' as const,
          human: 'Async-only function',
          expression: 'active.exists()',
        }],
      }] as any,
      'http://hl7.org/fhir/StructureDefinition/Patient',
    );
    evaluateSpy.mockRestore();

    const diagnostics = validator.getDiagnostics();
    diagnostics.skippedConstraints.total = 0;
    diagnostics.skippedConstraints.samples.length = 0;

    expect(validator.getDiagnostics().skippedConstraints.total).toBe(1);
    expect(validator.getDiagnostics().skippedConstraints.samples).toHaveLength(1);

    validator.clearDiagnostics();

    expect(validator.getDiagnostics().skippedConstraints).toMatchObject({
      total: 0,
      byConstraintKey: {},
      byProfile: {},
      samples: [],
    });
  });

  it('treats simple ValueSet in-exists constraints as CodeableConcept membership checks', async () => {
    const validator = new ConstraintValidator();
    const valueSetUrl = 'http://hl7.org/fhir/us/core/ValueSet/us-core-condition-category';
    valueSetCache.setValueSetFile(`${valueSetUrl}|R4`, {
      resourceType: 'ValueSet',
      url: valueSetUrl,
      compose: {
        include: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-category',
          concept: [
            { code: 'problem-list-item' },
            { code: 'encounter-diagnosis' },
          ],
        }],
      },
    } as any);

    const elements = [{
      path: 'Condition',
      constraint: [{
        key: 'us-core-1',
        severity: 'warning' as const,
        human: 'A code in Condition.category SHOULD be from US Core Condition Category Codes value set.',
        expression: `where(category in '${valueSetUrl}').exists()`,
      }],
    }];

    const validIssues = await validator.validate(
      {
        resourceType: 'Condition',
        id: 'encounter-diagnosis',
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'encounter-diagnosis',
          }],
        }],
      },
      elements as any,
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-condition',
    );

    expect(validIssues.find(issue => issue.ruleId === 'us-core-1')).toBeUndefined();

    const invalidIssues = await validator.validate(
      {
        resourceType: 'Condition',
        id: 'unsupported-category',
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'unsupported-category',
          }],
        }],
      },
      elements as any,
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-condition',
    );

    expect(invalidIssues).toContainEqual(expect.objectContaining({
      ruleId: 'us-core-1',
      code: 'profile-constraint-warning',
    }));
  });

  it('resolves fullUrl references from bundle context for resolve() constraints', async () => {
    const validator = new ConstraintValidator();
    const elements = [{
      path: 'Observation',
      constraint: [{
        key: 'obs-subject-active',
        severity: 'error' as const,
        human: 'Observation subject must resolve to an active Patient',
        expression: 'subject.resolve().where(active = true).exists()',
      }],
    }];
    const bundle = {
      resourceType: 'Bundle',
      entry: [{
        fullUrl: 'urn:uuid:patient-1',
        resource: { resourceType: 'Patient', id: 'p1', active: true },
      }],
    };

    const issues = await validator.validate(
      {
        resourceType: 'Observation',
        id: 'obs-1',
        subject: { reference: 'urn:uuid:patient-1' },
      },
      elements as any,
      'http://example.org/StructureDefinition/observation-subject-active',
      { bundle },
    );

    expect(issues.find(issue => issue.ruleId === 'obs-subject-active')).toBeUndefined();
  });

  it('reports resolve() constraints when the bundle target fails them', async () => {
    const validator = new ConstraintValidator();
    const elements = [{
      path: 'Observation',
      constraint: [{
        key: 'obs-subject-active',
        severity: 'error' as const,
        human: 'Observation subject must resolve to an active Patient',
        expression: 'subject.resolve().where(active = true).exists()',
      }],
    }];
    const bundle = {
      resourceType: 'Bundle',
      entry: [{
        fullUrl: 'urn:uuid:patient-1',
        resource: { resourceType: 'Patient', id: 'p1', active: false },
      }],
    };

    const issues = await validator.validate(
      {
        resourceType: 'Observation',
        id: 'obs-1',
        subject: { reference: 'urn:uuid:patient-1' },
      },
      elements as any,
      'http://example.org/StructureDefinition/observation-subject-active',
      { bundle },
    );

    expect(issues).toContainEqual(expect.objectContaining({
      ruleId: 'obs-subject-active',
      code: 'profile-constraint-violation',
    }));
  });

  it('does not leak bundle context across parallel validations on the same instance', async () => {
    const validator = new ConstraintValidator();
    const elements = [{
      path: 'Observation',
      constraint: [{
        key: 'obs-subject-active',
        severity: 'error' as const,
        human: 'Observation subject must resolve to an active Patient',
        expression: 'subject.resolve().where(active = true).exists()',
      }],
    }];
    const observation = {
      resourceType: 'Observation',
      id: 'obs-1',
      subject: { reference: 'urn:uuid:patient-1' },
    };
    const activeBundle = {
      resourceType: 'Bundle',
      entry: [{
        fullUrl: 'urn:uuid:patient-1',
        resource: { resourceType: 'Patient', id: 'p1', active: true },
      }],
    };
    const inactiveBundle = {
      resourceType: 'Bundle',
      entry: [{
        fullUrl: 'urn:uuid:patient-1',
        resource: { resourceType: 'Patient', id: 'p1', active: false },
      }],
    };

    const [activeIssues, inactiveIssues] = await Promise.all([
      validator.validate(
        observation,
        elements as any,
        'http://example.org/StructureDefinition/observation-subject-active',
        { bundle: activeBundle },
      ),
      validator.validate(
        observation,
        elements as any,
        'http://example.org/StructureDefinition/observation-subject-active',
        { bundle: inactiveBundle },
      ),
    ]);

    expect(activeIssues.find(issue => issue.ruleId === 'obs-subject-active')).toBeUndefined();
    expect(inactiveIssues).toContainEqual(expect.objectContaining({
      ruleId: 'obs-subject-active',
      code: 'profile-constraint-violation',
    }));
  });

  it('does not apply choice-type dateTime casts to Period values', async () => {
    const validator = new ConstraintValidator();

    const issues = await validator.validate(
      {
        resourceType: 'Observation',
        id: 'period-effective',
        effectivePeriod: {
          start: '2022-01-25T00:00:00-05:00',
          end: '2022-01-26T00:00:00-05:00',
        },
      },
      [{
        path: 'Observation.effective[x]',
        type: [{ code: 'dateTime' }, { code: 'Period' }],
        constraint: [{
          key: 'us-core-1',
          severity: 'error' as const,
          human: 'Datetime must be at least to day.',
          expression: '($this as dateTime).toString().length() >= 8',
        }],
      }] as any,
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-observation-lab',
    );

    expect(issues.find(issue => issue.ruleId === 'us-core-1')).toBeUndefined();
  });

  describe('PAT-1 constraint with empty backbone elements', () => {
    it('should evaluate constraints on empty contact backbone elements', async () => {
      const validator = new ConstraintValidator();

      // Patient with empty contact - PAT-1 should fail
      const resource = {
        resourceType: 'Patient',
        id: 'patient-empty-contact',
        name: [{ family: 'Test', given: ['Jane'] }],
        contact: [{}]  // Empty contact - PAT-1 violation!
      };

      // PAT-1: Contact SHALL have a name, telecom or organization
      const elements = [
        {
          path: 'Patient.contact',
          min: 0,
          type: [{ code: 'BackboneElement' }],
          constraint: [
            {
              key: 'pat-1',
              severity: 'error' as const,
              human: 'SHALL have a name, telecom or organization',
              expression: "name.exists() or telecom.exists() or organization.exists()"
            }
          ]
        }
      ];

      const issues = await validator.validate(
        resource,
        elements as any,
        'http://hl7.org/fhir/StructureDefinition/Patient'
      );

      // Should detect PAT-1 violation for the empty contact
      expect(issues.length).toBeGreaterThan(0);
      const pat1Issues = issues.filter(i => i.message?.includes('pat-1'));
      expect(pat1Issues.length).toBeGreaterThanOrEqual(1);
    });

    it('should not flag PAT-1 for valid contact with name', async () => {
      const validator = new ConstraintValidator();

      const resource = {
        resourceType: 'Patient',
        id: 'patient-valid-contact',
        name: [{ family: 'Test', given: ['Jane'] }],
        contact: [{ name: { family: 'Emergency Contact' } }]  // Valid contact with name
      };

      const elements = [
        {
          path: 'Patient.contact',
          min: 0,
          type: [{ code: 'BackboneElement' }],
          constraint: [
            {
              key: 'pat-1',
              severity: 'error' as const,
              human: 'SHALL have a name, telecom or organization',
              expression: "name.exists() or telecom.exists() or organization.exists()"
            }
          ]
        }
      ];

      const issues = await validator.validate(
        resource,
        elements as any,
        'http://hl7.org/fhir/StructureDefinition/Patient'
      );

      // Should NOT have PAT-1 violations
      const pat1Issues = issues.filter(i => i.message?.includes('pat-1'));
      expect(pat1Issues).toHaveLength(0);
    });

    it('should not flag PAT-1 when contact element is absent', async () => {
      const validator = new ConstraintValidator();

      const resource = {
        resourceType: 'Patient',
        id: 'patient-no-contact',
        name: [{ family: 'Test', given: ['Jane'] }]
        // No contact at all - should NOT trigger PAT-1
      };

      const elements = [
        {
          path: 'Patient.contact',
          min: 0,
          type: [{ code: 'BackboneElement' }],
          constraint: [
            {
              key: 'pat-1',
              severity: 'error' as const,
              human: 'SHALL have a name, telecom or organization',
              expression: "name.exists() or telecom.exists() or organization.exists()"
            }
          ]
        }
      ];

      const issues = await validator.validate(
        resource,
        elements as any,
        'http://hl7.org/fhir/StructureDefinition/Patient'
      );

      // Should NOT have any issues - contact is optional and absent
      expect(issues).toHaveLength(0);
    });

    it('resolves choice values inside repeating backbone elements', async () => {
      const validator = new ConstraintValidator();

      const resource = {
        resourceType: 'Observation',
        id: 'bp-panel',
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'vital-signs',
          }],
        }],
        component: [
          {
            code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] },
            valueQuantity: { value: 79, system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
          },
          {
            code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
            valueQuantity: { value: 93, system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
          },
        ],
      };

      const elements = [
        {
          path: 'Observation.component',
          min: 0,
          type: [{ code: 'BackboneElement' }],
          constraint: [
            {
              key: 'vs-3',
              severity: 'error' as const,
              human: 'If there is no a value a data absent reason must be present',
              expression: 'value.exists() or dataAbsentReason.exists()',
            },
          ],
        },
      ];

      const issues = await validator.validate(
        resource,
        elements as any,
        'http://hl7.org/fhir/StructureDefinition/vitalsigns',
      );

      expect(issues).toHaveLength(0);
    });

    it('fails root constraints whose FHIRPath result is a boolean collection containing false', async () => {
      const validator = new ConstraintValidator();

      const resource = {
        resourceType: 'Patient',
        id: 'mixed-names',
        name: [
          { given: ['Ada'] },
          { family: 'Lovelace' },
        ],
      };

      const elements = [
        {
          path: 'Patient',
          constraint: [
            {
              key: 'pat-name-given',
              severity: 'error' as const,
              human: 'Every name must have a given value',
              expression: 'name.select(given.exists())',
            },
          ],
        },
      ];

      const issues = await validator.validate(
        resource,
        elements as any,
        'http://example.org/StructureDefinition/patient-name-given',
      );

      expect(issues).toContainEqual(expect.objectContaining({
        ruleId: 'pat-name-given',
        severity: 'error',
      }));
    });
  });

  it('escalates warnings to errors in strict mode', async () => {
    const validator = new ConstraintValidator();

    const resource = {
      resourceType: 'Patient',
      id: 'patient-1',
      address: [{ country: 'INVALID_COUNTRY' }]
    };

    // Mock a root-level constraint with severity 'warning' (like dom-2)
    // Root-level constraints (path = resourceType) are always evaluated
    const elements = [
      {
        path: 'Patient',
        min: 0,
        constraint: [
          {
            key: 'test-warning-constraint',
            severity: 'warning' as const,
            human: 'Test warning constraint that always fails',
            expression: 'false'
          }
        ]
      }
    ];

    // Test WITHOUT strict mode - should be warning
    const issuesNormal = await validator.validate(
      resource,
      elements as any,
      'http://example.org/Profile',
      { strictMode: false }
    );

    expect(issuesNormal.length).toBe(1);
    expect(issuesNormal[0].code).toBe('profile-constraint-warning');

    // Test WITH strict mode - should be escalated to error
    const issuesStrict = await validator.validate(
      resource,
      elements as any,
      'http://example.org/Profile',
      { strictMode: true }
    );

    expect(issuesStrict.length).toBe(1);
    expect(issuesStrict[0].code).toBe('profile-constraint-violation');
    expect(issuesStrict[0].message).toContain('[escalated from warning in strict mode]');
  });
});
