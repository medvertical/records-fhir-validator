import type { TerminologyDefinitionLookup } from './terminology-validation-port.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { createTerminologyIssue } from '../../terminology/terminology-issue.js';
import { ValueSetCache } from '../../validators/valueset-cache.js';
import { ValueSetPackageLoader } from '../../validators/valueset-package-loader.js';
import { declarationsDeclaringCanonical } from '../../validators/valueset-package-search.js';
import { exampleCodeSystemUrls } from '../../validators/package-defined-urls.js';
import { inInstalledHl7CodeSystemSpace } from '../../validators/hl7-registrar-packages.js';
import { isHl7CoreNamespaceUrl } from './terminology-hl7-namespace-rules.js';

/**
 * A system in the core namespace that no loaded package defines — typically a
 * DSTU2/STU3 URL such as `http://hl7.org/fhir/v3/ParticipationMode`, or an R4
 * system R5 renamed. The reference validator never installs a package for it.
 *
 * The same holds in the CodeSystem space of an installed HL7 package — HL7
 * Terminology or an IG — for a URL no installed release defines
 * (`…/CodeSystem/participant-role`, `…/v2-0360%7C2.7`, a misspelt IG code
 * system). Every release counts: an IG pinning an older one brings it along
 * when it is installed.
 */
export async function isUndefinedCoreCodeSystem(
  system: string,
  fhirVersion: 'R4' | 'R5' | 'R6' | undefined,
  cache: ValueSetCache = new ValueSetCache(),
  definitionLookup?: TerminologyDefinitionLookup,
): Promise<boolean> {
  cache = definitionLookup?.cache ?? cache;
  const packageLoader = definitionLookup?.packageLoader ?? new ValueSetPackageLoader(cache);
  if (isHl7CoreNamespaceUrl(system)) {
    return !(await codeSystemDefinitionExists(system, fhirVersion, cache, packageLoader)) && !(await definedAmongExamples(system, packageLoader));
  }
  if (!(await inInstalledHl7CodeSystemSpace(system, packageLoader.getPackageDirectories()))) return false;
  return !(await codeSystemDefinitionExists(system, undefined, cache, packageLoader)) && !(await definedAmongExamples(system, packageLoader));
}

async function definedAmongExamples(system: string, packageLoader: TerminologyDefinitionLookup['packageLoader']): Promise<boolean> {
  return (await exampleCodeSystemUrls(packageLoader.getPackageDirectories()).catch(() => new Set<string>())).has(system);
}

export function undefinedCoreCodeSystemIssues(
  system: string,
  code: string | undefined,
  display: string | undefined,
  systemPath: string,
): ValidationIssue[] {
  return [
    createTerminologyIssue({
      severity: 'error',
      code: 'terminology-codesystem-undefined',
      message: `No definition could be found for URL value '${system}'`,
      path: systemPath,
      details: {
        ...(code ? { code } : {}),
        system,
        fixHint: 'Use the CodeSystem URL that the current FHIR release or HL7 Terminology defines; URLs such as '
          + 'http://hl7.org/fhir/v3/… belong to retired releases.',
      },
    }),
    // The reference validator reports the missing definition on the
    // terminology side as well, so the code itself stays unverified.
    createTerminologyIssue({
      severity: 'warning',
      code: 'terminology-codesystem-unresolvable',
      message: `A definition for CodeSystem '${system}' could not be found, so the code cannot be validated`,
      path: systemPath,
      details: {
        ...(code ? { code } : {}), system, ...(display ? { display } : {}),
        validationComplete: false,
        validationStatus: 'incomplete',
      },
    }),
  ];
}

/** Any CodeSystem resource counts here, including content "not-present" definitions. */
async function codeSystemDefinitionExists(
  system: string,
  fhirVersion: 'R4' | 'R5' | 'R6' | undefined,
  cache: ValueSetCache,
  packageLoader: TerminologyDefinitionLookup['packageLoader'],
): Promise<boolean> {
  if (cache.getCodeSystem(system)) return true;
  const codeSystem = await packageLoader
    .loadCodeSystem(system, fhirVersionToPackageMajor(fhirVersion))
    .catch(() => null);
  return Boolean(codeSystem) || await declaredForRelease(system, fhirVersion, packageLoader);
}

/**
 * The loader skips a core-namespace copy whose version names another release,
 * but a package for this release may carry one on purpose: the R4 extensions
 * pack ships R5's `version-algorithm` (version 5.0.0) for R4 use.
 */
async function declaredForRelease(
  system: string,
  fhirVersion: 'R4' | 'R5' | 'R6' | undefined,
  packageLoader: TerminologyDefinitionLookup['packageLoader'],
): Promise<boolean> {
  const major = fhirVersionToPackageMajor(fhirVersion);
  if (!major) return false;
  const declarations = await declarationsDeclaringCanonical(packageLoader.getPackageDirectories(), 'CodeSystem', system)
    .catch(() => null);
  return (declarations ?? []).some(declaration => {
    const release = packageRelease(declaration.packageName);
    return release === undefined || release === major;
  });
}

/** `hl7.fhir.r4.core`, `hl7.fhir.r4b.examples` and `….r4` packages belong to release 4. */
function packageRelease(packageName: string): string | undefined {
  const name = packageName.split('#')[0];
  return name.match(/^hl7\.fhir\.r(\d+)b?\./)?.[1] ?? name.match(/\.r(\d+)$/)?.[1];
}

function fhirVersionToPackageMajor(fhirVersion?: 'R4' | 'R5' | 'R6'): string | undefined {
  if (fhirVersion === 'R4') return '4';
  if (fhirVersion === 'R5') return '5';
  if (fhirVersion === 'R6') return '6';
  return undefined;
}

/** The reference validator's test: the scheme alone decides (`http:example.org` passes). */
export function isAbsoluteCodeSystemUri(systemUrl: string): boolean {
  return systemUrl.startsWith('http:') || systemUrl.startsWith('https:') || systemUrl.startsWith('urn:');
}

/**
 * Tags and security labels name application namespaces, so their codes are
 * not looked up. Their system is still a Coding.system the reference
 * validator checks: absolute, and defined when it claims the core namespace.
 */
export async function metaCodingSystemIssues(
  coding: Record<string, unknown>,
  codingPath: string,
  fhirVersion: 'R4' | 'R5' | 'R6' | undefined,
  definitionLookup?: TerminologyDefinitionLookup,
): Promise<ValidationIssue[]> {
  const system = coding.system;
  if (typeof system !== 'string') return [];
  const code = typeof coding.code === 'string' ? coding.code : undefined;
  const display = typeof coding.display === 'string' ? coding.display : undefined;
  const relative = relativeCodingSystemIssue(coding, codingPath);
  if (relative) return [relative];
  return await isUndefinedCoreCodeSystem(system, fhirVersion, definitionLookup?.cache, definitionLookup)
    ? undefinedCoreCodeSystemIssues(system, code, display, `${codingPath}.system`)
    : [];
}

/** A Coding.system that is a local label rather than a URI, wherever the Coding sits. */
export function relativeCodingSystemIssue(
  coding: Record<string, unknown>,
  codingPath: string,
): ValidationIssue | null {
  const system = coding.system;
  if (typeof system !== 'string' || isAbsoluteCodeSystemUri(system)) return null;
  return createTerminologyIssue({
    severity: 'error',
    code: 'terminology-codesystem-url-not-absolute',
    message: `Coding.system must be an absolute reference, not a local reference ('${system}')`,
    path: `${codingPath}.system`,
    details: { system, expectedSystemType: 'absolute CodeSystem URI' },
  });
}

