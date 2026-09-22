/**
 * Nested-cardinality guard regression tests.
 *
 * FHIR cardinality constraints on a nested element (e.g. `qualification.code`
 * min=1) only apply when the parent element is actually instantiated.
 * The validator used to fire `structural-required-element-missing` for
 * `qualification.code` on a Practitioner with no qualification at all —
 * an over-flag, since `qualification` itself is 0..* and its absence
 * already short-circuits the child cardinality rule.
 *
 * Regression source: fhir-test-cases `references::contained-invariant`
 * (score 0.25 → 0.34 after fix).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { recordsValidator } from '../../index';

const VALIDATOR_INITIALIZATION_TIMEOUT_MS = 120000;

const validateR4 = (resource: unknown, profileUrl?: string) =>
  recordsValidator.validateRequest({ resource, profileUrl, fhirVersion: 'R4' });

const PATIENT_WITH_PRACTITIONER_NO_QUALIFICATION = {
  resourceType: 'Patient',
  id: 'pat-1',
  contained: [
    {
      resourceType: 'Practitioner',
      id: 'p1',
      name: [{ text: 'Dr Malaprop' }],
      // no `qualification` — qualification.code must NOT be flagged as missing
    },
  ],
  generalPractitioner: [{ reference: '#p1' }],
};

describe('Nested cardinality guard', () => {
  beforeAll(async () => {
    await validateR4({ resourceType: 'Patient' }).catch(() => {});
  }, VALIDATOR_INITIALIZATION_TIMEOUT_MS);

  it('does not flag qualification.code as missing when qualification is absent', async () => {
    const issues = await validateR4(
      PATIENT_WITH_PRACTITIONER_NO_QUALIFICATION,
      undefined,
    );

    const falsePositive = issues.find(
      i =>
        (i.code === 'required-element-missing' || i.code === 'structural-required-element-missing') &&
        typeof i.path === 'string' &&
        i.path.toLowerCase().includes('qualification.code'),
    );
    expect(falsePositive).toBeUndefined();
  }, VALIDATOR_INITIALIZATION_TIMEOUT_MS);
});
