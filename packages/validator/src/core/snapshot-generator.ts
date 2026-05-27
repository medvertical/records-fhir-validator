/**
 * Snapshot Generator
 * 
 * Generates complete snapshots from differential StructureDefinitions:
 * - Loads base profile definition
 * - Merges differential elements with base snapshot
 * - Resolves inheritance chain
 * - Applies constraints and restrictions
 * - Generates complete element list
 * 
 * Essential for validating profiles that only have differential
 */

import type { StructureDefinition, ElementDefinition } from './structure-definition-types';
import { StructureDefinitionLoader } from './structure-definition-loader';
import { logger } from '../logger';

// ============================================================================
// Types
// ============================================================================

export interface SnapshotGenerationOptions {
  includeBaseElements?: boolean;
  applyConstraints?: boolean;
  cacheResults?: boolean;
}

// ============================================================================
// Snapshot Generator
// ============================================================================

export class SnapshotGenerator {
  private sdLoader: StructureDefinitionLoader;
  private snapshotCache: Map<string, ElementDefinition[]> = new Map();

  constructor(sdLoader: StructureDefinitionLoader) {
    this.sdLoader = sdLoader;
  }

  /**
   * Generate snapshot from differential StructureDefinition
   */
  async generateSnapshot(
    profileSD: StructureDefinition,
    options: SnapshotGenerationOptions = {}
  ): Promise<ElementDefinition[]> {
    try {
      // If snapshot already exists, return it
      if (profileSD.snapshot && profileSD.snapshot.element && profileSD.snapshot.element.length > 0) {
        logger.debug(`[SnapshotGenerator] Snapshot already exists for ${profileSD.url}`);
        return profileSD.snapshot.element;
      }

      // Check cache
      if (options.cacheResults !== false && this.snapshotCache.has(profileSD.url)) {
        logger.debug(`[SnapshotGenerator] Using cached snapshot for ${profileSD.url}`);
        return this.snapshotCache.get(profileSD.url)!;
      }

      // Generate new snapshot
      logger.info(`[SnapshotGenerator] Generating snapshot for ${profileSD.url}`);

      // Load base profile
      const baseProfile = await this.loadBaseProfile(profileSD.baseDefinition);

      if (!baseProfile) {
        logger.warn(`[SnapshotGenerator] No base profile found for ${profileSD.url}, using differential only`);
        return profileSD.differential?.element || [];
      }

      // Get base snapshot
      let baseSnapshot = baseProfile.snapshot?.element || [];

      // If base profile also needs snapshot generation, generate it recursively
      if (baseSnapshot.length === 0 && baseProfile.differential) {
        baseSnapshot = await this.generateSnapshot(baseProfile, options);
      }

      // Merge differential with base snapshot
      const differential = profileSD.differential?.element || [];
      const snapshot = this.mergeElements(baseSnapshot, differential, profileSD.type);

      // Apply constraints if requested
      if (options.applyConstraints !== false) {
        this.applyConstraints(snapshot, differential);
      }

      // Cache result
      if (options.cacheResults !== false) {
        this.snapshotCache.set(profileSD.url, snapshot);
      }

      logger.info(`[SnapshotGenerator] Generated ${snapshot.length} elements for ${profileSD.url}`);
      return snapshot;

    } catch (error: unknown) {
      logger.error(`[SnapshotGenerator] Error generating snapshot for ${profileSD.url}:`, error);
      // Return differential as fallback
      return profileSD.differential?.element || [];
    }
  }

  /**
   * Load base profile StructureDefinition
   */
  private async loadBaseProfile(baseUrl?: string): Promise<StructureDefinition | null> {
    if (!baseUrl) {
      return null;
    }

    try {
      logger.debug(`[SnapshotGenerator] Loading base profile: ${baseUrl}`);
      const baseProfile = await this.sdLoader.loadProfile(baseUrl);
      return baseProfile;
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn(`[SnapshotGenerator] Failed to load base profile ${baseUrl}:`, err.message);
      return null;
    }
  }

