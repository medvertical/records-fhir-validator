import { parseMixedNamedInventory, assessSelectedNamedMembership, importedNamedCodeRejection, selectedInventoryConcept } from './imported-terminology-inventory.js';
import { verifiedCodeSystemResult } from './code-system-validation-evidence.js';
import { validateProviderCode } from './built-in-terminology-provider.js';
import type { CodeSystemValidationIssue, CodeSystemValidationResult } from './terminology-api-client.js';
import type { ValueSetCache } from './valueset-cache.js';
import {
  fhirVersionToPackageMajor,
  findCodeSystemConcept,
  isAssertableCodeSystem,
  isDeprecatedConcept,
} from './valueset-code-system-rules.js';
import { assessLocalDisplay, displayUnverifiedMessage } from './valueset-display-authority.js';
import { specialV2Concept } from './v2-special-concepts.js';
import { hasNonEnumerableCodeGrammar } from './finite-valueset-expansion.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import type { ValueSetPackageLoader } from './valueset-package-loader.js';
import type { CodeSystem, CodeSystemConcept } from './valueset-types.js';

interface LocalCodeSystemValidationDeps {
  cache: ValueSetCache;
  packageLoader: ValueSetPackageLoader;
}

export async function validateCodeInLocalCodeSystem(
  deps: LocalCodeSystemValidationDeps,
  code: string,
  system: string,
  display?: string,
  fhirVersion?: FhirVersion,
  codeSystemVersion?: string,
  displayLanguage?: string,
): Promise<CodeSystemValidationResult | null> {
  return deps.cache.sourceContexts.run(fhirVersion, async () => {
    const selected = deps.packageLoader.loadLocalTerminologyAuthority
      ? await deps.packageLoader.loadLocalTerminologyAuthority(system, fhirVersion, codeSystemVersion) : undefined;
    if (selected?.kind === 'provider') {
      const provider = deps.packageLoader.providerSnapshotForContext(selected, fhirVersion);
      return provider ? validateProviderCode(provider, code, display, displayLanguage) : null;
    }
    const codeSystem = selected === undefined ? await resolveLocalCodeSystem(deps, system, fhirVersion, codeSystemVersion)
      : selected?.kind === 'code-system' ? selected.codeSystem : null;
    if (!codeSystem || !isAssertableCodeSystem(codeSystem)) return null;

    const inventory = parseMixedNamedInventory(codeSystem);
    if (inventory.kind === 'unverified') return null;
    let concept: CodeSystemConcept | undefined | null;
    if (inventory.kind === 'named-inventory') {
      const family = deps.cache.sourceContexts.context()?.fhirVersion;
      if (family !== 'R4' && family !== 'R5' && family !== 'R6') return null;
      const membership = assessSelectedNamedMembership(inventory.definition, {
        sourceScopeKey: deps.cache.sourceContexts.key(''), fhirFamily: family,
        selectedCanonical: codeSystem.url, selectedBusinessVersion: codeSystem.version ?? '',
        requestedCanonical: system, requestedBusinessVersion: codeSystemVersion,
        defaultSelection: selected?.kind === 'code-system' ? 'selected-by-existing-loader' : 'not-established',
      }, code);
      if (membership.kind === 'unverified') return null;
      if (membership.kind === 'absent-named-concept') return importedNamedCodeRejection(membership, code) ?? null;
      concept = selectedInventoryConcept(membership);
    } else concept = findCodeSystemConcept(codeSystem.concept, code) ?? specialV2Concept(system, code);
    const finalize = (result: CodeSystemValidationResult): CodeSystemValidationResult =>
      inventory.kind === 'named-inventory' ? verifiedCodeSystemResult(result) : result;
    if (!concept) {
      const grammar = hasNonEnumerableCodeGrammar(codeSystem);
      const incompleteCodeSystem = codeSystem.content !== 'complete' || grammar;
      return {
        valid: false,
        reason: 'code-unknown',
        incompleteCodeSystem,
        message:
          `Unknown code '${code}' in CodeSystem '${system}'` +
          `${codeSystem.version ? ` version '${codeSystem.version}'` : ''}` +
          (grammar ? '; the named concepts do not cover the CodeSystem compositional grammar' : incompleteCodeSystem
            ? '; the CodeSystem does not declare complete content, so the code may exist outside the listed concepts'
            : ''),
      };
    }

    const { inactive, issues: lifecycleIssues } = localConceptLifecycle(codeSystem, concept, code);

    const assessment = display ? assessLocalDisplay(codeSystem, concept, display, displayLanguage) : undefined;
    if (assessment?.outcome === 'unverified') return finalize({
      valid: true, reason: 'display-unverified', display: concept.display, displayLanguage,
      ...(inactive ? { inactive: true } : {}),
      issues: [{ severity: assessment.defaultMatch ? 'information' : 'warning', code: 'display-unverified',
        message: displayUnverifiedMessage({ code, system, display, version: codeSystemVersion }, displayLanguage),
        source: 'local-code-system' }, ...lifecycleIssues],
    });
    if (assessment?.outcome === 'mismatch') {
      const acceptedDisplays = assessment.displays;
      const expectedDisplay = acceptedDisplays[0];
      const message = (
        (assessment.inactiveMatch ? `Inactive Display Name '${display}' for ${system}#${code}. `
          : `Wrong Display Name '${display}' for ${system}#${code}. `) +
        `Valid display is '${expectedDisplay}'`
      );
      return finalize({
        valid: false,
        reason: 'display-mismatch',
        display: expectedDisplay,
        message,
        ...(inactive ? { inactive: true } : {}),
        issues: [{
          severity: 'error',
          code: 'invalid-display',
          message,
          source: 'local-code-system',
        }, ...lifecycleIssues],
      });
    }

    return finalize({
      valid: true,
      display: concept.display,
      ...(inactive ? { inactive: true } : {}),
      ...(lifecycleIssues.length > 0 ? { issues: lifecycleIssues } : {}),
    });
  });
}

