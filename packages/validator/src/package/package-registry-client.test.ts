import { afterEach, describe, expect, it, vi } from 'vitest';
import { PackageRegistryClient } from './package-registry-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PackageRegistryClient package detection', () => {
  it('maps Da Vinci PDEX Plan-Net canonicals to the Plan-Net package id', async () => {
    const client = new PackageRegistryClient();

    await expect(
      client.detectPackageForProfile('http://hl7.org/fhir/us/davinci-pdex-plan-net/StructureDefinition/plannet-PractitionerRole'),
    ).resolves.toBe('hl7.fhir.us.davinci-pdex-plan-net');
  });

  it('maps Da Vinci PDEX canonicals to the PDEX package id', async () => {
    const client = new PackageRegistryClient();

    await expect(
      client.detectPackageForProfile('http://hl7.org/fhir/us/davinci-pdex/StructureDefinition/pdex-device'),
    ).resolves.toBe('hl7.fhir.us.davinci-pdex');
  });

  it('maps Nictiz NL R4 canonicals to the nl-core package id', async () => {
    const client = new PackageRegistryClient();

    await expect(
      client.detectPackageForProfile('http://nictiz.nl/fhir/StructureDefinition/zib-BodyTemperature'),
    ).resolves.toBe('nictiz.fhir.nl.r4.nl-core');
  });

  it('maps Australian eRequesting canonicals before the AU base fallback', async () => {
    const client = new PackageRegistryClient();

    await expect(
      client.detectPackageForProfile('http://hl7.org.au/fhir/ereq/StructureDefinition/au-erequesting-displaysequence'),
    ).resolves.toBe('hl7.fhir.au.ereq');
  });

  it('maps HL7 Europe EPS canonicals to the R4 package id', async () => {
    const client = new PackageRegistryClient();

    await expect(
      client.detectPackageForProfile('http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps'),
    ).resolves.toBe('hl7.fhir.eu.eps.r4');
  });

  it('maps HL7 Europe base canonicals to the EU base package id', async () => {
    const client = new PackageRegistryClient();

    await expect(
      client.detectPackageForProfile('http://hl7.eu/fhir/base/StructureDefinition/flag-patient-eu-core'),
    ).resolves.toBe('hl7.fhir.eu.base');
  });
});

describe('PackageRegistryClient manifest cache', () => {
  it('bounds manifest cache size and refreshes recently used entries', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const packageId = url.split('/').pop() || 'unknown';
      return new Response(JSON.stringify({
        name: packageId,
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: packageId,
            version: '1.0.0',
            dist: { tarball: `https://example.test/${packageId}.tgz` },
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new PackageRegistryClient(1000, 2);

    await client.fetchPackageManifest('package-a');
    await client.fetchPackageManifest('package-b');
    await client.fetchPackageManifest('package-a');
    await client.fetchPackageManifest('package-c');

    expect(client.getCacheStats()).toEqual(expect.objectContaining({
      size: 2,
      maxSize: 2,
      packageIds: ['package-a', 'package-c'],
      hits: 1,
      misses: 3,
      evictions: 1,
      staleEvictions: 0,
    }));

    await client.fetchPackageManifest('package-b');

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