  /**
   * Merge differential elements with base snapshot
   */
  private mergeElements(
    baseElements: ElementDefinition[],
    differentialElements: ElementDefinition[],
    _resourceType: string
  ): ElementDefinition[] {
    // Start with a copy of base elements
    const mergedElements: ElementDefinition[] = JSON.parse(JSON.stringify(baseElements));

    // Create a map of base elements by path for quick lookup
    const baseElementMap = new Map<string, number>();
    mergedElements.forEach((element, index) => {
      if (element.path && !element.sliceName && !this.isSliceScopedElement(element)) {
        baseElementMap.set(element.path, index);
      }
    });

    // Process each differential element
    for (const diffElement of differentialElements) {
      if (!diffElement.path) continue;

      const path = diffElement.path;
      const isSliceInstance = !!diffElement.sliceName;
      // Sub-elements defined *inside* a slice section carry the slice name
      // via their `id` (e.g. `Observation.referenceRange:Slice1.type`) even
      // though `sliceName` itself is only set on the top-level slice entry.
      // These sub-elements must NOT be merged into the base element at the
      // same path — doing so leaks slice-scoped cardinality / type
      // constraints to every occurrence at that path. Detect them by
      // looking for a `:` in the id segments.
      const isSliceScopedChild = this.isSliceScopedElement(diffElement);

      if (baseElementMap.has(path) && !isSliceInstance && !isSliceScopedChild) {
        // Element exists in base AND is not a named slice or slice-scoped
        // sub-element – merge properties.
        const index = baseElementMap.get(path)!;
        mergedElements[index] = this.mergeElementProperties(
          mergedElements[index],
          diffElement
        );
      } else if (isSliceInstance) {
        // Named slice — if a slice with the same path+sliceName already
        // exists in the base (inherited from a parent profile), merge the
        // differential properties into it so pattern/fixed/cardinality
        // refinements are not lost. Without this, the base slice (without
        // patterns) would shadow the derived one.
        const existingIdx = mergedElements.findIndex(
          e => e.path === path && e.sliceName === diffElement.sliceName
        );
        if (existingIdx >= 0) {
          mergedElements[existingIdx] = this.mergeElementProperties(
            mergedElements[existingIdx],
            diffElement
          );
        } else {
          mergedElements.push({ ...diffElement });
        }
      } else {
        // New element or slice-scoped sub-element – add to the snapshot
        // as a separate entry without touching the base.
        mergedElements.push({ ...diffElement });
        if (!baseElementMap.has(path)) {
          baseElementMap.set(path, mergedElements.length - 1);
        }
      }
    }

    // Sort elements by path for consistency
    mergedElements.sort((a, b) => {
      const pathA = a.path || '';
      const pathB = b.path || '';
      return pathA.localeCompare(pathB);
    });

    return mergedElements;
  }

  private isSliceScopedElement(element: ElementDefinition): boolean {
    return typeof element.id === 'string' && element.id.includes(':');
  }

  /**
   * Merge properties from differential element into base element
   */
  private mergeElementProperties(
    baseElement: ElementDefinition,
    diffElement: ElementDefinition
  ): ElementDefinition {
    const merged = { ...baseElement };

    // Merge cardinality (apply restrictions)
    if (diffElement.min !== undefined) {
      merged.min = Math.max(baseElement.min || 0, diffElement.min);
    }

    if (diffElement.max !== undefined) {
      merged.max = this.restrictMax(baseElement.max, diffElement.max);
    }

    // Merge types (apply restrictions)
    if (diffElement.type) {
      merged.type = this.mergeTypes(baseElement.type, diffElement.type);
    }

    // Merge constraints (add new constraints)
    if (diffElement.constraint) {
      merged.constraint = [
        ...(baseElement.constraint || []),
        ...diffElement.constraint
      ];
    }

    // Merge binding (differential overrides base)
    if (diffElement.binding) {
      merged.binding = diffElement.binding;
    }

    // Copy other properties from differential
    const propertiesToCopy = [
      'short', 'definition', 'comment', 'requirements',
      'mustSupport', 'isModifier', 'isSummary',
      'meaningWhenMissing', 'fixed', 'pattern',
      'example', 'minValue', 'maxValue', 'maxLength',
      'condition', 'mapping', 'slicing'
    ];

    for (const prop of propertiesToCopy) {
      if ((diffElement as unknown as Record<string, unknown>)[prop] !== undefined) {
        (merged as unknown as Record<string, unknown>)[prop] = (diffElement as unknown as Record<string, unknown>)[prop];
      }
    }

    // Copy type-specific pattern[x], fixed[x], minValue[x] and maxValue[x]
    // variants (patternCoding, fixedUri, minValueDate, etc.) that FHIR uses
    // for polymorphic ElementDefinition rules.
    const diffRecord = diffElement as unknown as Record<string, unknown>;
    const mergedRecord = merged as unknown as Record<string, unknown>;
    for (const key of Object.keys(diffRecord)) {
      const isPolymorphicRule =
        key.startsWith('pattern') ||
        key.startsWith('fixed') ||
        key.startsWith('minValue') ||
        key.startsWith('maxValue');

      if (isPolymorphicRule && key !== 'pattern' && key !== 'fixed' && key !== 'minValue' && key !== 'maxValue') {
        mergedRecord[key] = diffRecord[key];
      }
    }

    return merged;
  }

