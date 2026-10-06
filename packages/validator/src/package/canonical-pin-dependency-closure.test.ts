import { describe, expect, it } from 'vitest';
import {
  buildDependencyClosure,
  dependencyClosureEntries,
  selectStandInRelease,
} from './canonical-pin-dependency-closure';
import type { InstalledPackageManifest } from './canonical-pin-store';

function manifest(
  name: string,
  version: string,
  dependencies: Record<string, string> = {},
  storeRank = 0,
): InstalledPackageManifest {
  return {
    ref: { name, version },
    canonical: null,
    fhirVersions: ['4.0.1'],
    dependencies: Object.entries(dependencies).map(([dependency, release]) => ({
      name: dependency,
      version: release,
    })),
    storeRank,
  };
}

const isCore = (name: string) => name === 'hl7.fhir.r4.core';

describe('selectStandInRelease', () => {
  it('takes the declared release when it is installed', () => {
    expect(selectStandInRelease(['1.4.0', '1.5.4'], '1.4.0')).toBe('1.4.0');
  });

  it('does not substitute an unavailable literal patch', () => {
    expect(selectStandInRelease(['2.0.0', '4.0.3'], '2.0.4')).toBeNull();
    expect(selectStandInRelease(['2.0.0', '2.0.5', '2.1.4'], '2.0.4')).toBeNull();
  });

  it('keeps an unavailable literal opaque despite equally near patches', () => {
    expect(selectStandInRelease(['2.0.3', '2.0.5'], '2.0.4')).toBeNull();
  });

  it('never crosses a minor or major version', () => {
    expect(selectStandInRelease(['1.5.0', '1.5.4', '1.6.0'], '1.4.0')).toBeNull();
    expect(selectStandInRelease(['3.0.0'], '2.0.4')).toBeNull();
  });

  it('does not substitute the maturity of an unavailable literal', () => {
    expect(selectStandInRelease(['1.0.0-ballot', '1.0.1'], '1.0.0')).toBeNull();
    expect(selectStandInRelease(['1.0.0', '1.0.0-ballot2'], '1.0.0-ballot')).toBeNull();
  });

  it('reads a short or wildcard patch', () => {
    expect(selectStandInRelease(['1.4.0'], '1.4')).toBe('1.4.0');
    expect(selectStandInRelease(['1.4.1', '1.4.3', '1.4.4-ballot'], '1.4.x')).toBe('1.4.3');
  });

  it('matches versions that are not numeric releases only exactly', () => {
    expect(selectStandInRelease(['current'], 'current')).toBe('current');
    expect(selectStandInRelease(['1.0.0'], 'current')).toBeNull();
  });
});

describe('buildDependencyClosure', () => {
  it('orders the source first, then its dependencies breadth-first', () => {
    const closure = buildDependencyClosure([
      manifest('de.gematik.isip', '1.0.2', {
        'de.gematik.isik-basismodul': '2.0.4',
        'kbv.mio.ueberleitungsbogen': '1.0.0',
      }),
      manifest('de.gematik.isik-basismodul', '2.0.0', {
        'de.basisprofil.r4': '1.4.0',
        'hl7.fhir.r4.core': '4.0.1',
      }),
      manifest('de.gematik.isik-basismodul', '4.0.3', { 'de.basisprofil.r4': '1.5.2' }),
      manifest('kbv.mio.ueberleitungsbogen', '1.0.0', { 'de.basisprofil.r4': '1.3.2' }),
      manifest('de.basisprofil.r4', '1.3.2'),
      manifest('de.basisprofil.r4', '1.4.0'),
      manifest('de.basisprofil.r4', '1.5.4'),
      manifest('hl7.fhir.r4.core', '4.0.1'),
    ], { name: 'de.gematik.isip', version: '1.0.2' }, {}, isCore);

    expect(closure).toEqual([
      { name: 'de.gematik.isip', version: '1.0.2' },
      { name: 'kbv.mio.ueberleitungsbogen', version: '1.0.0' },
      { name: 'de.basisprofil.r4', version: '1.3.2' },
    ]);
  });

  it('ends a branch at a dependency with no installed stand-in', () => {
    const closure = buildDependencyClosure([
      manifest('example.ig', '1.0.0', { 'example.base': '2.0.0' }),
      manifest('example.base', '3.0.0', { 'example.deep': '1.0.0' }),
      manifest('example.deep', '1.0.0'),
    ], { name: 'example.ig', version: '1.0.0' }, {}, isCore);

    expect(closure).toEqual([{ name: 'example.ig', version: '1.0.0' }]);
  });

  it('resolves a host-pinned package only at its pinned release', () => {
    const manifests = [
      manifest('example.ig', '1.0.0', { 'example.base': '1.4.0' }),
      manifest('example.base', '1.4.0'),
      manifest('example.base', '1.5.4'),
    ];

    expect(buildDependencyClosure(manifests, { name: 'example.ig', version: '1.0.0' }, {
      'example.base': '1.5.4',
    }, isCore)).toEqual([
      { name: 'example.ig', version: '1.0.0' },
      { name: 'example.base', version: '1.5.4' },
    ]);
    expect(buildDependencyClosure(manifests, { name: 'example.ig', version: '1.0.0' }, {
      'example.base': '9.9.9',
    }, isCore)).toEqual([{ name: 'example.ig', version: '1.0.0' }]);
  });

  it('visits each installed release once, whatever cycle the manifests declare', () => {
    const closure = buildDependencyClosure([
      manifest('example.a', '1.0.0', { 'example.b': '1.0.0' }),
      manifest('example.b', '1.0.0', { 'example.a': '1.0.0' }),
    ], { name: 'example.a', version: '1.0.0' }, {}, isCore);

    expect(closure).toEqual([
      { name: 'example.a', version: '1.0.0' },
      { name: 'example.b', version: '1.0.0' },
    ]);
  });

  it('is empty when the source package is not installed', () => {
    expect(buildDependencyClosure([], { name: 'example.ig', version: '1.0.0' }, {}, isCore))
      .toEqual([]);
  });
});

describe('Authority-sensitive closure boundaries', () => {
  it.each([64, 65])('retains the exact boundary at %s packages', count => {
    const manifests = Array.from({ length: count }, (_, index) => manifest(`example.${index}`, '1.0.0',
      index + 1 < count ? { [`example.${index + 1}`]: '1.0.0' } : { 'example.0': '1.0.0' }));
    const entries = dependencyClosureEntries(manifests, { name: 'example.0', version: '1.0.0' }, {}, isCore);
    expect(entries.filter(entry => entry.status === 'available')).toHaveLength(64);
    expect(entries.filter(entry => entry.status === 'unavailable')).toEqual(count === 64 ? [] : [
      { status: 'unavailable', ref: { name: 'example.64', version: '1.0.0' }, cause: 'closure-limit' }]);
  });
  it('retains an unavailable earlier direct dependency before a later direct hit', () => {
    const entries = dependencyClosureEntries([manifest('example.source', '1.0.0', {
      'example.opaque': '1.0.4', 'example.target': '1.0.0' }), manifest('example.opaque', '1.0.0'),
      manifest('example.target', '1.0.0')], { name: 'example.source', version: '1.0.0' }, {}, isCore);
    expect(entries.map(entry => entry.status)).toEqual(['available', 'unavailable', 'available']);
    expect(entries[1]).toEqual({ status: 'unavailable', ref: { name: 'example.opaque', version: '1.0.4' }, cause: 'dependency-missing' });
  });
});
