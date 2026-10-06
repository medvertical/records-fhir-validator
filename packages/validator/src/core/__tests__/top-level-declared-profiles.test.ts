import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecordsValidator } from '../validator-engine';
import { createIsolatedConstraintStore, expectIsolatedConstraintProfilesLoaded, declaredProfileDefinitions, removeIsolatedConstraintStore } from './portable-core-constraint-profiles';

describe('top-level resources with several declared profiles', () => {
  let validator: RecordsValidator;
  let packageRoot: string;

  beforeAll(async () => {
    packageRoot = await createIsolatedConstraintStore(declaredProfileDefinitions());
    validator = new RecordsValidator({ packageCachePath: packageRoot, bundledProfilesPath: packageRoot,
      terminologyPackageDirectories: [], prewarmProfileSource: false, autoDownload: false, enableCaching: true, strictMode: false });
    await validator.waitForInitialization();
    await expectIsolatedConstraintProfilesLoaded(validator, declaredProfileDefinitions());
  }, 120_000);
  afterAll(async () => { await removeIsolatedConstraintStore(packageRoot); });

  it('validates every profile in meta.profile, not only the first', async () => {
    const observation = {
      resourceType: 'Observation',
      id: 'weight',
      meta: {
        // The base resource first, the constraining profile second — a common
        // server pattern the reference validator checks in full.
        profile: [
          'http://hl7.org/fhir/StructureDefinition/Observation',
          'http://hl7.org/fhir/StructureDefinition/bodyweight',
        ],
      },
      status: 'final',
      code: { text: 'weight' },
      subject: { reference: 'Patient/p' },
      effectiveDateTime: '2024-01-01',
      valueQuantity: { value: 70, unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg' },
    };

    const effectiveSettings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
    if (!effectiveSettings.packageDownload) throw new Error('Maintained R4 defaults must declare package download policy');
    effectiveSettings.packageDownload.autoDownload = false;
    effectiveSettings.profileSources = { simplifier: false, packageRegistry: false };
    effectiveSettings.terminologyServers = [];
    effectiveSettings.terminologyResolution = { ...effectiveSettings.terminologyResolution, strategy: 'local-only' };
    const result = await validator.validateAspects(observation, {
      aspects: ['structural', 'profile'],
      settings: effectiveSettings,
      fhirVersion: 'R4',
    });
    const issues = result.aspects.flatMap(aspect => aspect.issues);
    expect(issues.some(issue => ['profile-not-found', 'profile-not-resolved', 'validation-error'].includes(issue.code ?? ''))).toBe(false);
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', code: 'structural-cardinality-min', path: 'Observation.category' }));
    const errors = issues.filter(issue => issue.severity === 'error');

    expect(errors.some(issue => issue.profile === 'http://hl7.org/fhir/StructureDefinition/bodyweight'
      || String(issue.message).includes('bodyweight')
      || String(issue.path).startsWith('Observation.category'))).toBe(true);
  }, 120_000);
});
