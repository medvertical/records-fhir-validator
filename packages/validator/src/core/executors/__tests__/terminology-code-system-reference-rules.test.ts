import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CodeSystemReferenceLookupCache,
  validateCodeSystemReference,
} from '../terminology-code-system-reference-rules';
import { validateExternalCodeSystems } from '../terminology-external-code-system-rules';
import { setProfileSource } from '../../../persistence';
import { ValueSetCache } from '../../../validators/valueset-cache';
import { ValueSetValidator } from '../../../validators/valueset-validator';

describe('terminology CodeSystem reference rules', () => {
  afterEach(() => {
    setProfileSource({});
  });

  it('leaves a non-string Coding.system to structural type validation', async () => {
    await expect(
      validateCodeSystemReference(
        { system: { invalidType: true }, code: 'x' },
        'Observation.code.coding',
        0,
        true,
        'syntax',
        'R4',
      ),
    ).resolves.toEqual([]);
  });

  it('reports a relative Coding.system as an absolute-reference error and keeps resolution evidence separate', async () => {
    const coding = { system: 'Location1', code: 'Location' };

    const syntaxIssues = await validateCodeSystemReference(
      coding,
      'Measure.subjectCodeableConcept.coding',
      0,
      false,
      'syntax',
      'R4',
    );
    const resolutionIssues = await validateCodeSystemReference(
      coding,
      'Measure.subjectCodeableConcept.coding',
      0,
      false,
      'not-found',
      'R4',
    );

    expect(syntaxIssues).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'terminology-codesystem-url-not-absolute',
        path: 'Measure.subjectCodeableConcept.coding.system',
      }),
    );
    expect(resolutionIssues).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'terminology-codesystem-unresolvable',
        path: 'Measure.subjectCodeableConcept.coding.system',
      }),
    );
  });

  it('rejects a Coding.system that resolves to a ValueSet', async () => {
    const issues = await validateCodeSystemReference(
      { system: 'http://hl7.org/fhir/ValueSet/communication-category', code: 'alert' },
      'Communication.category[0].coding',
      0,
      true,
      'syntax',
      'R4',
    );

    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'terminology-coding-system-valueset',
      path: 'Communication.category[0].coding[0].system',
    }));
  });

  it('accepts a CodeSystem canonical that merely contains a ValueSet path segment', async () => {
    // R4 core's formatcodes ValueSet includes exactly this IHE CodeSystem URL.
    const coding = {
      system: 'http://ihe.net/fhir/ValueSet/IHE.FormatCode.codesystem',
      code: 'urn:ihe:iti:xds:2017:mimeTypeSufficient',
    };

    const issues = [
      ...await validateCodeSystemReference(coding, 'DocumentReference.content[0].format', 0, false, 'syntax', 'R4'),
      ...await validateCodeSystemReference(coding, 'DocumentReference.content[0].format', 0, false, 'not-found', 'R4'),
    ];

    expect(issues.filter(issue => issue.severity === 'error')).toEqual([]);
  });

  it('does not pass malformed Coding fields into CodeSystem resolution', async () => {
    const valueSetValidator = {
      validateCodeInCodeSystem: () => {
        throw new Error('must not be called for malformed Coding fields');
      },
    };

    await expect(
      validateExternalCodeSystems(
        { system: { invalidType: true }, code: 'x' },
        'Observation.code.coding',
        valueSetValidator,
        'R4',
      ),
    ).resolves.toEqual([]);
  });

  it('uses the tenant-scoped host package source before reporting an unknown canonical', async () => {
    const hasCodeSystem = vi.fn().mockResolvedValue(true);
    setProfileSource({ hasCodeSystem });

    const issues = await validateCodeSystemReference(
      {
        system: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-mtb/CodeSystem/mii-cs-mtb-follow-up-status',
        code: 'completed',
      },
      'Task.code.coding',
      0,
      false,
      'not-found',
      'R4',
      { organizationId: 7, serverId: 314, fhirVersion: 'R4' },
    );

    expect(issues).toEqual([]);
    expect(hasCodeSystem).toHaveBeenCalledWith(
      'https://www.medizininformatik-initiative.de/fhir/ext/modul-mtb/CodeSystem/mii-cs-mtb-follow-up-status',
      undefined,
      { organizationId: 7, serverId: 314, fhirVersion: 'R4' },
    );
  });

  it('uses the cache owned by the calling terminology executor', async () => {
    const cache = new ValueSetCache();
    const system = 'http://example.test/CodeSystem/owned';
    cache.setCodeSystem(system, {
      resourceType: 'CodeSystem',
      url: system,
      status: 'active',
      content: 'complete',
      concept: [{ code: 'A' }],
    });

    const issues = await validateCodeSystemReference(
      { system, code: 'A' },
      'Observation.code.coding',
      0,
      false,
      'not-found',
      'R4',
      undefined,
      cache,
    );

    expect(issues).toEqual([]);
  });

  it('does not treat a trusted publisher namespace as CodeSystem resolution evidence', async () => {
    const hasCodeSystem = vi.fn().mockResolvedValue(false);
    setProfileSource({ hasCodeSystem });
    const cache = new ValueSetCache();
    const definitionLookup = new ValueSetValidator(cache, undefined, []).getDefinitionLookup();
    expect(definitionLookup.packageLoader.getPackageDirectories()).toEqual([]);
    const issues = await validateCodeSystemReference(
      { system: 'http://fhir.de/CodeSystem/ask', code: '1234' },
      'Medication.ingredient.itemCodeableConcept.coding',
      0,
      false,
      'not-found',
      'R4',
      { organizationId: 7, serverId: 314, fhirVersion: 'R4' },
      cache,
      new CodeSystemReferenceLookupCache(),
      definitionLookup,
    );

    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'terminology-codesystem-unresolvable',
      path: 'Medication.ingredient.itemCodeableConcept.coding.system',
    }));
    expect(hasCodeSystem).toHaveBeenCalledOnce();
  });

  it('caches a tenant-scoped negative package lookup briefly before retrying it', async () => {
    vi.useFakeTimers();
    const hasCodeSystem = vi.fn().mockResolvedValue(false);
    setProfileSource({ hasCodeSystem });
    const coding = {
      system:
        'https://www.medizininformatik-initiative.de/fhir/modul-consent/CodeSystem/mii-cs-consent-version-modules',
      code: '2.16.840.1.113883.3.1937.777.24.2.184',
    };
    const context = {
      organizationId: 7,
      serverId: 314,
      fhirVersion: 'R4' as const,
    };
    const lookupCache = new CodeSystemReferenceLookupCache();

    await validateCodeSystemReference(
      coding,
      'Consent.category.coding',
      0,
      false,
      'not-found',
      'R4',
      context,
      undefined,
      lookupCache,
    );
    await validateCodeSystemReference(
      coding,
      'Consent.category.coding',
      0,
      false,
      'not-found',
      'R4',
      context,
      undefined,
      lookupCache,
    );
    expect(hasCodeSystem).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_001);
    await validateCodeSystemReference(
      coding,
      'Consent.category.coding',
      0,
      false,
      'not-found',
      'R4',
      context,
      undefined,
      lookupCache,
    );
    expect(hasCodeSystem).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
