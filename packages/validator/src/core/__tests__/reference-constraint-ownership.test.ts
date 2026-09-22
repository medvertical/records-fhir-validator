import { beforeAll, describe, expect, it } from 'vitest';
import { createDefaultValidationSettings, type ValidationIssue } from '@records-fhir/validation-types';
import { RecordsValidator } from '../validator-engine';

describe('reference constraints across public execution paths', () => {
  const validator = new RecordsValidator({ autoDownload: false, prewarmProfileSource: false });
  const settings = createDefaultValidationSettings('R4');
  settings.packageDownload.autoDownload = false;
  settings.terminologyServers = [];
  settings.terminologyResolution.strategy = 'local-only';
  const aspects = ['structural', 'profile', 'invariant', 'reference'] as const;

  beforeAll(async () => {
    await validator.waitForInitialization();
  }, 30_000);

  async function validate(resource: Record<string, unknown>, batch: boolean): Promise<ValidationIssue[]> {
    if (!batch) return validator.validate(resource, undefined, 'R4', settings);
    const results = await validator.validateBatch([resource], { aspects: [...aspects], settings, fhirVersion: 'R4' });
    const result = results.get(resource);
    if (!result || Array.isArray(result)) throw new Error('Missing multi-aspect validation result');
    return result.aspects.flatMap(aspect => aspect.issues);
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
