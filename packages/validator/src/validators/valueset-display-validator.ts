import { assessSelectedNamedMembership, canAssertNamedCodeRejection, findImportedInventoryConcept,
  parseMixedNamedInventory } from './imported-terminology-inventory.js';
import { resolveCodeSystemVersion } from './terminology-config-snapshot.js';
import { assessProviderDisplay, type ProviderSnapshot } from './built-in-terminology-provider.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import type { CodeBindingOutcome, CodeSystem, ValueSet } from './valueset-types.js';
import { assessLocalDisplay, displayUnverifiedIssue, displayUnverifiedMessage } from './valueset-display-authority.js';
import { findCodeSystemConcept, isAssertableCodeSystem } from './valueset-code-system-rules.js';
import type { ValueSetCache } from './valueset-cache.js';
import { ValueSetPackageLoader } from './valueset-package-loader.js';
import {
  buildDisplayMismatchFixHint,
  resourceTypeFromElementPath,
  type BindingStrength,
  type CodeInfo,
} from './valueset-display-utils.js';
import { type FhirVersion, versionedExpansionCacheKey } from './valueset-expansion-cache-key.js';
import { versionedCacheKey } from './valueset-package-utils.js';
import { codeSystemCanonicalsEquivalent } from './code-system-canonical-aliases.js';
import { conceptFilterMembership, hasUnknownTerminologyModifiers } from './valueset-concept-filter-membership.js';

type DisplayContext = Parameters<typeof validateDisplayMatchesCodeSystem>[4];

export async function validateDisplaysForCodeInfos(
  rawCode: unknown,
  codeInfos: CodeInfo[],
  valueSetUrl: string,
  elementPath: string,
  context: Omit<DisplayContext, 'resolveMembership'> & {
    resolveMembership: (codeInfo: CodeInfo, version?: string) => Promise<CodeBindingOutcome>;
  },
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  for (const codeInfo of codeInfos) {
    const issue = await validateDisplayMatchesCodeSystem(rawCode, codeInfo, valueSetUrl, elementPath, {
      ...context, resolveMembership: version => context.resolveMembership(codeInfo, version),
    });
    if (issue) issues.push(issue);
  }
  return issues;
}

