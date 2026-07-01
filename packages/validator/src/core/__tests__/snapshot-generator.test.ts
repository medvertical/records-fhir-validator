/**
 * Snapshot Generator Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  afterEach(() => {
    vi.restoreAllMocks();
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
      vi.spyOn(sdLoader, 'loadProfile').mockResolvedValue({
        resourceType: 'StructureDefinition',
        url: 'http://hl7.org/fhir/StructureDefinition/Patient',
        name: 'Patient',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Patient',
        snapshot: {
          element: [
            { id: 'Patient', path: 'Patient', min: 0, max: '*' } as ElementDefinition,
          ],
        },
      } as StructureDefinition);

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

    it('keeps inherited slice cardinality separate from base element cardinality', async () => {
      const baseProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://example.org/Profile/BaseObservation',
        name: 'BaseObservation',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Observation',
        baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Observation',
        differential: {
          element: [
            {
              id: 'Observation.code.coding',
              path: 'Observation.code.coding',
              min: 1,
              slicing: {
                discriminator: [{ type: 'pattern', path: '$this' }],
                rules: 'open',
              },
            } as ElementDefinition,
            {
              id: 'Observation.code.coding:sct',
              path: 'Observation.code.coding',
              sliceName: 'sct',
              min: 0,
              max: '*',
              patternCoding: { system: 'http://snomed.info/sct' },
            } as ElementDefinition,
            {
              id: 'Observation.code.coding:ieee',
              path: 'Observation.code.coding',
              sliceName: 'ieee',
              min: 0,
              max: '*',
              patternCoding: { system: 'urn:iso:std:iso:11073:10101' },
            } as ElementDefinition,
          ],
        },
      };

      const childProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://example.org/Profile/CardiacOutput',
        name: 'CardiacOutput',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Observation',
        baseDefinition: baseProfile.url,
        differential: {
          element: [
            {
              id: 'Observation.code.coding',
              path: 'Observation.code.coding',
              min: 2,
            } as ElementDefinition,
            {
              id: 'Observation.code.coding:ieee',
              path: 'Observation.code.coding',
              sliceName: 'ieee',
              min: 1,
              max: '1',
              patternCoding: {
                system: 'urn:iso:std:iso:11073:10101',
                code: '150276',
              },
            } as ElementDefinition,
          ],
        },
      };

      const observationCore: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://hl7.org/fhir/StructureDefinition/Observation',
        name: 'Observation',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Observation',
        snapshot: {
          element: [
            { id: 'Observation', path: 'Observation', min: 0, max: '*' } as ElementDefinition,
            { id: 'Observation.code.coding', path: 'Observation.code.coding', min: 0, max: '*' } as ElementDefinition,
          ],
        },
      };

      vi.spyOn(sdLoader, 'loadProfile').mockImplementation(async (url: string) => {
        if (url === childProfile.baseDefinition) return baseProfile;
        if (url === baseProfile.baseDefinition) return observationCore;
        return null;
      });

      const snapshot = await generator.generateSnapshot(childProfile, { cacheResults: false });
      const baseCoding = snapshot.find(e => e.id === 'Observation.code.coding' && !e.sliceName);
      const ieeeSlice = snapshot.find(e => e.id === 'Observation.code.coding:ieee');

      expect(baseCoding?.min).toBe(2);
      expect(ieeeSlice?.min).toBe(1);
      expect(ieeeSlice?.patternCoding).toEqual({
        system: 'urn:iso:std:iso:11073:10101',
        code: '150276',
      });
    });

    it('merges nested slices by id instead of path and repeated slice name', async () => {
      const baseProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://example.org/Profile/BaseBloodPressure',
        name: 'BaseBloodPressure',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Observation',
        snapshot: {
          element: [
            { id: 'Observation', path: 'Observation', min: 0, max: '*' } as ElementDefinition,
            {
              id: 'Observation.component:SystolicBP.code.coding:loinc',
              path: 'Observation.component.code.coding',
              sliceName: 'loinc',
              min: 1,
              max: '1',
              patternCoding: { system: 'http://loinc.org', code: '8480-6' },
            } as ElementDefinition,
            {
              id: 'Observation.component:meanBP.code.coding:loinc',
              path: 'Observation.component.code.coding',
              sliceName: 'loinc',
              min: 1,
              max: '1',
              patternCoding: { system: 'http://loinc.org', code: '8478-0' },
            } as ElementDefinition,
          ],
        },
      };

      const childProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://example.org/Profile/LeftAtrialPressure',
        name: 'LeftAtrialPressure',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Observation',
        baseDefinition: baseProfile.url,
        differential: {
          element: [
            {
              id: 'Observation.component:SystolicBP.code.coding:loinc',
              path: 'Observation.component.code.coding',
              sliceName: 'loinc',
              min: 1,
              max: '1',
              patternCoding: { system: 'http://loinc.org', code: '60989-1' },
            } as ElementDefinition,
            {
              id: 'Observation.component:meanBP.code.coding:loinc',
              path: 'Observation.component.code.coding',
              sliceName: 'loinc',
              min: 1,
              max: '1',
              patternCoding: { system: 'http://loinc.org', code: '8399-8' },
            } as ElementDefinition,
          ],
        },
      };

      vi.spyOn(sdLoader, 'loadProfile').mockResolvedValue(baseProfile);

      const snapshot = await generator.generateSnapshot(childProfile, { cacheResults: false });
      const systolicLoinc = snapshot.find(e => e.id === 'Observation.component:SystolicBP.code.coding:loinc');
      const meanLoinc = snapshot.find(e => e.id === 'Observation.component:meanBP.code.coding:loinc');

      expect(systolicLoinc?.patternCoding).toEqual({ system: 'http://loinc.org', code: '60989-1' });
      expect(meanLoinc?.patternCoding).toEqual({ system: 'http://loinc.org', code: '8399-8' });
    });
    
    it('should clear cache', () => {
      generator.clearCache();
      
      const stats = generator.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.profiles).toEqual([]);
    });
  });
});
