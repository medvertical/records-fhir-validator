import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { normalizeResourceType } from '../issues/resource-type-normalizer.js';
import { newestRegistrarPackages } from './hl7-registrar-packages.js';
import { resolveValueSetPackageDirectories } from './valueset-package-resource-access.js';

/**
 * Identifier systems under `http://hl7.org/fhir/sid/` are HL7's to register,
 * and HL7 Terminology registers every one as a NamingSystem (core adds a few
 * CodeSystems). The reference validator resolves such a system against what it
 * has loaded and reports an unregistered one — `sid/eui-48` where only
 * `sid/eui-48/bluetooth` and `sid/eui-48/ethernet` exist — as an error.
 */
const SID_PREFIX = 'http://hl7.org/fhir/sid/';

let registry: { signature: string; sids: Promise<ReadonlySet<string>> } | undefined;

/**
 * The HL7 identifier systems the installed registrar packages define, or null
 * when no registrar is installed and nothing can be said.
 */
export async function registeredHl7Sids(
  directories: readonly string[] = resolveValueSetPackageDirectories(),
): Promise<ReadonlySet<string> | null> {
  const registrars = await newestRegistrarPackages(directories);
  if (registrars.length === 0) return null;
  const signature = registrars.join('\n');
  if (registry?.signature !== signature) {
    registry = { signature, sids: collectSids(registrars) };
  }
  const sids = await registry.sids;
  return sids.size > 0 ? sids : null;
}

/** An `Identifier.system` naming an HL7 identifier system nobody registered. */
export async function validateHl7IdentifierSystem(
  value: unknown,
  path: string,
  profileUrl?: string,
  directories?: readonly string[],
): Promise<ValidationIssue | null> {
  if (typeof value !== 'string' || !value.startsWith(SID_PREFIX)) return null;
  const sids = await registeredHl7Sids(directories);
  if (!sids || sids.has(value)) return null;
  return createValidationIssue({
    code: 'structural-url-unresolved',
    path,
    resourceType: normalizeResourceType('Unknown', path),
    profile: profileUrl,
    customMessage: `No definition could be found for URL value '${value}'`,
    details: {
      value,
      fixHint: 'Use an identifier system HL7 registers under http://hl7.org/fhir/sid/, or the issuer\'s own namespace.',
    },
  });
}

/**
 * Any other uri or url that names an HL7 identifier system is held to the
 * same registry: the reference validator resolves every URL in HL7's space
 * (a ConceptMap target of `sid/icd-10-us`). Coding and Identifier systems
 * answer to their own rules, and a defining url names itself.
 */
export async function validateHl7SidUri(
  value: unknown,
  type: string,
  path: string,
  profileUrl?: string,
  directories?: readonly string[],
): Promise<ValidationIssue | null> {
  if ((type !== 'uri' && type !== 'url') || /\.(?:system|url)$/.test(path)) return null;
  return validateHl7IdentifierSystem(value, path, profileUrl, directories);
}

async function collectSids(packageRoots: readonly string[]): Promise<ReadonlySet<string>> {
  const sids = new Set<string>();
  for (const packageRoot of packageRoots) {
    for (const file of await registrarFiles(packageRoot)) {
      if (file.resourceType === 'CodeSystem') {
        if (file.url?.startsWith(SID_PREFIX)) sids.add(file.url);
        continue;
      }
      for (const uniqueId of await namingSystemUris(path.join(packageRoot, file.filename))) {
        if (uniqueId.startsWith(SID_PREFIX)) sids.add(uniqueId);
      }
    }
  }
  return sids;
}

type RegistrarFile = { filename: string; resourceType: 'CodeSystem' | 'NamingSystem'; url?: string };

async function registrarFiles(packageRoot: string): Promise<RegistrarFile[]> {
  try {
    const index = JSON.parse(await fs.readFile(path.join(packageRoot, '.index.json'), 'utf8')) as { files?: unknown };
    if (Array.isArray(index.files)) return index.files.flatMap(registrarFile);
  } catch { /* fall back to the file names */ }
  try {
    return (await fs.readdir(packageRoot))
      .filter(name => name.startsWith('NamingSystem-') && name.endsWith('.json'))
      .map(filename => ({ filename, resourceType: 'NamingSystem' as const }));
  } catch {
    return [];
  }
}

function registrarFile(value: unknown): RegistrarFile[] {
  if (!value || typeof value !== 'object') return [];
  const file = value as { filename?: unknown; resourceType?: unknown; url?: unknown };
  if (typeof file.filename !== 'string') return [];
  if (file.resourceType === 'NamingSystem') return [{ filename: file.filename, resourceType: 'NamingSystem' }];
  if (file.resourceType === 'CodeSystem' && typeof file.url === 'string') {
    return [{ filename: file.filename, resourceType: 'CodeSystem', url: file.url }];
  }
  return [];
}

async function namingSystemUris(filePath: string): Promise<string[]> {
  try {
    const namingSystem = JSON.parse(await fs.readFile(filePath, 'utf8')) as { uniqueId?: unknown };
    if (!Array.isArray(namingSystem.uniqueId)) return [];
    return namingSystem.uniqueId.flatMap(uniqueId => {
      const entry = uniqueId as { type?: unknown; value?: unknown };
      return entry?.type === 'uri' && typeof entry.value === 'string' ? [entry.value] : [];
    });
  } catch {
    return [];
  }
}