export async function validateDisplayMatchesCodeSystem(
  rawCode: unknown,
  codeInfo: CodeInfo,
  valueSetUrl: string,
  elementPath: string,
  context: {
    bindingStrength?: BindingStrength;
    profileUrl?: string;
    displayLanguage?: string;
    defaultCodeSystemVersions?: Record<string, string>;
    resolveMembership?: (version?: string) => Promise<CodeBindingOutcome>;
    fhirVersion?: FhirVersion;
    cache: ValueSetCache;
    packageLoader: ValueSetPackageLoader;
  },
): Promise<ValidationIssue | null> {
  if (!codeInfo.system || !codeInfo.display) return null;
  const actualDisplay = codeInfo.display;

  const definitions = await resolveDisplayDefinitions(codeInfo, valueSetUrl, context);
  const assessments = definitions.flatMap(({ codeSystem, provider, membership, codeRejected }) => {
    if (codeRejected) return [];
    if (provider) return membership === 'invalid' ? [] : [membership !== 'unverified'
      ? assessProviderDisplay(provider, codeInfo.code, actualDisplay, context.displayLanguage)
      : { outcome: 'unverified' as const, displays: [] }];
    const concept = codeSystem && isAssertableCodeSystem(codeSystem)
      ? findDisplayConcept(codeSystem, codeInfo.code) : null;
    if (membership === 'invalid' || (codeSystem?.content === 'complete' && !concept)) return [];
    return [concept && codeSystem && membership !== 'unverified'
      ? assessLocalDisplay(codeSystem, concept, actualDisplay, context.displayLanguage)
      : { outcome: 'unverified' as const, displays: [] }];
  });
  if (definitions.length > 0 && assessments.length === 0) return null;
  if (assessments.some(assessment => assessment.outcome === 'accepted')) return null;
  const displayPath = resolveDisplayPath(rawCode, elementPath, codeInfo);
  if (assessments.length === 0 || assessments.some(assessment => assessment.outcome === 'unverified')) {
    return displayUnverifiedIssue(codeInfo, displayPath, displayUnverifiedMessage(codeInfo, context.displayLanguage),
      assessments.some(assessment => 'defaultMatch' in assessment && assessment.defaultMatch) ? 'information' : 'warning',
      context.displayLanguage, context.profileUrl, { valueSet: valueSetUrl, bindingStrength: context.bindingStrength,
        localDisplayAuthority: definitions.some(candidate => candidate.provider || candidate.codeSystem && isAssertableCodeSystem(candidate.codeSystem)),
        requestedCodeSystemVersions: definitions.map(candidate => candidate.version ?? null) });
  }
  const expectedDisplay = assessments.flatMap(assessment => assessment.displays)[0];
  if (!expectedDisplay) return null;
  return createValidationIssue({
    code: 'terminology-display-mismatch',
    path: displayPath,
    resourceType: resourceTypeFromElementPath(elementPath),
    profile: context.profileUrl,
    customMessage:
      (assessments.some(assessment => 'inactiveMatch' in assessment && assessment.inactiveMatch)
        ? `Inactive Display Name '${actualDisplay}' for ${codeInfo.system}#${codeInfo.code}. `
        : `Wrong Display Name '${actualDisplay}' for ${codeInfo.system}#${codeInfo.code}. `) +
      `Valid display is '${expectedDisplay}'`,
    // The display is held to the code system, not to the binding: the
    // reference validator reports a wrong display as an error at any strength.
    severityOverride: 'error',
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

async function resolveDisplayDefinitions(
  codeInfo: CodeInfo,
  valueSetUrl: string,
  context: { fhirVersion?: FhirVersion; cache: ValueSetCache; packageLoader: ValueSetPackageLoader;
    defaultCodeSystemVersions?: Record<string, string>; resolveMembership?: (version?: string) => Promise<CodeBindingOutcome> },
): Promise<Array<{ codeSystem: CodeSystem | null; provider?: ProviderSnapshot; version?: string; membership?: CodeBindingOutcome; codeRejected?: boolean }>> {
  if (!codeInfo.system) return [];
  const system = codeInfo.system;
  const fhirVersion = context.fhirVersion ?? context.cache.sourceContexts.context()?.fhirVersion;
  return context.cache.sourceContexts.run(fhirVersion, async () => {
    const valueSetCacheKey = versionedExpansionCacheKey(valueSetUrl, fhirVersion);
    const valueSet = context.cache.getValueSetFile(valueSetCacheKey)
      ?? context.cache.getValueSetFile(valueSetUrl)
      ?? context.cache.getValueSetFile(valueSetUrl.split('|')[0]);
    const systemIncludes = valueSet?.compose?.include?.filter(entry => codeSystemCanonicalsEquivalent(entry.system, system)) ?? [];
    const includes = systemIncludes.filter(entry => !entry.concept?.length || entry.concept.some(concept => concept.code === codeInfo.code));
    if (!codeInfo.version && systemIncludes.length > 0 && includes.length === 0) return [];
    const includeVersion = (entry: { system?: string; version?: string }) => {
      const version = entry.version ?? entry.system?.split('|')[1];
      return version === '*' ? undefined : version;
    };
    // Coding names its actual edition; compose versions independently constrain membership.
    const defaultVersion = resolveCodeSystemVersion(context, system);
    const versions = codeInfo.version !== undefined ? [codeInfo.version]
      : [...new Set(includes.length > 0 ? includes.map(entry =>
        entry.version === '*' || entry.system?.split('|')[1] === '*' ? undefined : includeVersion(entry) ?? defaultVersion)
        : [defaultVersion])];
    return Promise.all(versions.map(async version => {
      const independent = !codeInfo.version && versions.length === 1
        && hasSingleDisplaySelection(valueSet, valueSetUrl, system, includes);
      const constrained = !codeInfo.version && includes.some(entry => includeVersion(entry) === version
        && (entry.filter?.length || entry.valueSet?.length));
      const key = versionedCacheKey(system, version, fhirVersion);
      const cached = [context.cache.getCodeSystem(key), context.cache.getCodeSystemFile(key),
        ...(version ? [context.cache.getCodeSystem(`${system}|${version}`), context.cache.getCodeSystemFile(`${system}|${version}`)] : []),
        context.cache.getCodeSystem(system), context.cache.getCodeSystemFile(system)]
        .find(candidate => candidate && (!version || candidate.version === version));
      const selected = context.packageLoader.loadLocalTerminologyAuthority
        ? await context.packageLoader.loadLocalTerminologyAuthority(system, fhirVersion, version, valueSet ?? undefined) : undefined;
      const provider = selected?.kind === 'provider' ? context.packageLoader.providerSnapshotForContext(selected, fhirVersion) : null;
      if (provider) return { codeSystem: null, provider, version,
        membership: constrained && !independent ? await context.resolveMembership?.(undefined) ?? 'unverified' : undefined };
      const loaded = selected === undefined ? cached ?? (context.packageLoader.loadCodeSystemForValueSet
        ? await context.packageLoader.loadCodeSystemForValueSet(valueSet ?? undefined, system, fhirVersion, version)
        : await context.packageLoader.loadCodeSystem(system,
          fhirVersion === 'R4' ? '4' : fhirVersion === 'R5' ? '5' : fhirVersion === 'R6' ? '6' : undefined, version))
        : selected?.kind === 'code-system' ? selected.codeSystem : null;
      const codeSystem = loaded && (!version || loaded.version === version) ? loaded : null;
      const selectedVersion = version ?? codeSystem?.version;
      const ownConcept = codeSystem && (!system.split('|')[1] || system.split('|')[1] === codeSystem.version)
        && conceptFilterMembership(codeSystem, codeInfo.code,
        { property: 'concept', op: '=', value: codeInfo.code }) === true;
      // Unknown filters do not erase own labels of a uniquely selected edition.
      // Alternative editions still need their own membership evidence.
      const membership = constrained && !(independent && ownConcept) ? selectedVersion
        ? await context.resolveMembership?.(selectedVersion) ?? 'unverified' : 'unverified' : undefined;
      return { codeSystem, version, membership, codeRejected: Boolean(codeSystem && importedNamedCodeRejected(
        codeSystem, codeInfo.code, system, version, fhirVersion, context.cache, selected?.kind === 'code-system',
      )) };
    }));
  });
}

function hasSingleDisplaySelection(valueSet: ValueSet | null | undefined, reference: string, system: string,
  includes: NonNullable<NonNullable<ValueSet['compose']>['include']>): boolean {
  const codingParts = system.split('|');
  if (codingParts.length > 2 || (codingParts.length === 2 && !codingParts[1])) return false;
  const parts = reference.split('|');
  const [canonical, version] = parts;
  if (parts.length > 2 || (parts.length === 2 && !version) || !valueSet || valueSet.url !== canonical || (version && valueSet.version !== version)
    || !includes.length || hasUnknownTerminologyModifiers(valueSet)
    || hasUnknownTerminologyModifiers(valueSet.compose)) return false;
  for (const entry of valueSet.compose?.include ?? []) {
    if (entry.system && !codeSystemCanonicalsEquivalent(entry.system, system)) continue;
    if (hasUnknownTerminologyModifiers(entry)
      || (entry.valueSet !== undefined && (!Array.isArray(entry.valueSet) || entry.valueSet.length > 0))
      || (entry.version !== undefined && (typeof entry.version !== 'string' || !entry.version.trim()))) return false;
    if (entry.version === '*' || entry.system?.split('|')[1] === '*') return false;
    const systemParts = entry.system?.split('|');
    if (systemParts && (systemParts.length > 2 || (systemParts.length === 2 && !systemParts[1]))) return false;
    const piped = systemParts?.[1];
    if (piped && entry.version && piped !== entry.version) return false;
  }
  return true;
}

function resolveDisplayPath(rawCode: unknown, elementPath: string, codeInfo: CodeInfo): string {
  const code = rawCode !== null && typeof rawCode === 'object' && !Array.isArray(rawCode)
    ? rawCode as Record<string, unknown>
    : undefined;
  if (Array.isArray(code?.coding)) {
    return `${elementPath}.coding[${codeInfo.codingIndex ?? 0}].display`;
  }
  return `${elementPath}.display`;
}


function findDisplayConcept(codeSystem: CodeSystem, code: string) {
  const imported = findImportedInventoryConcept(codeSystem, code);
  return imported === undefined ? findCodeSystemConcept(codeSystem.concept, code) : imported;
}


function importedNamedCodeRejected(codeSystem: CodeSystem, code: string, system: string,
  requestedVersion: string | undefined, fhirVersion: FhirVersion | undefined, cache: ValueSetCache,
  selectedByLoader: boolean): boolean {
  return cache.sourceContexts.run(fhirVersion, () => {
    const family = cache.sourceContexts.context()?.fhirVersion;
    if (family !== 'R4' && family !== 'R5' && family !== 'R6') return false;
    const inventory = parseMixedNamedInventory(codeSystem);
    if (inventory.kind !== 'named-inventory') return false;
    const membership = assessSelectedNamedMembership(inventory.definition, {
      sourceScopeKey: cache.sourceContexts.key(''), fhirFamily: family,
      selectedCanonical: codeSystem.url, selectedBusinessVersion: codeSystem.version ?? '',
      requestedCanonical: system, requestedBusinessVersion: requestedVersion,
      defaultSelection: selectedByLoader ? 'selected-by-existing-loader' : 'not-established',
    }, code);
    // A label cannot be evaluated for a named code this exact inventory has already rejected.
    return canAssertNamedCodeRejection(membership, code);
  });
}
