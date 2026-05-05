/**
 * Snapshot Generator Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SnapshotGenerator } from '../snapshot-generator';
import { StructureDefinitionLoader } from '../structure-definition-loader';
import type { StructureDefinition, ElementDefinition } from '../structure-definition-types';

describe('SnapshotGenerator', () => {
  let sdLoader: StructureDefinitionLoader;
  let generator: SnapshotGenerator;
  
  beforeEach(() => {
    sdLoader = new StructureDefinitionLoader();
    generator = new SnapshotGenerator(sdLoader);
  });
  
  describe('generateSnapshot', () => {
    it('should return existing snapshot if present', async () => {
      const profileWithSnapshot: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://example.org/Profile',
        name: 'TestProfile',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Patient',
        snapshot: {
          element: [
            { id: 'Patient', path: 'Patient', min: 0, max: '*' } as ElementDefinition
          ]
        }
      };
      
      const snapshot = await generator.generateSnapshot(profileWithSnapshot);
      
      expect(snapshot).toEqual(profileWithSnapshot.snapshot!.element);
    });
    
    it('should handle profile with no base definition', async () => {
      const profileWithoutBase: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://example.org/Profile',
        name: 'TestProfile',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Patient',
        differential: {
          element: [
            { id: 'Patient', path: 'Patient', min: 0, max: '*' } as ElementDefinition
          ]
        }
      };
      
      const snapshot = await generator.generateSnapshot(profileWithoutBase);
      
      // Should return differential as fallback
      expect(snapshot).toEqual(profileWithoutBase.differential!.element);
    });
    
    it('should cache generated snapshots', async () => {
      const profile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://example.org/CachedProfile',
        name: 'CachedProfile',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Patient',
        baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient',
        differential: {
          element: [
            { id: 'Patient', path: 'Patient', min: 1, max: '1' } as ElementDefinition
          ]
        }
      };
      
      // First call
      const snapshot1 = await generator.generateSnapshot(profile, { cacheResults: true });
      
      // Second call (should use cache)
      const snapshot2 = await generator.generateSnapshot(profile, { cacheResults: true });
      
      expect(snapshot1).toEqual(snapshot2);
      
      const stats = generator.getCacheStats();
      expect(stats.size).toBeGreaterThan(0);
    });
    
    it('should clear cache', () => {
      generator.clearCache();
      
      const stats = generator.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.profiles).toEqual([]);
    });
  });
});

