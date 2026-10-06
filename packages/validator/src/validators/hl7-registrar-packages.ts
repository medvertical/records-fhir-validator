import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { comparePackageVersions } from './valueset-package-utils.js';
import { resolveValueSetPackageDirectories } from './valueset-package-resource-access.js';

/**
 * HL7 Terminology and the core specification register what HL7 names: its
 * identifier systems and the OIDs of its code systems.
 */
const REGISTRAR_PACKAGE = /^(hl7\.terminology(?:\.r\d+)?|hl7\.fhir\.r\d+b?\.core)#(.+)$/;

/**
 * The package roots of the newest installed release of each registrar.
 * Retired entries stay in HL7 Terminology, so the newest release holds them all.
 */
export async function newestRegistrarPackages(directories: readonly string[]): Promise<string[]> {
  const newest = new Map<string, { version: string; packageRoot: string }>();
  for (const directory of directories) {
    let entries: string[];
    try {
      entries = await fs.readdir(directory);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const match = entry.match(REGISTRAR_PACKAGE);
      if (!match) continue;
      const current = newest.get(match[1]);
      if (current && comparePackageVersions(match[2], current.version) <= 0) continue;
      const packageRoot = await packageRootOf(path.join(directory, entry));
      if (packageRoot) newest.set(match[1], { version: match[2], packageRoot });
    }
  }
  return [...newest.values()].map(({ packageRoot }) => packageRoot).sort();
}

async function packageRootOf(packageDir: string): Promise<string | null> {
  for (const candidate of [path.join(packageDir, 'package'), packageDir]) {
    try {
      if ((await fs.stat(path.join(candidate, 'package.json'))).isFile()) return candidate;
    } catch { /* try the other layout */ }
  }
  return null;
}

let namespaces: { signature: string; bases: Promise<readonly string[]> } | undefined;

/**
 * Whether `system` sits in the CodeSystem space of an HL7 package that is
 * installed — HL7 Terminology (`http://terminology.hl7.org/CodeSystem/…`) or an
 * IG under `http://hl7.org/fhir/…`. Only there does a missing definition mean
 * the URL is wrong rather than that its package is absent. A misspelt segment
 * (`…/codesystem/consentscope`) still names that space.
 */
export async function inInstalledHl7CodeSystemSpace(
  system: string,
  directories: readonly string[] = resolveValueSetPackageDirectories(),
): Promise<boolean> {
  if (!system.startsWith('http://terminology.hl7.org/') && !system.startsWith('http://hl7.org/fhir/')) return false;
  const bases = await installedHl7CanonicalBases(directories);
  const lowerSystem = system.toLowerCase();
  return bases.some(base => lowerSystem.startsWith(`${base.toLowerCase()}/codesystem/`));
}

/** The canonical bases of the installed HL7 IGs and of HL7 Terminology. */
export async function installedHl7CanonicalBases(directories: readonly string[]): Promise<readonly string[]> {
  const packageDirs: string[] = [];
  for (const directory of directories) {
    try {
      for (const entry of await fs.readdir(directory)) {
        if (entry.includes('#')) packageDirs.push(path.join(directory, entry));
      }
    } catch { /* an absent store holds nothing */ }
  }
  const signature = packageDirs.sort().join('\n');
  if (namespaces?.signature !== signature) {
    namespaces = { signature, bases: readHl7CanonicalBases(packageDirs) };
  }
  return namespaces.bases;
}

async function readHl7CanonicalBases(packageDirs: readonly string[]): Promise<readonly string[]> {
  const bases = new Set<string>();
  for (const packageDir of packageDirs) {
    const packageRoot = await packageRootOf(packageDir);
    if (!packageRoot) continue;
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8')) as { canonical?: unknown };
      const canonical = typeof manifest.canonical === 'string' ? manifest.canonical.replace(/\/$/, '') : '';
      if (canonical === 'http://terminology.hl7.org'
        || (canonical.startsWith('http://hl7.org/fhir/') && canonical.length > 'http://hl7.org/fhir/'.length)) {
        bases.add(canonical);
      }
    } catch { /* a package without a readable manifest declares no namespace */ }
  }
  return [...bases];
}
