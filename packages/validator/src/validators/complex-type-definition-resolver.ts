import { BoundedLruCache } from '../cache/bounded-lru-cache.js';
import type { StructureDefinitionLoader } from '../core/structure-definition-loader.js';
import type {
  ElementDefinition,
  StructureDefinition,
} from '../core/structure-definition-types.js';
import {
  isPrimitiveType,
  mergeElementConstraints,
} from '../core/executors/structural-executor-helpers.js';
import { logger } from '../logger.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';

type FhirVersion = 'R4' | 'R5' | 'R6';

const MAX_TYPE_DEFINITION_CACHE_ENTRIES = 128;
const MAX_EFFECTIVE_ELEMENTS_CACHE_ENTRIES = 1024;

export class ComplexTypeDefinitionResolver {
  private readonly typeDefinitionCache = new BoundedLruCache<
    string,
    Promise<StructureDefinition | null>
  >(MAX_TYPE_DEFINITION_CACHE_ENTRIES);
  private readonly effectiveElementsCache = new BoundedLruCache<
    string,
    Promise<Map<string, ElementDefinition> | null>
  >(MAX_EFFECTIVE_ELEMENTS_CACHE_ENTRIES);
  private readonly profileCacheIds = new WeakMap<StructureDefinition, number>();
  private nextProfileCacheId = 1;

  constructor(private readonly sdLoader: StructureDefinitionLoader) {}

  async loadTypeDefinition(
    typeCode: string,
    fhirVersion: FhirVersion = 'R4',
  ): Promise<StructureDefinition | null> {
    const key = `${fhirVersion}|${typeCode}`;
    let promise = this.typeDefinitionCache.get(key);
    if (!promise) {
      promise = this.sdLoader
        .loadProfile(`http://hl7.org/fhir/StructureDefinition/${typeCode}`, fhirVersion)
        .then(sd => sd?.snapshot?.element ? sd : null)
        .catch(error => {
          logger.debug(
            `[ComplexTypeValidator] Could not load base StructureDefinition for ${typeCode}`,
            validationFailureMetadata(error),
          );
          return null;
        });
      this.typeDefinitionCache.set(key, promise);
      void promise.then(result => {
        // A missing definition may become available after a package install or
        // a transient source failure. Successful definitions remain cached.
        if (!result) this.typeDefinitionCache.delete(key);
      });
    }
    return promise;
  }

  async buildEffectiveElements(
    typeCode: string,
    basePath: string,
    parentStructureDef?: StructureDefinition,
    fhirVersion: FhirVersion = 'R4',
  ): Promise<Map<string, ElementDefinition> | null> {
    const cacheKey = this.getEffectiveElementsCacheKey(
      typeCode,
      basePath,
      parentStructureDef,
      fhirVersion,
    );
    let promise = this.effectiveElementsCache.get(cacheKey);
    if (!promise) {
      promise = this.buildEffectiveElementsUncached(
        typeCode,
        basePath,
        parentStructureDef,
        fhirVersion,
      );
      this.effectiveElementsCache.set(cacheKey, promise);
      void promise.then(result => {
        if (!result) this.effectiveElementsCache.delete(cacheKey);
      });
    }
    return promise;
  }

  async resolveMatchingType(
    value: unknown,
    types: ElementDefinition['type'],
    fhirVersion: FhirVersion = 'R4',
  ): Promise<{ code: string } | undefined> {
    if (!types?.length) return undefined;
    if (types.length === 1) return types[0];

    const complexCandidates = types.filter(type => !isPrimitiveType(type.code));
    if (complexCandidates.length === 0) return types[0];
    if (complexCandidates.length === 1) return complexCandidates[0];

    const valueKeys = value && typeof value === 'object' ? Object.keys(value) : [];
    if (valueKeys.length === 0) return complexCandidates[0];

    let bestMatch = complexCandidates[0];
    let maxMatches = -1;
    for (const type of complexCandidates) {
      const definition = await this.loadTypeDefinition(type.code, fhirVersion);
      if (!definition?.snapshot?.element) continue;

      const validKeys = new Set(definition.snapshot.element.flatMap(element => {
        const parts = element.path.split('.');
        return parts.length === 2 && parts[0] === type.code ? [parts[1]] : [];
      }));
      const matchCount = valueKeys.filter(key => validKeys.has(key)).length;
      logger.debug('[ComplexTypeValidator] Type candidate evaluated', {
        matchCount,
        valueKeyCount: valueKeys.length,
      });
      if (matchCount > maxMatches) {
        maxMatches = matchCount;
        bestMatch = type;
      }
    }

    logger.debug('[ComplexTypeValidator] Resolved complex type', {
      candidateCount: types.length,
    });
    return bestMatch;
  }

  private async buildEffectiveElementsUncached(
    typeCode: string,
    basePath: string,
    parentStructureDef?: StructureDefinition,
    fhirVersion: FhirVersion = 'R4',
  ): Promise<Map<string, ElementDefinition> | null> {
    const baseTypeDef = await this.loadTypeDefinition(typeCode, fhirVersion);
    if (!baseTypeDef?.snapshot?.element) {
      logger.debug(`[ComplexTypeValidator] No base StructureDefinition found for type: ${typeCode}`);
      return null;
    }

    const effective = new Map<string, ElementDefinition>();
    for (const element of baseTypeDef.snapshot.element) {
      effective.set(element.path, { ...element });
    }
    for (const [typePath, profileElement] of this.extractProfileConstraints(
      typeCode,
      basePath,
      parentStructureDef,
    )) {
      const base = effective.get(typePath);
      if (base) {
        effective.set(typePath, mergeElementConstraints(base, profileElement));
      } else {
        const relativePath = typePath.substring(typeCode.length + 1);
        if (!relativePath.includes('.')) {
          effective.set(typePath, { ...profileElement, path: typePath });
        }
      }
    }
    return effective;
  }

  private getEffectiveElementsCacheKey(
    typeCode: string,
    basePath: string,
    parentStructureDef: StructureDefinition | undefined,
    fhirVersion: FhirVersion,
  ): string {
    const parentKey = parentStructureDef ? this.getProfileCacheId(parentStructureDef) : 'base';
    return `${fhirVersion}|${typeCode}|${parentKey}|${basePath.replace(/\[\d+\]/g, '')}`;
  }

  private getProfileCacheId(profile: StructureDefinition): number {
    const existing = this.profileCacheIds.get(profile);
    if (existing !== undefined) return existing;
    const assigned = this.nextProfileCacheId++;
    this.profileCacheIds.set(profile, assigned);
    return assigned;
  }

  private extractProfileConstraints(
    typeCode: string,
    basePath: string,
    parentStructureDef?: StructureDefinition,
  ): Map<string, ElementDefinition> {
    const result = new Map<string, ElementDefinition>();
    if (!parentStructureDef?.snapshot?.element) return result;

    const basePathPrefix = basePath.replace(/\[\d+\]/g, '');
    for (const element of parentStructureDef.snapshot.element) {
      if (element.sliceName || (typeof element.id === 'string' && element.id.includes(':'))) continue;
      if (!element.path.startsWith(`${basePathPrefix}.`)) continue;
      const relativePath = element.path.substring(basePathPrefix.length + 1);
      result.set(`${typeCode}.${relativePath}`, element);
    }
    return result;
  }
}
