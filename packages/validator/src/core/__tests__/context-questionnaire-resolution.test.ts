import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setProfileSource } from '../../persistence';
import { resolveContextQuestionnaire } from '../context-questionnaire-resolution';
import { QuestionnaireContextRegistry } from '../questionnaire-context-registry';

describe('resolveContextQuestionnaire', () => {
  afterEach(() => {
    setProfileSource({});
  });

  it('resolves a versioned Questionnaire canonical from the tenant package source', async () => {
    const questionnaire = {
      resourceType: 'Questionnaire',
      id: 'phq-9',
      url: 'https://example.org/Questionnaire/phq-9',
      version: '2026.3.0',
      status: 'active',
    };
    const findCanonicalResource = vi.fn().mockResolvedValue(questionnaire);
    setProfileSource({ findCanonicalResource });

    const resolved = await resolveContextQuestionnaire(
      {
        resourceType: 'QuestionnaireResponse',
        questionnaire: `${questionnaire.url}|${questionnaire.version}`,
      },
      new QuestionnaireContextRegistry(),
      { organizationId: 7, serverId: 314, fhirVersion: 'R4' },
    );

    expect(resolved).toBe(questionnaire);
    expect(findCanonicalResource).toHaveBeenCalledWith(
      questionnaire.url,
      'Questionnaire',
      questionnaire.version,
      { organizationId: 7, serverId: 314, fhirVersion: 'R4' },
    );
  });

  it('falls back to a Questionnaire an installed IG package ships, examples included', async () => {
    const store = fs.mkdtempSync(path.join(os.tmpdir(), 'questionnaire-packages-'));
    const questionnaire = {
      resourceType: 'Questionnaire',
      id: 'phq9',
      url: 'http://example.org/fhir/ig/Questionnaire/phq9',
      version: '1.0.0',
      status: 'active',
    };
    const packageDir = path.join(store, 'example.ig#1.0.0', 'package');
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
      name: 'example.ig', version: '1.0.0', fhirVersions: ['4.0.1'],
    }));
    fs.writeFileSync(path.join(packageDir, 'Questionnaire-phq9.json'), JSON.stringify(questionnaire));
    setProfileSource({ packageDirectories: [store], findCanonicalResource: vi.fn().mockResolvedValue(null) });

    const example = { ...questionnaire, id: 'gad7', url: 'http://example.org/fhir/ig/Questionnaire/gad7' };
    fs.mkdirSync(path.join(packageDir, 'example'));
    fs.writeFileSync(path.join(packageDir, 'example', 'Questionnaire-gad7.json'), JSON.stringify(example));

    try {
      for (const expected of [questionnaire, example]) {
        await expect(resolveContextQuestionnaire(
          { resourceType: 'QuestionnaireResponse', questionnaire: expected.url },
          new QuestionnaireContextRegistry(),
          { organizationId: 7, serverId: 314, fhirVersion: 'R4' },
        )).resolves.toEqual(expected);
      }
      // The canonical's tail names a file only when it is a FHIR id.
      await expect(resolveContextQuestionnaire(
        { resourceType: 'QuestionnaireResponse', questionnaire: 'http://example.org/Questionnaire/..%2F..%2Fx' },
        new QuestionnaireContextRegistry(),
        { organizationId: 7, serverId: 314, fhirVersion: 'R4' },
      )).resolves.toBeUndefined();
    } finally {
      fs.rmSync(store, { recursive: true, force: true });
    }
  });

  it('rejects a host resource with a mismatching canonical identity', async () => {
    setProfileSource({
      findCanonicalResource: vi.fn().mockResolvedValue({
        resourceType: 'Questionnaire',
        url: 'https://example.org/Questionnaire/other',
      }),
    });

    await expect(resolveContextQuestionnaire(
      {
        resourceType: 'QuestionnaireResponse',
        questionnaire: 'https://example.org/Questionnaire/requested',
      },
      new QuestionnaireContextRegistry(),
      { organizationId: 7, serverId: 314, fhirVersion: 'R4' },
    )).resolves.toBeUndefined();
  });

  it('prefers a Questionnaire carried in the same Bundle over registry and package lookups', async () => {
    const questionnaireUrn = 'urn:uuid:bc52dbf4-fd67-52e3-ba75-731a76805872';
    const bundledQuestionnaire = { resourceType: 'Questionnaire', status: 'active' };
    const findCanonicalResource = vi.fn().mockResolvedValue(null);
    setProfileSource({ findCanonicalResource });
    const resolveBundleCanonical = vi.fn((canonical: string, resourceType: string) => (
      canonical === questionnaireUrn && resourceType === 'Questionnaire' ? bundledQuestionnaire : null
    ));

    const resolved = await resolveContextQuestionnaire(
      { resourceType: 'QuestionnaireResponse', questionnaire: questionnaireUrn },
      new QuestionnaireContextRegistry(),
      { organizationId: 7, serverId: 314, fhirVersion: 'R4' },
      resolveBundleCanonical,
    );

    expect(resolved).toBe(bundledQuestionnaire);
    expect(findCanonicalResource).not.toHaveBeenCalled();
  });

  it('falls back to the registry when the Bundle carries no matching Questionnaire', async () => {
    const registered = {
      resourceType: 'Questionnaire',
      url: 'https://example.org/Questionnaire/registered',
      status: 'active',
    };
    const registry = new QuestionnaireContextRegistry();
    registry.register(registered);

    const resolved = await resolveContextQuestionnaire(
      { resourceType: 'QuestionnaireResponse', questionnaire: registered.url },
      registry,
      { organizationId: 7, serverId: 314, fhirVersion: 'R4' },
      () => null,
    );

    expect(resolved).toBe(registered);
  });

  it('keeps a contained questionnaire reference with the response instead of the Bundle', async () => {
    const contained = { resourceType: 'Questionnaire', id: 'inline', status: 'active' };
    const resolveBundleCanonical = vi.fn(() => ({ resourceType: 'Questionnaire', status: 'draft' }));

    const resolved = await resolveContextQuestionnaire(
      { resourceType: 'QuestionnaireResponse', questionnaire: '#inline', contained: [contained] },
      new QuestionnaireContextRegistry(),
      { organizationId: 7, serverId: 314, fhirVersion: 'R4' },
      resolveBundleCanonical,
    );

    expect(resolved).toBe(contained);
    expect(resolveBundleCanonical).not.toHaveBeenCalled();
  });

  it('falls through a registered foreign edition to the actual matching host edition', async () => {
    const canonical = 'https://example.org/Questionnaire/registry-host-edition-control';
    const matching = { resourceType: 'Questionnaire', url: canonical, version: '1.0.0', status: 'active' };
    const foreign = { ...matching, version: '2.0.0' };
    const registry = new QuestionnaireContextRegistry();
    registry.register(foreign);
    const findCanonicalResource = vi.fn().mockResolvedValue(matching);
    setProfileSource({ findCanonicalResource });
    const context = { organizationId: 7, serverId: 314, fhirVersion: 'R4' as const };

    await expect(resolveContextQuestionnaire(
      { resourceType: 'QuestionnaireResponse', questionnaire: `${canonical}|1.0.0` },
      registry,
      context,
    )).resolves.toBe(matching);
    expect(findCanonicalResource).toHaveBeenCalledWith(canonical, 'Questionnaire', '1.0.0', context);
  });

  it('falls through a registered foreign edition to the matching installed package edition', async () => {
    const store = fs.mkdtempSync(path.join(os.tmpdir(), 'questionnaire-registry-fallback-'));
    const canonical = 'https://example.org/Questionnaire/registry-package-edition-control';
    const matching = { resourceType: 'Questionnaire', id: 'registry-package-edition-control', url: canonical, version: '1.0.0', status: 'active' };
    const foreign = { ...matching, version: '2.0.0' };
    const registry = new QuestionnaireContextRegistry();
    registry.register(foreign);
    const packageDir = path.join(store, 'example.registry-editions#1.0.0', 'package');
    fs.mkdirSync(path.join(packageDir, 'example'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
      name: 'example.registry-editions', version: '1.0.0', fhirVersions: ['4.0.1'],
    }));
    fs.writeFileSync(path.join(packageDir, 'example', 'Questionnaire-registry-package-edition-control.json'), JSON.stringify(matching));
    const findCanonicalResource = vi.fn().mockResolvedValue(null);
    setProfileSource({ packageDirectories: [store], findCanonicalResource });

    try {
      await expect(resolveContextQuestionnaire(
        { resourceType: 'QuestionnaireResponse', questionnaire: `${canonical}|1.0.0` },
        registry,
        { organizationId: 7, serverId: 314, fhirVersion: 'R4' },
      )).resolves.toEqual(matching);
      expect(findCanonicalResource).toHaveBeenCalledWith(canonical, 'Questionnaire', '1.0.0', {
        organizationId: 7, serverId: 314, fhirVersion: 'R4',
      });
    } finally {
      fs.rmSync(store, { recursive: true, force: true });
    }
  });

  it('keeps an unavailable requested edition unresolved with foreign registry and package bodies', async () => {
    const store = fs.mkdtempSync(path.join(os.tmpdir(), 'questionnaire-registry-unavailable-'));
    const canonical = 'https://example.org/Questionnaire/registry-unavailable-edition-control';
    const foreign = { resourceType: 'Questionnaire', id: 'registry-unavailable-edition-control', url: canonical, version: '2.0.0', status: 'active' };
    const registry = new QuestionnaireContextRegistry();
    registry.register(foreign);
    const packageDir = path.join(store, 'example.registry-unavailable#2.0.0', 'package');
    fs.mkdirSync(path.join(packageDir, 'example'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
      name: 'example.registry-unavailable', version: '2.0.0', fhirVersions: ['4.0.1'],
    }));
    fs.writeFileSync(path.join(packageDir, 'example', 'Questionnaire-registry-unavailable-edition-control.json'), JSON.stringify(foreign));
    const findCanonicalResource = vi.fn().mockResolvedValue(foreign);
    setProfileSource({ packageDirectories: [store], findCanonicalResource });

    try {
      await expect(resolveContextQuestionnaire(
        { resourceType: 'QuestionnaireResponse', questionnaire: `${canonical}|1.0.0` },
        registry,
        { organizationId: 7, serverId: 314, fhirVersion: 'R4' },
      )).resolves.toBeUndefined();
      expect(findCanonicalResource).toHaveBeenCalledWith(canonical, 'Questionnaire', '1.0.0', {
        organizationId: 7, serverId: 314, fhirVersion: 'R4',
      });
    } finally {
      fs.rmSync(store, { recursive: true, force: true });
    }
  });

  it('bounds registered questionnaire aliases with LRU eviction', () => {
    const registry = new QuestionnaireContextRegistry(2);
    registry.register({
      resourceType: 'Questionnaire',
      url: 'https://example.org/Questionnaire/first',
    });
    registry.register({
      resourceType: 'Questionnaire',
      url: 'https://example.org/Questionnaire/second',
    });
    expect(registry.get('https://example.org/Questionnaire/first')).not.toBeNull();

    registry.register({
      resourceType: 'Questionnaire',
      url: 'https://example.org/Questionnaire/third',
    });

    expect(registry.get('https://example.org/Questionnaire/second')).toBeNull();
    expect(registry.get('https://example.org/Questionnaire/first')).not.toBeNull();
    expect(registry.get('https://example.org/Questionnaire/third')).not.toBeNull();
  });

  // US Core 7.0.0 QuestionnaireResponse/hunger-vital-sign-example: US Core
  // 9.0.0 rewords the items of the Questionnaire it names without a version.
  it('reads an unversioned Questionnaire in the release of the IG profile the response declares', async () => {
    const store = fs.mkdtempSync(path.join(os.tmpdir(), 'questionnaire-releases-'));
    const url = 'http://hl7.org/fhir/us/core/Questionnaire/hunger-vital-sign-example';
    for (const version of ['7.0.0', '9.0.0']) {
      const packageDir = path.join(store, `hl7.fhir.us.core#${version}`, 'package');
      fs.mkdirSync(path.join(packageDir, 'example'), { recursive: true });
      fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
        name: 'hl7.fhir.us.core', version, fhirVersions: ['4.0.1'],
      }));
      fs.writeFileSync(path.join(packageDir, 'example', 'Questionnaire-hunger-vital-sign-example.json'), JSON.stringify({
        resourceType: 'Questionnaire', id: 'hunger-vital-sign-example', url, version, status: 'active',
      }));
    }
    setProfileSource({ packageDirectories: [store], findCanonicalResource: vi.fn().mockResolvedValue(null) });
    const resolveFor = (profile?: string) => resolveContextQuestionnaire(
      { resourceType: 'QuestionnaireResponse', questionnaire: url, ...(profile ? { meta: { profile: [profile] } } : {}) },
      new QuestionnaireContextRegistry(),
      { organizationId: 7, serverId: 314, fhirVersion: 'R4' },
    );

    try {
      await expect(resolveFor('http://hl7.org/fhir/us/core/StructureDefinition/us-core-questionnaireresponse|7.0.0'))
        .resolves.toMatchObject({ version: '7.0.0' });
      await expect(resolveFor()).resolves.toMatchObject({ version: '9.0.0' });
      // A profile from another IG says nothing about this Questionnaire's release.
      await expect(resolveFor('http://example.org/fhir/StructureDefinition/response|7.0.0'))
        .resolves.toMatchObject({ version: '9.0.0' });
    } finally {
      fs.rmSync(store, { recursive: true, force: true });
    }
  });
});

