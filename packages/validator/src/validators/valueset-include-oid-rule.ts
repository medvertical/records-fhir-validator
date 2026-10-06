import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { newestRegistrarPackages } from './hl7-registrar-packages.js';
import { resolveValueSetPackageDirectories } from './valueset-package-resource-access.js';

/**
 * A ValueSet names the code systems it draws on by their canonical URL. An
 * OID that HL7 registered for a code system with another canonical
 * (`urn:oid:2.16.840.1.113883.5.1008` for v3-NullFlavor) is an identifier, not
 * that URL, and the reference validator rejects it in `compose.include` and
 * `compose.exclude`. A code system whose canonical is its OID (CDC Race &
 * Ethnicity) is named correctly that way.
 */
export async function validateValueSetIncludeSystemOids(
  resource: unknown,
  directories: readonly string[] = resolveValueSetPackageDirectories(),
): Promise<ValidationIssue[]> {
  if (!isRecord(resource) || resource.resourceType !== 'ValueSet' || !isRecord(resource.compose)) return [];
  const issues: ValidationIssue[] = [];
  for (const part of ['include', 'exclude'] as const) {
    const entries = resource.compose[part];
    if (!Array.isArray(entries)) continue;
    for (const [index, entry] of entries.entries()) {
      const system = isRecord(entry) ? entry.system : undefined;
      if (typeof system !== 'string' || !system.startsWith('urn:oid:')) continue;
      const canonicals = await canonicalsForCodeSystemOid(system, directories);
      if (!canonicals || canonicals.length === 0) continue;
      issues.push(createValidationIssue({
        code: 'tx-valueset-compose-system-oid',
        path: `ValueSet.compose.${part}[${index}]`,
        resourceType: 'ValueSet',
        customMessage: canonicals.length === 1
          ? `It is not valid to refer to a CodeSystem by an identifier like this '${system}' - use '${canonicals[0]}'`
          : `It is not valid to refer to a CodeSystem by an identifier like this '${system}', `
            + `and the identifier matches to multiple CodeSystem resources (${canonicals.join(',')})`,
        severityOverride: 'error',
        details: { system, canonicals },
      }));
    }
  }
  return issues;
}

type OidRegistry = { byOid: Map<string, Set<string>>; selfNamed: Set<string> };

let registry: { signature: string; oids: Promise<OidRegistry> } | undefined;

/** The canonical URLs of the code systems registered under `oid`, or null when nothing is known. */
async function canonicalsForCodeSystemOid(
  oid: string,
  directories: readonly string[],
): Promise<string[] | null> {
  const registrars = await newestRegistrarPackages(directories);
  if (registrars.length === 0) return null;
  const signature = registrars.join('\n');
  if (registry?.signature !== signature) registry = { signature, oids: collectOids(registrars) };
  const { byOid, selfNamed } = await registry.oids;
  if (selfNamed.has(oid)) return [];
  return [...byOid.get(oid) ?? []].sort();
}

async function collectOids(packageRoots: readonly string[]): Promise<OidRegistry> {
  const byOid = new Map<string, Set<string>>();
  const selfNamed = new Set<string>();
  for (const packageRoot of packageRoots) {
    for (const filename of await codeSystemFiles(packageRoot)) {
      const codeSystem = await readJson(path.join(packageRoot, filename));
      if (!codeSystem || typeof codeSystem.url !== 'string') continue;
      if (codeSystem.url.startsWith('urn:oid:')) {
        selfNamed.add(codeSystem.url);
        continue;
      }
      for (const identifier of Array.isArray(codeSystem.identifier) ? codeSystem.identifier : []) {
        const value = isRecord(identifier) ? identifier.value : undefined;
        if (typeof value !== 'string' || !value.startsWith('urn:oid:')) continue;
        const canonicals = byOid.get(value) ?? new Set<string>();
        canonicals.add(codeSystem.url);
        byOid.set(value, canonicals);
      }
    }
  }
  return { byOid, selfNamed };
}

async function codeSystemFiles(packageRoot: string): Promise<string[]> {
  const index = await readJson(path.join(packageRoot, '.index.json'));
  if (index && Array.isArray(index.files)) {
    return index.files.flatMap(file =>
      isRecord(file) && file.resourceType === 'CodeSystem' && typeof file.filename === 'string'
        ? [file.filename]
        : []);
  }
  try {
    return (await fs.readdir(packageRoot)).filter(name => name.startsWith('CodeSystem-') && name.endsWith('.json'));
  } catch {
    return [];
  }
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
