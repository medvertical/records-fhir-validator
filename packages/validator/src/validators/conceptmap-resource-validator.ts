import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import {
  codeSystemDisplayFor,
  codeSystemHasCode,
  getCachedCodeSystem,
  isTxOnlySystem,
} from './terminology-resource-utils.js';
import { ValueSetCache } from './valueset-cache.js';
import { ValueSetPackageLoader } from './valueset-package-loader.js';
import type { CodeSystem } from './valueset-types.js';

/**
 * Validate ConceptMap source and target codes and displays against their
 * CodeSystems, matching the diagnostics Java emits in `R5.cs-val-cm-base`.
 * Codes are only judged against a CodeSystem whose content is complete; the
 * reference validator leaves the others unchecked as well.
 */
export function validateConceptMapResource(
  cm: unknown,
  cache: ValueSetCache = new ValueSetCache(),
  codeSystems: ReadonlyMap<string, CodeSystem> = new Map(),
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const conceptMap = asRecord(cm);
  const groups = Array.isArray(conceptMap?.group) ? conceptMap.group : [];
  const codeSystemFor = (system: string | undefined, version: unknown) => {
    const identity = systemIdentity(system, version);
    if (!identity) return undefined;
    const found = codeSystems.get(identity.key) ?? getCachedCodeSystem(identity.key, cache);
    return !identity.version || found?.version === identity.version ? found : undefined;
  };

  for (let gi = 0; gi < groups.length; gi++) {
    const group = asRecord(groups[gi]);
    const sourceSystem = typeof group?.source === 'string' ? group.source : undefined;
    const targetSystem = typeof group?.target === 'string' ? group.target : undefined;

    issues.push(...describeUncheckedSide(sourceSystem, gi, 'source'), ...describeUncheckedSide(targetSystem, gi, 'target'));

    const sourceCs = sourceSystem && !isTxOnlySystem(sourceSystem) ? codeSystemFor(sourceSystem, group?.sourceVersion) : undefined;
    const targetCs = targetSystem && !isTxOnlySystem(targetSystem) ? codeSystemFor(targetSystem, group?.targetVersion) : undefined;
    const elements = Array.isArray(group?.element) ? group.element : [];
    for (let ei = 0; ei < elements.length; ei++) {
      const element = asRecord(elements[ei]);
      const elementPath = `ConceptMap.group[${gi}].element[${ei}]`;
      if (sourceCs && sourceSystem) {
        issues.push(...checkMappedCode(element, sourceCs, sourceSystem, elementPath, 'source'));
      }
      const targets = Array.isArray(element?.target) ? element.target : [];
      for (let ti = 0; ti < targets.length; ti++) {
        if (!targetCs || !targetSystem) continue;
        issues.push(...checkMappedCode(asRecord(targets[ti]), targetCs, targetSystem, `${elementPath}.target[${ti}]`, 'target'));
      }
    }
  }

  return issues;
}

/** Why the codes on one side of a group go unchecked, as the reference validator says it. */
function describeUncheckedSide(system: string | undefined, gi: number, side: 'source' | 'target'): ValidationIssue[] {
  const label = side === 'source' ? 'Source' : 'Target';
  if (!system) {
    return [createValidationIssue({
      code: `tx-conceptmap-${side}-missing`,
      path: `ConceptMap.group[${gi}]`,
      resourceType: 'ConceptMap',
      customMessage: `No ${label} Code System, so the ${side} codes cannot be checked`,
      severityOverride: 'warning',
    })];
  }
  if (!isTxOnlySystem(system)) return [];
  return [createValidationIssue({
    code: `tx-conceptmap-${side}-tx-only`,
    path: `ConceptMap.group[${gi}].${side}`,
    resourceType: 'ConceptMap',
    customMessage:
      `${label} Code System ${system} is only supported on the terminology server, ` +
      `so the ${side} codes are not validated for performance reasons`,
    severityOverride: 'information',
  })];
}

/** The CodeSystems a ConceptMap maps between, read from the local packages. */
export async function loadConceptMapCodeSystems(
  cm: unknown,
  fhirVersion: 'R4' | 'R5' | 'R6',
  cache: ValueSetCache = new ValueSetCache(),
): Promise<Map<string, CodeSystem>> {
  const codeSystems = new Map<string, CodeSystem>();
  const conceptMap = asRecord(cm);
  if (conceptMap?.resourceType !== 'ConceptMap') return codeSystems;
  const loader = new ValueSetPackageLoader(cache);
  const groups = Array.isArray(conceptMap.group) ? conceptMap.group : [];
  for (const group of groups.map(asRecord)) {
    for (const [system, version] of [[group?.source, group?.sourceVersion], [group?.target, group?.targetVersion]]) {
      const identity = systemIdentity(system, version);
      if (!identity || codeSystems.has(identity.key) || isTxOnlySystem(identity.url)) continue;
      const loaded = await loader.loadCodeSystem(
        identity.url, fhirVersion.slice(1), identity.version,
      ).catch(() => null);
      if (loaded && (!identity.version || loaded.version === identity.version)) codeSystems.set(identity.key, loaded);
    }
  }
  return codeSystems;
}

function systemIdentity(system: unknown, version: unknown): { url: string; version?: string; key: string } | undefined {
  if (typeof system !== 'string' || !system) return undefined;
  const [url, canonicalVersion] = system.split('|');
  const resolvedVersion = typeof version === 'string' && version ? version : canonicalVersion || undefined;
  return { url, version: resolvedVersion, key: resolvedVersion ? `${url}|${resolvedVersion}` : url };
}

function checkMappedCode(
  mapped: Record<string, unknown> | undefined,
  cs: CodeSystem,
  system: string,
  path: string,
  side: 'source' | 'target',
): ValidationIssue[] {
  if (typeof mapped?.code !== 'string') return [];
  if (!codeSystemHasCode(cs, mapped.code)) {
    if (cs.content !== 'complete') return [];
    const versioned = typeof cs.version === 'string' ? `${cs.url ?? system}|${cs.version}` : cs.url ?? system;
    return [createValidationIssue({
      code: `tx-conceptmap-${side}-code-invalid`,
      path: `${path}.code`,
      resourceType: 'ConceptMap',
      customMessage: `The ${side} code '${mapped.code}' is not valid in the code system ${versioned}`,
      severityOverride: 'error',
    })];
  }
  const expected = codeSystemDisplayFor(cs, mapped.code);
  if (typeof mapped.display !== 'string' || !expected) return [];
  if (expected.toLowerCase() === mapped.display.toLowerCase()) return [];
  return [createValidationIssue({
    code: `tx-conceptmap-${side}-display-invalid`,
    path: `${path}.code`,
    resourceType: 'ConceptMap',
    customMessage:
      `The ${side} display '${mapped.display}' for the code '${system}#${mapped.code}' ` +
      `is not valid. Possible displays: '${expected}'`,
    severityOverride: 'warning',
  })];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
