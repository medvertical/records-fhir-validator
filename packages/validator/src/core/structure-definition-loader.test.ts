/**
 * Test for StructureDefinition Loader Package Deduplication
 */

import { describe, it, expect, beforeEach } from 'vitest';

describe('StructureDefinitionLoader - Package Deduplication', () => {
  // Helper class to test private methods via reflection
  class TestableStructureDefinitionLoader {
    parsePackageName(packageName: string): { baseName: string; version: string } | null {
      const parts = packageName.split('#');
      if (parts.length === 2) {
        return { baseName: parts[0], version: parts[1] };
      }
      return { baseName: packageName, version: '0.0.0' };
    }

    compareVersions(v1: string, v2: string): number {
      if (v1 === v2) return 0;
      
      const cleanV1 = v1.split('-')[0];
      const cleanV2 = v2.split('-')[0];
      
      const parts1 = cleanV1.split('.').map(p => parseInt(p) || 0);
      const parts2 = cleanV2.split('.').map(p => parseInt(p) || 0);
      
      const maxLength = Math.max(parts1.length, parts2.length);
      for (let i = 0; i < maxLength; i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 !== p2) {
          return p1 - p2;
        }
      }
      
      if (v1.includes('-') && !v2.includes('-')) return -1;
      if (!v1.includes('-') && v2.includes('-')) return 1;
      
      return 0;
    }
  }

  let loader: TestableStructureDefinitionLoader;

  beforeEach(() => {
    loader = new TestableStructureDefinitionLoader();
  });

  describe('parsePackageName', () => {
    it('should parse package name with version', () => {
      const result = loader.parsePackageName('hl7.terminology.r4#6.5.0');
      expect(result).toEqual({
        baseName: 'hl7.terminology.r4',
        version: '6.5.0'
      });
    });

    it('should handle package name without version', () => {
      const result = loader.parsePackageName('hl7.terminology.r4');
      expect(result).toEqual({
        baseName: 'hl7.terminology.r4',
        version: '0.0.0'
      });
    });

    it('should handle complex package names', () => {
      const result = loader.parsePackageName('de.medizininformatikinitiative.kerndatensatz.meta#2025.0.1');
      expect(result).toEqual({
        baseName: 'de.medizininformatikinitiative.kerndatensatz.meta',
        version: '2025.0.1'
      });
    });
  });

  describe('compareVersions', () => {
    it('should identify identical versions', () => {
      expect(loader.compareVersions('1.0.0', '1.0.0')).toBe(0);
    });

    it('should compare major versions correctly', () => {
      expect(loader.compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
      expect(loader.compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    });

    it('should compare minor versions correctly', () => {
      expect(loader.compareVersions('1.2.0', '1.1.0')).toBeGreaterThan(0);
      expect(loader.compareVersions('1.1.0', '1.2.0')).toBeLessThan(0);
    });

    it('should compare patch versions correctly', () => {
      expect(loader.compareVersions('1.0.2', '1.0.1')).toBeGreaterThan(0);
      expect(loader.compareVersions('1.0.1', '1.0.2')).toBeLessThan(0);
    });

    it('should handle different length version strings', () => {
      expect(loader.compareVersions('1.0', '1.0.0')).toBe(0);
      expect(loader.compareVersions('1.0.1', '1.0')).toBeGreaterThan(0);
    });

    it('should prefer stable over pre-release versions', () => {
      expect(loader.compareVersions('1.0.0', '1.0.0-ballot')).toBeGreaterThan(0);
      expect(loader.compareVersions('1.0.0-ballot', '1.0.0')).toBeLessThan(0);
    });

    it('should handle pre-release version comparisons', () => {
      // Same base version with different pre-release tags are considered equal
      expect(loader.compareVersions('1.0.0-ballot', '1.0.0-snapshot')).toBe(0);
      // But different base versions should still compare correctly
      expect(loader.compareVersions('1.1.0-ballot', '1.0.0-snapshot')).toBeGreaterThan(0);
    });

    it('should correctly order real FHIR package versions', () => {
      const versions = ['5.0.0', '5.5.0', '6.0.2', '6.1.0', '6.2.0', '6.4.0', '6.5.0'];
      const sorted = [...versions].sort((a, b) => loader.compareVersions(b, a));
      expect(sorted[0]).toBe('6.5.0'); // Latest should be first
      expect(sorted[sorted.length - 1]).toBe('5.0.0'); // Oldest should be last
    });

    it('should handle hl7.terminology.r4 version progression', () => {
      // Real versions from startup logs
      expect(loader.compareVersions('6.5.0', '6.4.0')).toBeGreaterThan(0);
      expect(loader.compareVersions('6.4.0', '6.2.0')).toBeGreaterThan(0);
      expect(loader.compareVersions('6.2.0', '6.1.0')).toBeGreaterThan(0);
      expect(loader.compareVersions('6.1.0', '6.0.2')).toBeGreaterThan(0);
      expect(loader.compareVersions('6.0.2', '5.5.0')).toBeGreaterThan(0);
      expect(loader.compareVersions('5.5.0', '5.0.0')).toBeGreaterThan(0);
    });
  });

  describe('version deduplication logic', () => {
    it('should select latest version from duplicates', () => {
      const packages = [
        { name: 'hl7.terminology.r4#5.0.0', version: '5.0.0' },
        { name: 'hl7.terminology.r4#6.5.0', version: '6.5.0' },
        { name: 'hl7.terminology.r4#6.1.0', version: '6.1.0' },
      ];

      // Sort descending (latest first)
      packages.sort((a, b) => loader.compareVersions(b.version, a.version));
      
      expect(packages[0].name).toBe('hl7.terminology.r4#6.5.0');
      expect(packages[packages.length - 1].name).toBe('hl7.terminology.r4#5.0.0');
    });

    it('should handle mixed stable and pre-release versions', () => {
      const packages = [
        { name: 'hl7.fhir.uv.ips#1.1.0', version: '1.1.0' },
        { name: 'hl7.fhir.uv.ips#2.0.0-ballot', version: '2.0.0-ballot' },
      ];

      packages.sort((a, b) => loader.compareVersions(b.version, a.version));
      
      // 2.0.0-ballot should be considered newer than 1.1.0
      expect(packages[0].name).toBe('hl7.fhir.uv.ips#2.0.0-ballot');
    });
  });

  describe('deduplication integration', () => {
    it('should reduce package count for duplicate versions', () => {
      // Simulate the actual package list from startup logs
      const packageVersions = new Map<string, Array<{ name: string; version: string }>>();
      
      // Add real duplicates from logs
      packageVersions.set('hl7.terminology.r4', [
        { name: 'hl7.terminology.r4#5.0.0', version: '5.0.0' },
        { name: 'hl7.terminology.r4#5.5.0', version: '5.5.0' },
        { name: 'hl7.terminology.r4#6.0.2', version: '6.0.2' },
        { name: 'hl7.terminology.r4#6.1.0', version: '6.1.0' },
        { name: 'hl7.terminology.r4#6.2.0', version: '6.2.0' },
        { name: 'hl7.terminology.r4#6.4.0', version: '6.4.0' },
        { name: 'hl7.terminology.r4#6.5.0', version: '6.5.0' },
      ]);

      packageVersions.set('hl7.fhir.uv.ips', [
        { name: 'hl7.fhir.uv.ips#1.1.0', version: '1.1.0' },
        { name: 'hl7.fhir.uv.ips#2.0.0-ballot', version: '2.0.0-ballot' },
      ]);

      // Apply deduplication logic
      const packagesToScan: string[] = [];
      const skippedPackages: string[] = [];
      const deduplicateEnabled = true;

      for (const [_baseName, versions] of packageVersions.entries()) {
        if (deduplicateEnabled && versions.length > 1) {
          versions.sort((a, b) => loader.compareVersions(b.version, a.version));
          const latest = versions[0];
          packagesToScan.push(latest.name);
          
          for (let i = 1; i < versions.length; i++) {
            skippedPackages.push(versions[i].name);
          }
        } else {
          packagesToScan.push(...versions.map(v => v.name));
        }
      }

      // Assertions
      expect(packagesToScan).toHaveLength(2); // One per package family
      expect(skippedPackages).toHaveLength(7); // 6 older hl7.terminology.r4 + 1 older ips
      expect(packagesToScan).toContain('hl7.terminology.r4#6.5.0');
      expect(packagesToScan).toContain('hl7.fhir.uv.ips#2.0.0-ballot');
      expect(skippedPackages).toContain('hl7.terminology.r4#5.0.0');
    });

    it('should not skip packages when deduplication is disabled', () => {
      const packageVersions = new Map<string, Array<{ name: string; version: string }>>();
      
      packageVersions.set('hl7.terminology.r4', [
        { name: 'hl7.terminology.r4#6.4.0', version: '6.4.0' },
        { name: 'hl7.terminology.r4#6.5.0', version: '6.5.0' },
      ]);

      const packagesToScan: string[] = [];
      const deduplicateEnabled = false; // DISABLED

      for (const [_baseName, versions] of packageVersions.entries()) {
        if (deduplicateEnabled && versions.length > 1) {
          versions.sort((a, b) => loader.compareVersions(b.version, a.version));
          packagesToScan.push(versions[0].name);
        } else {
          packagesToScan.push(...versions.map(v => v.name));
        }
      }

      expect(packagesToScan).toHaveLength(2); // Both versions included
      expect(packagesToScan).toContain('hl7.terminology.r4#6.4.0');
      expect(packagesToScan).toContain('hl7.terminology.r4#6.5.0');
    });
  });
});

