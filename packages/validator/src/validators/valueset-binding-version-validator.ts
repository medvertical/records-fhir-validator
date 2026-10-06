import type { ValidationIssue } from '@records-fhir/validation-types';
import { createTerminologyIssue } from '../terminology/terminology-issue.js';
import { codeSystemCanonicalsEquivalent } from './code-system-canonical-aliases.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import { resourceTypeFromElementPath, type BindingStrength, type CodeInfo } from './valueset-display-utils.js';
import type { ValueSetPackageLoader } from './valueset-package-loader.js';

interface BindingVersionValidationOptions {
  fhirVersion?: FhirVersion;
  profileUrl?: string;
}

export async function validateCodeSystemVersions(
  packageLoader: ValueSetPackageLoader,
  rawCode: unknown,
  codeInfos: CodeInfo[],
  bindingStrength: BindingStrength,
  valueSetUrl: string,
  elementPath: string,
  options?: BindingVersionValidationOptions,
): Promise<ValidationIssue[]> {
  const versionedCodeInfos = codeInfos.filter((codeInfo) => codeInfo.system && codeInfo.version);
  if (versionedCodeInfos.length === 0) return [];
  const valueSet = await packageLoader.loadValueSetResource(valueSetUrl, options?.fhirVersion);
  const includes = valueSet?.compose?.include ?? [];
  const issues: ValidationIssue[] = [];

  for (const codeInfo of versionedCodeInfos) {
    const systemIncludes = includes.filter((include) =>
      codeSystemCanonicalsEquivalent(include.system, codeInfo.system),
    );
    const includeVersions = systemIncludes.map((include) => include.version ?? implicitCoreVersion(valueSet, include.system));
    const constrainedVersions = [...new Set(
      includeVersions.filter((version): version is string => Boolean(version) && version !== '*'),
    )];
    if (
      constrainedVersions.length === 0
      || constrainedVersions.some((version) => codeInfo.version === version || codeInfo.version!.startsWith(`${version}.`))
      || includeVersions.some((version) => !version)
    ) continue;

    const coding = asRecord(rawCode)?.coding;
    const versionPath = Array.isArray(coding)
      ? `${elementPath}.coding[${codeInfo.codingIndex ?? 0}].version`
      : `${elementPath}.version`;
    issues.push(createBindingVersionMismatch(
      codeInfo,
      constrainedVersions,
      bindingStrength,
      valueSetUrl,
      versionPath,
      options?.profileUrl,
    ));
  }
  return issues;
}

/**
 * A value set of the FHIR specification includes the specification's own
 * code systems at its release, and the reference validator pins such a
 * versionless include to it (study-design in R5 at 5.0.0).
 */
function implicitCoreVersion(
  valueSet: { url?: string; version?: string } | null | undefined,
  system: string | undefined,
): string | undefined {
  if (!valueSet?.version || !system || !valueSet.url?.startsWith('http://hl7.org/fhir/ValueSet/')) return undefined;
  return system.startsWith('http://hl7.org/fhir/') && !system.startsWith('http://hl7.org/fhir/sid/')
    ? valueSet.version
    : undefined;
}

function createBindingVersionMismatch(
  codeInfo: CodeInfo,
  expectedVersions: string[],
  bindingStrength: BindingStrength,
  valueSetUrl: string,
  versionPath: string,
  profileUrl?: string,
): ValidationIssue {
  const expected = expectedVersions.join(', ');
  return createTerminologyIssue({
    severity: bindingStrength === 'required'
      ? 'error'
      : bindingStrength === 'extensible' ? 'warning' : 'information',
    code: 'terminology-code-system-version-mismatch',
    message:
      `CodeSystem '${codeInfo.system}' version '${codeInfo.version}' does not match ` +
      `the version required by ValueSet '${valueSetUrl}' (${expected})`,
    path: versionPath,
    resourceType: resourceTypeFromElementPath(versionPath),
    profile: profileUrl,
    details: {
      code: codeInfo.code,
      system: codeInfo.system,
      actualVersion: codeInfo.version,
      expectedVersions,
      bindingStrength,
      valueSet: valueSetUrl,
      fieldPath: versionPath,
      fixHint:
        `Use one of the CodeSystem versions required by the ValueSet (${expected}), ` +
        'or omit Coding.version when the binding does not require a version assertion.',
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
