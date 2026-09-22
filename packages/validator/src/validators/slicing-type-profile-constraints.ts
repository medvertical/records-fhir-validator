import type { StructureDefinition } from '../core/structure-definition-types.js';
import { isFhirResource } from '../core/fhir-resource.js';
import type { FhirVersionFamily } from '../core/sd-loader-version-utils.js';
import { logger } from '../logger.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { resourceTypeFromPath } from './slicing-content-rules.js';
import type { ConstraintValidator } from './constraint-validator.js';
import type { SliceDefinition } from './slice-types.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';
import { resolveValueOccurrences } from './slicing-content-paths.js';

type TypeSpec = { code: string; profile?: string[]; targetProfile?: string[] };

interface ProfileConstraintTarget {
  value: unknown;
  path: string;
  typeSpecs: TypeSpec[];
}

type TypeProfileResolver = (profileUrl: string) => Promise<StructureDefinition | null>;

export async function validateSliceTypeProfileConstraints(
  element: unknown,
  slice: SliceDefinition,
  elementPath: string,
  fhirVersion: FhirVersionFamily,
  typeProfileResolver: TypeProfileResolver | null,
  constraintValidator: ConstraintValidator,
  rootResource?: unknown,
): Promise<ValidationIssue[]> {
  if (!typeProfileResolver) return [];
  const issues: ValidationIssue[] = [];
  const visitedProfiles = new Set<string>();

  const targets = collectProfileConstraintTargets(element, slice, elementPath);
  for (const target of targets) {
    issues.push(...await validateTargetTypeProfiles({
      target,
      fhirVersion,
      typeProfileResolver,
      constraintValidator,
      rootResource,
      visitedProfiles,
    }));
  }
  return issues;
}

function collectProfileConstraintTargets(
  element: unknown,
  slice: SliceDefinition,
  elementPath: string,
): ProfileConstraintTarget[] {
  const targets: ProfileConstraintTarget[] = [{
    value: element,
    path: elementPath,
    typeSpecs: slice.type ?? [],
  }];
  for (const [childPath, typeSpecs] of slice.childTypes ?? []) {
    if (countDeclaredProfiles(typeSpecs) !== 1) continue;
    for (const occurrence of resolveValueOccurrences(element, childPath)) {
      targets.push({
        value: occurrence.value,
        path: `${elementPath}.${occurrence.path}`,
        typeSpecs,
      });
    }
  }
  return targets;
}

function countDeclaredProfiles(typeSpecs: TypeSpec[]): number {
  return typeSpecs.reduce((count, typeSpec) => count + (typeSpec.profile?.length ?? 0), 0);
}

async function validateTargetTypeProfiles(input: {
  target: ProfileConstraintTarget;
  fhirVersion: FhirVersionFamily;
  typeProfileResolver: TypeProfileResolver;
  constraintValidator: ConstraintValidator;
  rootResource?: unknown;
  visitedProfiles: Set<string>;
}): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  for (const typeSpec of input.target.typeSpecs) {
    for (const versionedProfileUrl of typeSpec.profile ?? []) {
      const profileUrl = versionedProfileUrl.split('|')[0];
      const visitKey = `${input.target.path}|${profileUrl}`;
      if (input.visitedProfiles.has(visitKey)) continue;
      input.visitedProfiles.add(visitKey);
      try {
        const typeProfile = await input.typeProfileResolver(versionedProfileUrl);
        const constraintElements = (typeProfile?.snapshot?.element ?? typeProfile?.differential?.element ?? [])
          .filter(candidate => (candidate.constraint?.length ?? 0) > 0);
        const typeRoot = typeProfile?.type;
        if (!typeProfile || !typeRoot || constraintElements.length === 0) continue;
        // The slice value is wrapped as a pseudo-resource so element paths
        // match the type profile, but FHIRPath `%resource` must still see the
        // resource that contains the slice (e.g. gender-amtlich-1 reads
        // `%resource.gender` from the Patient, not from the Extension).
        const profileIssues = await input.constraintValidator.validate(
          { ...asRecord(input.target.value), resourceType: typeRoot },
          constraintElements,
          typeProfile.url,
          {
            fhirVersion: input.fhirVersion,
            ...(isFhirResource(input.rootResource) ? { rootResource: input.rootResource } : {}),
          },
        );
        issues.push(...profileIssues.map(issue => {
          const sourcePath = issue.path ?? typeRoot;
          return {
            ...issue,
            path: sourcePath === typeRoot
              ? input.target.path
              : sourcePath.startsWith(`${typeRoot}.`)
                ? `${input.target.path}${sourcePath.slice(typeRoot.length)}`
                : input.target.path,
            resourceType: resourceTypeFromPath(input.target.path),
            profile: typeProfile.url,
          };
        }));
      } catch (error) {
        logger.debug('[SlicingValidator] Failed to validate type profile constraints', {
          ...profileCanonicalMetadata(profileUrl),
          ...validationFailureMetadata(error),
        });
      }
    }
  }
  return issues;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
