/**
 * Validates Reference target types declared by a StructureDefinition.
 */

import type {
  ElementDefinition,
  ElementType,
  StructureDefinition,
} from '../core/structure-definition-types.js';
import { getValidationTargets } from '../business-rules/element-validation-targets.js';
import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { targetMatchesSliceDefinition } from './constraint-slice-targets.js';
import {
  canonicalBase,
  extractResourceTypeFromCanonical,
  extractTargetTypeFromReference,
  isAbsoluteUri,
  isProfiledCanonical,
  isUnrestrictedCanonical,
  resolveContainedTargetType,
  resolveTargetTypeViaResolver,
  type ProfileTypeResolver,
  type ReferenceResolver,
} from './reference-target-type-resolution.js';

export type { ProfileTypeResolver, ReferenceResolver } from './reference-target-type-resolution.js';

export interface ProfiledTargetHit {
  path: string;
  reference: string;
  profiles: string[];
}

interface AllowedTargetRule {
  element: ElementDefinition;
  allowed: Set<string> | null;
}

interface ReferenceHit {
  path: string;
  reference: string;
  declaredType?: string;
}

export class ReferenceTargetValidator {
  private profileTypeResolver?: ProfileTypeResolver;

  setProfileTypeResolver(resolver: ProfileTypeResolver): void {
    this.profileTypeResolver = resolver;
  }

  validate(
    resource: unknown,
    structureDef: StructureDefinition,
    resolveReference?: ReferenceResolver,
  ): ValidationIssue[] {
    if (!isRecord(resource)) return [];
    const elements = getSnapshotElements(structureDef);
    if (elements.length === 0) return [];

    const rules = buildAllowedTargetRules(elements, this.profileTypeResolver);

    const issues: ValidationIssue[] = [];
    const resourceType = typeof resource.resourceType === 'string'
      ? resource.resourceType
      : 'Unknown';

    for (const { element, allowed } of rules) {
      if (allowed === null || allowed.size === 0) continue;

      for (const hit of collectReferenceHits(resource, element, elements)) {
        const targetType = extractTargetTypeFromReference(hit.reference) ??
          resolveTargetTypeViaResolver(hit.reference, resolveReference) ??
          resolveContainedTargetType(hit.reference, resource);
        if (
          targetType &&
          hit.declaredType &&
          !isAbsoluteUri(hit.declaredType) &&
          hit.declaredType !== targetType
        ) {
          issues.push(createValidationIssue({
            code: 'reference-target-type-invalid',
            path: hit.path,
            resourceType,
            profile: structureDef.url,
            customMessage:
              `Reference.type '${hit.declaredType}' does not match the resolved target resource type '${targetType}'. ` +
              'FHIR resource type names are case-sensitive.',
            details: {
              actualTarget: targetType,
              declaredTargetType: hit.declaredType,
              reference: hit.reference,
            },
            severityOverride: 'error',
            aspectOverride: 'reference',
          }));

          if (!allowed.has(hit.declaredType)) {
            const allowedTargets = [...allowed].sort();
            issues.push(createValidationIssue({
              code: 'reference-target-type-invalid',
              path: hit.path,
              resourceType,
              profile: structureDef.url,
              customMessage:
                `Reference.type '${hit.declaredType}' is not a valid target type for ${hit.path}; ` +
                `expected one of: ${allowedTargets.join(', ')}. FHIR resource type names are case-sensitive.`,
              details: {
                actualTarget: hit.declaredType,
                declaredTargetType: hit.declaredType,
                allowedTargets,
                reference: hit.reference,
                reason: 'declared-type-not-allowed',
              },
              severityOverride: 'error',
              aspectOverride: 'reference',
            }));
          }
        }
        if (!targetType || allowed.has(targetType)) continue;

        const allowedTargets = [...allowed].sort();
        issues.push(createValidationIssue({
          code: 'reference-target-type-invalid',
          path: hit.path,
          resourceType,
          profile: structureDef.url,
          customMessage:
            `Reference at ${hit.path} points at ${targetType}/… but the profile restricts ` +
            `this element to Reference(${allowedTargets.join(', ')}). ` +
            'Either change the target type or use a different Reference slot.',
          details: {
            actualTarget: targetType,
            allowedTargets,
            reference: hit.reference,
          },
          severityOverride: 'error',
          aspectOverride: 'reference',
        }));
      }
    }

    return deduplicateIssues(issues);
  }

