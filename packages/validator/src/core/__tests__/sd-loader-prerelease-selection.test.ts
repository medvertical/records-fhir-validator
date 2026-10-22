import { describe, expect, it } from 'vitest';
import { selectExactProfile, selectUnversionedCandidate, type IndexedProfile, type PackageProfileIndex } from '../sd-loader-package-profile-index';

const url = 'https://example.test/Profile';
function candidate(version: string): IndexedProfile {
  return { sourceName: 'example.package#3.0.0', sd: { resourceType: 'StructureDefinition', url, version,
    fhirVersion: '4.0.1', type: 'Patient', name: 'Patient', status: 'draft', kind: 'resource', abstract: false } };
}
function index(versions: string[]): PackageProfileIndex {
  return { byUrl: new Map([[url, versions.map(candidate)]]), byVersionedUrl: new Map() };
}

describe('within-package prerelease selection', () => {
  it.each([['1.0.0-ballot', '2.0.0-ballot'], ['2.0.0-ballot', '1.0.0-ballot']])('selects the newest prerelease independent of file order (%s, %s)', (first, second) => {
    const profiles = index([first, second]);
    expect(selectExactProfile(profiles, url, undefined, 'R4')?.sd.version).toBe('2.0.0-ballot');
    expect(selectUnversionedCandidate(profiles, url, 'R4')?.sd.version).toBe('2.0.0-ballot');
  });
  it('keeps the release preferred over a newer ballot', () => {
    const profiles = index(['2.0.0-ballot', '1.0.0']);
    expect(selectExactProfile(profiles, url, undefined, 'R4')?.sd.version).toBe('1.0.0');
    expect(selectUnversionedCandidate(profiles, url, 'R4')?.sd.version).toBe('1.0.0');
  });
});
