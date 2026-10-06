import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_PATH = fileURLToPath(import.meta.url);
const SOURCE_STORE = fileURLToPath(new URL('./fixtures/fhir-core-test-packages/', import.meta.url));
const EXPORTED_STORE = 'tests/fixtures/fhir-packages';
const MANIFEST_SHA256 = '7948303d2468fb648f5c7038fddb9ac64e6589a84b9cdcdf86043971c6549b7f';
const INVENTORY_SHA256 = '982cda9dd90fd93b591be00ce266771592a6b06227487a6b7b1405da0d089923';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireCondition(condition, message) { if (!condition) throw new Error(message); }

async function regularDirectory(directory) {
  const stat = await lstat(directory);
  requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), 'Fixture store must be a regular directory without symlinks');
}

async function fixtureManifest(storeRoot) {
  const manifestPath = join(storeRoot, 'manifest.json');
  const stat = await lstat(manifestPath);
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 16 * 1024,
    'Fixture pin manifest must be a small regular file without symlinks');
  const bytes = await readFile(manifestPath);
  requireCondition(hash(bytes) === MANIFEST_SHA256, 'Fixture pin manifest checksum differs');
  const manifest = JSON.parse(bytes.toString('utf8'));
  requireCondition(record(manifest) && manifest.schema === 'records.validator.portable-test-fixtures.v1'
    && manifest.scope?.partialPackage === true && manifest.scope?.testFixturesOnly === true
    && manifest.scope?.originalDefinitionBytesChanged === false && manifest.scope?.includesFullPackage === false
    && manifest.scope?.includesDeclaredDependencyClosure === false && manifest.scope?.runtimeTerminologyAuthorityClaimed === false
    && manifest.package?.id === 'hl7.fhir.r4.core' && manifest.package?.version === '4.0.1'
    && manifest.package?.declaredLicense === 'CC0-1.0' && manifest.package?.originalManifestUnchanged === true
    && manifest.provenance?.inventorySha256 === INVENTORY_SHA256
    && Array.isArray(manifest.files) && manifest.files.length === 5, 'Fixture scope or original provenance differs');
  return manifest;
}

async function storeFiles(storeRoot, expectedFiles) {
  const actual = [];
  const expectedDirectories = new Set();
  for (const file of expectedFiles) {
    let directory = dirname(file);
    while (directory !== '.') { expectedDirectories.add(directory); directory = dirname(directory); }
  }
  async function collect(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(directory, entry.name);
      requireCondition(!entry.isSymbolicLink(), 'Fixture store contains a symlink');
      if (entry.isDirectory()) {
        requireCondition(expectedDirectories.has(relative), `Unexpected fixture directory: ${relative}`);
        await collect(absolute, relative);
      } else {
        requireCondition(entry.isFile() && expectedFiles.has(relative), `Unexpected fixture file: ${relative}`);
        actual.push(relative);
      }
    }
  }
  await collect(storeRoot);
  requireCondition(actual.length === expectedFiles.size && actual.every(file => expectedFiles.has(file)),
    'Fixture store inventory differs: original file is missing');
}

/** Authenticate the finite original test subset; this performs no writes or downloads. */
export async function verifyPortableValidatorTestFixtures(storeRoot) {
  storeRoot = resolve(storeRoot);
  await regularDirectory(storeRoot);
  const manifest = await fixtureManifest(storeRoot);
  const expectedFiles = new Set(['manifest.json', ...manifest.files.map(file => file.path)]);
  requireCondition(expectedFiles.size === 6 && manifest.files.every(file => record(file)
    && typeof file.path === 'string' && file.path.startsWith('hl7.fhir.r4.core#4.0.1/package/')
    && file.path.split('/').every(part => part && part !== '.' && part !== '..') && !file.path.includes('\\')
    && Number.isSafeInteger(file.sizeBytes) && file.sizeBytes > 0 && /^[a-f0-9]{64}$/.test(file.sha256)),
  'Invalid finite fixture file pins');
  await storeFiles(storeRoot, expectedFiles);
  for (const file of manifest.files) {
    const absolute = join(storeRoot, file.path);
    const stat = await lstat(absolute);
    requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.size === file.sizeBytes,
      `Fixture file size differs: ${file.path}`);
    const bytes = await readFile(absolute);
    requireCondition(hash(bytes) === file.sha256, `Fixture file checksum differs: ${file.path}`);
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (file.resourceType) requireCondition(parsed.resourceType === file.resourceType && parsed.url === file.canonical
      && parsed.version === file.resourceVersion, `Original fixture identity differs: ${file.path}`);
    else requireCondition(parsed.name === manifest.package.id && parsed.version === manifest.package.version
      && parsed.license === manifest.package.declaredLicense, 'Original FHIR package metadata differs');
  }
  return { schema: 'records.validator.portable-test-fixtures-verification.v1', storeRoot,
    files: manifest.files.length, originalDefinitions: 4, originalBytes: manifest.files.reduce((sum, file) => sum + file.sizeBytes, 0),
    manifestSha256: MANIFEST_SHA256, inventorySha256: INVENTORY_SHA256, partialTestFixtures: true };
}

/** Export only authenticated original test data, without copying or changing SDK files. */
export async function copyPortableValidatorTestFixtures(targetRoot) {
  targetRoot = resolve(targetRoot);
  await regularDirectory(targetRoot);
  await verifyPortableValidatorTestFixtures(SOURCE_STORE);
  const destination = join(targetRoot, EXPORTED_STORE);
  requireCondition(!(await lstat(destination).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  })), 'Exported fixture store already exists');
  await mkdir(dirname(destination), { recursive: true });
  await cp(SOURCE_STORE, destination, { recursive: true, force: false, errorOnExist: true, dereference: false });
  return verifyPortableValidatorTestFixtures(destination);
}

/** Keep derived test indexes in a fresh owned copy, separate from authenticated source fixtures. */
export async function createPortableValidatorTestStore(targetRoot) {
  targetRoot = resolve(targetRoot);
  await regularDirectory(targetRoot);
  const source = join(targetRoot, EXPORTED_STORE);
  await verifyPortableValidatorTestFixtures(source);
  const cacheParent = join(targetRoot, '.cache');
  await mkdir(cacheParent, { recursive: true });
  await regularDirectory(cacheParent);
  const ownedParent = await mkdtemp(join(cacheParent, 'validator-test-packages-'));
  requireCondition(ownedParent.startsWith(cacheParent + sep), 'Owned test store escapes its cache parent');
  // Exclusive copying needs an absent destination on every supported platform.
  const destination = join(ownedParent, 'packages');
  try {
    await cp(source, destination, { recursive: true, force: false, errorOnExist: true, dereference: false });
    await verifyPortableValidatorTestFixtures(destination);
    return destination;
  } catch (error) {
    await rm(ownedParent, { recursive: true, force: true });
    throw error;
  }
}

const invokedPath = process.argv[1] ? await realpath(resolve(process.argv[1])).catch(() => null) : null;
if (invokedPath === MODULE_PATH) {
  try {
    const args = process.argv.slice(2);
    requireCondition(args.length === 0 || (args.length === 2 && args[0] === '--store-root' && args[1]),
      'Usage: node scripts/oss/portable-validator-test-fixtures.mjs [--store-root <directory>]');
    const storeRoot = args.length ? resolve(args[1]) : fileURLToPath(new URL('../../tests/fixtures/fhir-packages/', import.meta.url));
    console.log(JSON.stringify(await verifyPortableValidatorTestFixtures(storeRoot)));
  } catch (error) {
    console.error(`Portable validator test fixtures: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