  collectProfiledTargetHits(
    resource: unknown,
    structureDef: StructureDefinition,
  ): ProfiledTargetHit[] {
    if (!isRecord(resource)) return [];
    const elements = getSnapshotElements(structureDef);
    const hits: ProfiledTargetHit[] = [];

    for (const element of elements) {
      const profiles = collectProfiledCanonicals(element);
      if (profiles.length === 0) continue;

      for (const hit of collectReferenceHits(resource, element, elements)) {
        hits.push({
          path: hit.path,
          reference: hit.reference,
          profiles,
        });
      }
    }

    return hits;
  }
}

function buildAllowedTargetRules(
  elements: ElementDefinition[],
  profileTypeResolver?: ProfileTypeResolver,
): AllowedTargetRule[] {
  const rules: AllowedTargetRule[] = [];

  for (const element of elements) {
    const referenceTypes = getReferenceTypes(element);
    if (referenceTypes.length === 0) continue;

    let unrestricted = false;
    const allowed = new Set<string>();
    for (const type of referenceTypes) {
      const targetProfiles = getTargetProfiles(type);
      if (targetProfiles.length === 0) {
        unrestricted = true;
        break;
      }

      for (const canonical of targetProfiles) {
        if (isUnrestrictedCanonical(canonical)) {
          unrestricted = true;
          break;
        }
        const resourceType = extractResourceTypeFromCanonical(canonical, profileTypeResolver);
        if (!resourceType) {
          unrestricted = true;
          break;
        }
        allowed.add(resourceType);
      }
      if (unrestricted) break;
    }

    rules.push({ element, allowed: unrestricted ? null : allowed });
  }

  return rules;
}

function collectReferenceHits(
  resource: Record<string, unknown>,
  element: ElementDefinition,
  elements: ElementDefinition[],
): ReferenceHit[] {
  return getValidationTargets(resource, element.path).flatMap(target => {
    if (
      !targetMatchesSliceDefinition(target.value, element, elements, { resource, target }) ||
      !isRecord(target.value) ||
      typeof target.value.reference !== 'string' ||
      target.value.reference.length === 0
    ) {
      return [];
    }
    return [{
      path: target.fullPath,
      reference: target.value.reference,
      ...(typeof target.value.type === 'string' && target.value.type.length > 0
        ? { declaredType: target.value.type }
        : {}),
    }];
  });
}

function collectProfiledCanonicals(element: ElementDefinition): string[] {
  const profiles = new Set<string>();
  for (const type of getReferenceTypes(element)) {
    for (const canonical of getTargetProfiles(type)) {
      if (isProfiledCanonical(canonical)) profiles.add(canonicalBase(canonical));
    }
  }
  return [...profiles];
}

function getReferenceTypes(element: ElementDefinition): ElementType[] {
  return Array.isArray(element.type)
    ? element.type.filter(type => isRecord(type) && type.code === 'Reference')
    : [];
}

function getTargetProfiles(type: ElementType): string[] {
  return Array.isArray(type.targetProfile)
    ? type.targetProfile.filter(value => typeof value === 'string' && value.length > 0)
    : [];
}

function getSnapshotElements(structureDef: StructureDefinition): ElementDefinition[] {
  const elements = structureDef?.snapshot?.element;
  return Array.isArray(elements)
    ? elements.filter(isElementDefinition)
    : [];
}

function deduplicateIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter(issue => {
    const details = isRecord(issue.details) ? issue.details : {};
    const allowed = Array.isArray(details.allowedTargets)
      ? details.allowedTargets.join('|')
      : '';
    const key = `${issue.path}|${details.actualTarget ?? ''}|${details.declaredTargetType ?? ''}|${allowed}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isElementDefinition(value: unknown): value is ElementDefinition {
  return isRecord(value) &&
    typeof value.path === 'string' &&
    value.path.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
