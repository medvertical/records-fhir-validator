import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import type { CodeSystemConcept } from './valueset-types';
import type { ValueSetCache } from './valueset-cache';
import { ValueSetPackageLoader } from './valueset-package-loader';
import {
  buildDisplayMismatchFixHint,
  displayMismatchSeverityForBinding,
  displaysEquivalentForCodeInfo,
  resourceTypeFromElementPath,
  type BindingStrength,
  type CodeInfo,
} from './valueset-display-utils';
import { type FhirVersion, versionedExpansionCacheKey } from './valueset-expansion-cache-key';

export async function validateDisplayMatchesCodeSystem(
  rawCode: any,
  codeInfo: CodeInfo,
  valueSetUrl: string,
  elementPath: string,
  context: {
    bindingStrength?: BindingStrength;
    profileUrl?: string;
    fhirVersion?: FhirVersion;
    cache: ValueSetCache;
    packageLoader: ValueSetPackageLoader;
  },
): Promise<ValidationIssue | null> {
  if (!codeInfo.system || !codeInfo.display) return null;
  const actualDisplay = codeInfo.display;

  const acceptedDisplays = await resolveAcceptedDisplays(codeInfo, valueSetUrl, context);
  if (acceptedDisplays.length === 0) return null;

  const expectedDisplay = acceptedDisplays[0];
  if (!expectedDisplay) return null;
  if (acceptedDisplays.some(display => displaysEquivalentForCodeInfo(display, actualDisplay, codeInfo))) return null;

  const displayPath = resolveDisplayPath(rawCode, elementPath, codeInfo);
  return createValidationIssue({
    code: 'terminology-display-mismatch',
    path: displayPath,
    resourceType: resourceTypeFromElementPath(elementPath),
    profile: context.profileUrl,
    customMessage:
      `Wrong Display Name '${actualDisplay}' for ${codeInfo.system}#${codeInfo.code}. ` +
      `Valid display is '${expectedDisplay}'`,
    severityOverride: displayMismatchSeverityForBinding(context.bindingStrength),
    aspectOverride: 'terminology',
    details: {
      code: codeInfo.code,
      system: codeInfo.system,
      display: actualDisplay,
      expectedDisplay,
      valueSet: valueSetUrl,
      ...(context.bindingStrength ? { bindingStrength: context.bindingStrength } : {}),
      fixHint: buildDisplayMismatchFixHint(codeInfo, expectedDisplay),
    },
  });
}

async function resolveAcceptedDisplays(
  codeInfo: CodeInfo,
  valueSetUrl: string,
  context: {
    fhirVersion?: FhirVersion;
    cache: ValueSetCache;
    packageLoader: ValueSetPackageLoader;
  },
): Promise<string[]> {
  if (!codeInfo.system) return [];

  const valueSetCacheKey = versionedExpansionCacheKey(valueSetUrl, context.fhirVersion);
  const valueSet = context.cache.getValueSetFile(valueSetCacheKey)
    ?? context.cache.getValueSetFile(valueSetUrl)
    ?? context.cache.getValueSetFile(valueSetUrl.split('|')[0]);
  const include = valueSet?.compose?.include?.find(entry =>
    entry.system === codeInfo.system
  );
  const cacheKey = include?.version ? `${codeInfo.system}|${include.version}` : codeInfo.system;
  let codeSystem = context.cache.getCodeSystem(cacheKey)
    ?? context.cache.getCodeSystemFile(cacheKey)
    ?? context.cache.getCodeSystem(codeInfo.system)
    ?? context.cache.getCodeSystemFile(codeInfo.system);
  if (!codeSystem) {
    codeSystem = await context.packageLoader.loadCodeSystem(
      codeInfo.system,
      context.fhirVersion === 'R4' ? '4' : context.fhirVersion === 'R5' ? '5' : context.fhirVersion === 'R6' ? '6' : undefined,
      include?.version,
    );
  }
  if (!codeSystem) return [];

  const concept = findCodeSystemConcept(codeSystem.concept, codeInfo.code);
  if (!concept) return [];

  return [
    concept.display,
    ...(concept.designation ?? []).map(designation => designation.value),
  ].filter((display): display is string => Boolean(display?.trim()));
}

function findCodeSystemConcept(
  concepts: CodeSystemConcept[] | undefined,
  code: string,
): CodeSystemConcept | null {
  if (!concepts) return null;
  for (const concept of concepts) {
    if (concept.code === code) return concept;
    const nested = findCodeSystemConcept(concept.concept, code);
    if (nested) return nested;
  }
  return null;
}

function resolveDisplayPath(rawCode: any, elementPath: string, codeInfo: CodeInfo): string {
  if (rawCode?.coding && Array.isArray(rawCode.coding)) {
    return `${elementPath}.coding[${codeInfo.codingIndex ?? 0}].display`;
  }
  return `${elementPath}.display`;
}
