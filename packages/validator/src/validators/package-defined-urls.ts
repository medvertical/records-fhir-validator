import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * The definitions the reference validator loads from a package — its own and
 * its examples — are those of the types ValidatorUtils.loaderForVersion names
 * (plus the guide itself). A Library, Measure or PlanDefinition an IG
 * publishes is not among them, so a URL naming one does not resolve.
 */
const LOADED_TYPES = new Set([
  'CapabilityStatement', 'StructureDefinition', 'ValueSet', 'CodeSystem', 'SearchParameter',
  'OperationDefinition', 'Questionnaire', 'ConceptMap', 'StructureMap', 'NamingSystem', 'ImplementationGuide',
]);
const FOLDERS = ['package', path.join('package', 'example')];
// An R4 NamingSystem has no url; R5's travels in a cross-version extension.
const NAMING_SYSTEM_URL = /^http:\/\/hl7\.org\/fhir\/\d\.\d\/StructureDefinition\/extension-NamingSystem\.url$/;

type Versions = Map<string, Set<string>>;
type IndexEntry = { filename: string; resourceType?: string; url?: string; version?: string };
type Indexed = { urls: Versions; exampleCodeSystems: ReadonlySet<string>; namingSystemFiles: readonly string[] };

// Keyed by the installed package folders, so an installation invalidates it.
let indexed: { signature: string; loaded: Promise<Indexed> } | undefined;
// Reading every NamingSystem is costly and only settles a URL the indexes miss.
let namingSystems: { signature: string; urls: Promise<ReadonlySet<string>> } | undefined;

/**
 * Whether an installed package defines the URL in the version asked for — exactly, or by its
 * major.minor release — or registers it as a NamingSystem's own URL or uri identifier.
 */
export async function isPackageDefinedUrl(url: string, version: string | undefined, directories: readonly string[]): Promise<boolean> {
  const folders = await packageFolders(directories);
  const signature = folders.join('\n');
  const { urls, namingSystemFiles } = await packageIndexes(folders, signature);
  const versions = urls.get(url);
  if (versions && definesVersion(versions, version)) return true;
  if (namingSystems?.signature !== signature) namingSystems = { signature, urls: namingSystemUrls(namingSystemFiles) };
  return (await namingSystems.urls).has(url);
}

/**
 * Code systems a package publishes only among its examples, in any namespace:
 * the reference validator loads them with the package (MedMorph's
 * `us-ph-usage-context-type`).
 */
export async function exampleCodeSystemUrls(directories: readonly string[]): Promise<ReadonlySet<string>> {
  const folders = await packageFolders(directories);
  return (await packageIndexes(folders, folders.join('\n'))).exampleCodeSystems;
}

function definesVersion(versions: ReadonlySet<string>, version: string | undefined): boolean {
  if (version === undefined || versions.has('') || versions.has(version)) return true;
  return /^\d+\.\d+$/.test(version) && [...versions].some(known => known.startsWith(`${version}.`));
}

async function packageFolders(directories: readonly string[]): Promise<string[]> {
  const folders: string[] = [];
  for (const directory of directories) {
    try {
      for (const entry of await fs.readdir(directory)) {
        if (entry.includes('#')) folders.push(...FOLDERS.map(folder => path.join(directory, entry, folder)));
      }
    } catch { /* an absent store holds nothing */ }
  }
  return folders.sort();
}

function packageIndexes(folders: readonly string[], signature: string): Promise<Indexed> {
  if (indexed?.signature !== signature) indexed = { signature, loaded: readIndexes(folders) };
  return indexed.loaded;
}

async function readIndexes(folders: readonly string[]): Promise<Indexed> {
  const urls: Versions = new Map();
  const exampleCodeSystems = new Set<string>();
  const namingSystemFiles: string[] = [];
  for (const folder of folders) {
    const examples = path.basename(folder) === 'example';
    for (const entry of await folderEntries(folder)) {
      if (!entry.resourceType || !LOADED_TYPES.has(entry.resourceType)) continue;
      if (entry.resourceType === 'NamingSystem') namingSystemFiles.push(path.join(folder, entry.filename));
      if (!entry.url) continue;
      const url = entry.url.split('|')[0];
      if (examples && entry.resourceType === 'CodeSystem') exampleCodeSystems.add(url);
      const versions = urls.get(url) ?? new Set<string>();
      versions.add(entry.version ?? '');
      urls.set(url, versions);
    }
  }
  return { urls, exampleCodeSystems, namingSystemFiles };
}

async function folderEntries(folder: string): Promise<IndexEntry[]> {
  try {
    const index = JSON.parse(await fs.readFile(path.join(folder, '.index.json'), 'utf8')) as { files?: unknown };
    if (Array.isArray(index.files)) return index.files.flatMap(indexEntry);
  } catch { /* read the resources themselves */ }
  let files: string[];
  try {
    files = (await fs.readdir(folder)).filter(name => name.endsWith('.json') && name !== 'package.json');
  } catch {
    return [];
  }
  const entries: IndexEntry[] = [];
  for (const filename of files) {
    try {
      const resource = JSON.parse(await fs.readFile(path.join(folder, filename), 'utf8')) as Record<string, unknown>;
      entries.push(...indexEntry({ ...resource, filename }));
    } catch { /* a file that does not parse defines nothing */ }
  }
  return entries;
}

function indexEntry(value: unknown): IndexEntry[] {
  if (!value || typeof value !== 'object') return [];
  const { filename, resourceType, url, version } = value as Record<string, unknown>;
  if (typeof filename !== 'string') return [];
  return [{
    filename,
    ...(typeof resourceType === 'string' ? { resourceType } : {}),
    ...(typeof url === 'string' ? { url } : {}),
    ...(typeof version === 'string' ? { version } : {}),
  }];
}

/** The NamingSystems' own URLs and the uri identifiers they register. */
async function namingSystemUrls(files: readonly string[]): Promise<ReadonlySet<string>> {
  const urls = new Set<string>();
  for (const file of files) {
    try {
      const namingSystem = JSON.parse(await fs.readFile(file, 'utf8')) as { extension?: unknown; uniqueId?: unknown };
      for (const extension of Array.isArray(namingSystem.extension) ? namingSystem.extension : []) {
        const { url, valueUri } = (extension ?? {}) as { url?: unknown; valueUri?: unknown };
        if (typeof url === 'string' && NAMING_SYSTEM_URL.test(url) && typeof valueUri === 'string') urls.add(valueUri);
      }
      for (const uniqueId of Array.isArray(namingSystem.uniqueId) ? namingSystem.uniqueId : []) {
        const { type, value } = (uniqueId ?? {}) as { type?: unknown; value?: unknown };
        if (type === 'uri' && typeof value === 'string') urls.add(value);
      }
    } catch { /* an unreadable NamingSystem registers nothing */ }
  }
  return urls;
}