  /**
   * Restrict max cardinality
   */
  private restrictMax(baseMax?: string, diffMax?: string): string {
    if (!baseMax) return diffMax || '*';
    if (!diffMax) return baseMax;

    if (baseMax === '*') return diffMax;
    if (diffMax === '*') return baseMax;

    const baseNum = parseInt(baseMax, 10);
    const diffNum = parseInt(diffMax, 10);

    return Math.min(baseNum, diffNum).toString();
  }

  /**
   * Merge type definitions
   */
  private mergeTypes(
    baseTypes?: Array<{ code: string; profile?: string[]; targetProfile?: string[] }>,
    diffTypes?: Array<{ code: string; profile?: string[]; targetProfile?: string[] }>
  ): Array<{ code: string; profile?: string[]; targetProfile?: string[] }> {
    if (!baseTypes) return diffTypes || [];
    if (!diffTypes) return baseTypes;

    // Differential can restrict types
    const mergedTypes: Array<{ code: string; profile?: string[]; targetProfile?: string[] }> = [];

    for (const diffType of diffTypes) {
      // Check if this type code exists in base
      const baseType = baseTypes.find(bt => bt.code === diffType.code);

      if (baseType) {
        // Merge profiles
        const mergedType = { ...baseType };

        if (diffType.profile) {
          mergedType.profile = diffType.profile;
        }

        if (diffType.targetProfile) {
          mergedType.targetProfile = diffType.targetProfile;
        }

        mergedTypes.push(mergedType);
      } else {
        // New type (only allowed if base was open)
        mergedTypes.push(diffType);
      }
    }

    return mergedTypes.length > 0 ? mergedTypes : baseTypes;
  }

  /**
   * Apply constraints from differential to snapshot
   */
  private applyConstraints(
    snapshot: ElementDefinition[],
    differential: ElementDefinition[]
  ): void {
    // Build a map of differential constraints by element path. Skip slice
    // instances and slice-scoped sub-elements — their constraints only
    // apply to the matching slice target, not to the base path, and
    // applying them here re-leaks the same cardinality/type restrictions
    // that mergeElements carefully kept out of the base entry.
    const constraintMap = new Map<string, ElementDefinition>();

    for (const diffElement of differential) {
      if (!diffElement.path) continue;
      if (diffElement.sliceName) continue;
      if (typeof diffElement.id === 'string' && diffElement.id.includes(':')) continue;
      constraintMap.set(diffElement.path, diffElement);
    }

    // Apply constraints to snapshot elements. Only touch snapshot entries
    // whose `id` is *not* slice-scoped either — the slice-scoped copies
    // in the snapshot carry their own constraints from the differential.
    for (const snapElement of snapshot) {
      if (!snapElement.path) continue;
      if (snapElement.sliceName) continue;
      if (typeof snapElement.id === 'string' && snapElement.id.includes(':')) continue;

      const diffElement = constraintMap.get(snapElement.path);
      if (!diffElement) continue;

      // Apply min/max restrictions
      if (diffElement.min !== undefined && snapElement.min !== undefined) {
        snapElement.min = Math.max(snapElement.min, diffElement.min);
      }

      if (diffElement.max && snapElement.max) {
        snapElement.max = this.restrictMax(snapElement.max, diffElement.max);
      }

      // Apply mustSupport
      if (diffElement.mustSupport !== undefined) {
        snapElement.mustSupport = diffElement.mustSupport;
      }

      // Apply isModifier
      if (diffElement.isModifier !== undefined) {
        snapElement.isModifier = diffElement.isModifier;
      }
    }
  }

  /**
   * Clear snapshot cache
   */
  clearCache(): void {
    this.snapshotCache.clear();
    logger.debug('[SnapshotGenerator] Cache cleared');
  }

  /**
   * Remove a single entry from the snapshot cache by profile URL.
   * Used when an external profile with the same URL is re-registered
   * with different content (e.g. conformance test runner swapping SDs).
   */
  evict(profileUrl: string): boolean {
    return this.snapshotCache.delete(profileUrl);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; profiles: string[] } {
    return {
      size: this.snapshotCache.size,
      profiles: Array.from(this.snapshotCache.keys())
    };
  }
}