function localConceptLifecycle(
  codeSystem: CodeSystem,
  concept: CodeSystemConcept,
  code: string,
): { inactive: boolean; issues: CodeSystemValidationIssue[] } {
  const properties = concept.property ?? [];
  const { inactive, expression } = localInactiveProperty(concept);
  const statusCode = codeSystem.property?.find(property =>
    property.uri === 'http://hl7.org/fhir/concept-properties#status')?.code ?? 'status';
  const statusIndex = properties.findIndex(property => property.code === statusCode);
  const status = properties[statusIndex];
  const retired = inactive && (status?.valueCode ?? status?.valueString) === 'retired';
  const issues: CodeSystemValidationIssue[] = [];
  if (inactive) {
    issues.push({
      severity: 'warning',
      code: 'code-comment',
      message: `The concept '${code}' has a status of inactive and its use should be reviewed`,
      expression,
      source: 'local-code-system',
    });
  }
  if (retired) {
    issues.push({
      severity: 'warning',
      code: 'code-retired',
      message: `The concept '${code}' has a status of retired and its use should be reviewed`,
      expression: [`property[${statusIndex}].${status?.valueCode !== undefined ? 'valueCode' : 'valueString'}`],
      source: 'local-code-system',
    });
  }
  if (isDeprecatedConcept(concept)) {
    issues.push({
      severity: 'warning',
      code: 'code-deprecated',
      message: `The concept '${code}' is deprecated and its use should be reviewed`,
      source: 'local-code-system',
    });
  }
  return { inactive, issues };
}

function localInactiveProperty(
  concept: CodeSystemConcept,
): { inactive: boolean; expression?: string[] } {
  // SDK 6.9.11's two-argument isInactive returns at the first recognized property, including false.
  for (const [index, property] of (concept.property ?? []).entries()) {
    if (property.code === 'status') {
      const status = property.valueCode ?? property.valueString;
      if (typeof status === 'string') return {
        inactive: status === 'inactive' || status === 'retired',
        expression: [`property[${index}].${property.valueCode !== undefined ? 'valueCode' : 'valueString'}`],
      };
    }
    if (property.code === 'inactive') {
      if (typeof property.valueBoolean === 'boolean') return {
        inactive: property.valueBoolean,
        expression: [`property[${index}].valueBoolean`],
      };
      if (typeof property.valueCode === 'string') return {
        inactive: property.valueCode === 'true',
        expression: [`property[${index}].valueCode`],
      };
    }
  }
  return { inactive: false };
}

async function resolveLocalCodeSystem(
  deps: LocalCodeSystemValidationDeps,
  system: string,
  fhirVersion?: FhirVersion,
  requestedVersion?: string,
): Promise<CodeSystem | null> {
  if (!requestedVersion) {
    return deps.cache.getCodeSystem(system)
      ?? deps.cache.getCodeSystemFile(system)
      ?? await deps.packageLoader.loadCodeSystem(
        system,
        fhirVersionToPackageMajor(fhirVersion),
      );
  }

  const versionedKey = `${system}|${requestedVersion}`;
  const cached = [
    deps.cache.getCodeSystem(versionedKey),
    deps.cache.getCodeSystemFile(versionedKey),
    deps.cache.getCodeSystem(system),
    deps.cache.getCodeSystemFile(system),
  ].find(candidate => candidate?.version === requestedVersion);
  if (cached) return cached;

  const loaded = await deps.packageLoader.loadCodeSystem(
    system,
    fhirVersionToPackageMajor(fhirVersion),
    requestedVersion,
  );
  return loaded?.version === requestedVersion ? loaded : null;
}
