import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefaultValidationSettings, type ValidationIssue } from '@records-fhir/validation-types';
import type { RecordsValidator } from '../validator-engine.js';
import { createIsolatedCoreValidationFixture, expectOwnCoreProfilesResolved } from './isolated-core-validation-fixture.js';

describe('reference constraints across public execution paths', () => {
  let validator: RecordsValidator;
  let fixture: Awaited<ReturnType<typeof createIsolatedCoreValidationFixture>>;

  afterAll(async () => { await fixture?.dispose(); });
  const settings = createDefaultValidationSettings('R4');
  settings.packageDownload.autoDownload = false;
  settings.terminologyServers = [];
  settings.terminologyResolution.strategy = 'local-only';
  const aspects = ['structural', 'profile', 'invariant', 'reference'] as const;

  beforeAll(async () => {
    fixture = await createIsolatedCoreValidationFixture();
    validator = fixture.validator;
  }, 30_000);

  async function validate(resource: Record<string, unknown>, batch: boolean): Promise<ValidationIssue[]> {
    if (!batch) {
      const issues = await validator.validate(resource, undefined, 'R4', settings);
      expectOwnCoreProfilesResolved(issues); return issues;
    }
    const results = await validator.validateBatch([resource], { aspects: [...aspects], settings, fhirVersion: 'R4' });
    const result = results.get(resource);
    if (!result || Array.isArray(result)) throw new Error('Missing multi-aspect validation result');
    const issues = result.aspects.flatMap(aspect => aspect.issues);
    expectOwnCoreProfilesResolved(issues); return issues;
  }

  describe.each([false, true])('batch=%s', batch => {
    it('accepts an opaque relative URL on a standalone resource', async () => {
      const issues = await validate({ resourceType: 'Patient',
        managingOrganization: { reference: 'organization-example' },
      }, batch);
      expect(issues.filter(issue => ['error', 'fatal'].includes(issue.severity))).toEqual([]);
    });

    it('still rejects a malformed reference', async () => {
      const issues = await validate({ resourceType: 'Patient',
        managingOrganization: { reference: 'Organization/' },
      }, batch);
      expect(issues).toContainEqual(expect.objectContaining({
        severity: 'error', code: 'reference-invalid-format', path: 'Patient.managingOrganization.reference',
      }));
    });

    it('still reports a missing contained target', async () => {
      const issues = await validate({ resourceType: 'Patient',
        managingOrganization: { reference: '#missing' },
      }, batch);
      expect(issues).toContainEqual(expect.objectContaining({
        severity: 'error', code: 'reference-ref1-invariant',
      }));
    });

    it('requires a resolvable relative reference inside a Bundle', async () => {
      const issues = await validate({ resourceType: 'Bundle', type: 'collection', entry: [{
        fullUrl: 'https://example.org/fhir/Patient/patient-example',
        resource: { resourceType: 'Patient', id: 'patient-example',
          managingOrganization: { reference: 'organization-example' } },
      }] }, batch);
      expect(issues).toContainEqual(expect.objectContaining({
        severity: 'error', code: 'reference-invalid-bundle-relative',
      }));
    });
  });
});
