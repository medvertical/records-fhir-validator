import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { writeMinimalR4CorePackage, writeMiiPresetSmokePackage } from './smoke-fhir-packages.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const consumerNode = process.env.RECORDS_PACKAGE_SMOKE_NODE || process.execPath;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: {
        ...process.env,
        ...(options.env ?? {}),
      },
      stdio: options.stdio ?? 'pipe',
    });

    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const rendered = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      reject(new Error(`${command} ${args.join(' ')} exited with ${code}\n${rendered}`));
    });
  });
}

async function packWorkspace(workspace, destination) {
  const { stdout } = await run('npm', [
    'pack',
    '--json',
    '--workspace',
    workspace,
    '--pack-destination',
    destination,
  ]);

  const [packed] = JSON.parse(stdout);
  if (!packed?.filename || !Array.isArray(packed.files)) {
    throw new Error(`npm pack did not report a tarball for ${workspace}`);
  }
  const allowed = /^(?:dist\/|examples\/|(?:README|CHANGELOG|CONTRIBUTING|SECURITY)\.md$|LICENSE(?:\.FHIRsmith)?$|package\.json$)/;
  const forbidden = /(^|\/)(?:__tests__|__fixtures__|node_modules|\.env)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?(?:\.map)?$|(?:^|\/)iso4217-provider-snapshot\.json$/;
  const privateModules = /^(?:dist\/modules\/|dist\/.*workspace-validation-modules)|(?:^|\/)erp-2\.22\.json$/;
  const unexpected = packed.files.find(({ path }) => !allowed.test(path) || forbidden.test(path) || privateModules.test(path));
  if (unexpected) throw new Error(`Unexpected file in ${workspace} tarball: ${unexpected.path}`);
  if (workspace === '@records-fhir/validator' && !packed.files.some(({ path }) => path === 'LICENSE.FHIRsmith')) {
    throw new Error('The validator tarball is missing its FHIRsmith license.');
  }
  return join(destination, basename(packed.filename));
}

const tmp = await mkdtemp(join(tmpdir(), 'records-fhir-validator-smoke-'));
const packageDir = join(tmp, 'consumer');
const sourcePackage = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
const runtimeSecurityOverrides = {
  '@lhncbc/ucum-lhc': sourcePackage.overrides['@lhncbc/ucum-lhc'],
  'follow-redirects': sourcePackage.overrides['follow-redirects'],
};

try {
  const typesTarball = await packWorkspace('@records-fhir/validation-types', tmp);
  const validatorTarball = await packWorkspace('@records-fhir/validator', tmp);

  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify({ type: 'module', private: true, overrides: runtimeSecurityOverrides }, null, 2),
  );

  await run('npm', [
    'install',
    '--ignore-scripts',
    typesTarball,
    validatorTarball,
  ], { cwd: packageDir });

  await run('npm', ['audit', '--omit=dev', '--audit-level=moderate'], { cwd: packageDir });

  await run(consumerNode, [
    '--input-type=module',
    '--eval',
    [
      "import { DISPATCHABLE_STRUCTURAL_ENGINES } from '@records-fhir/validation-types/validation/structural-engines';",
      "if (DISPATCHABLE_STRUCTURAL_ENGINES.join(',') !== 'records,hapi,schema') process.exit(1);",
    ].join('\n'),
  ], { cwd: packageDir });

  // Type-only exports erase at runtime, so importing them proves nothing. The
  // declaration file is what a consumer's compiler reads. Comments are stripped
  // first and only export statements are searched: a docblock mentioning the
  // type is emitted into the declaration too, and would satisfy a bare name
  // match while the export itself was gone.
  const rootDeclaration = await readFile(
    join(packageDir, 'node_modules', '@records-fhir', 'validator', 'dist', 'index.d.ts'),
    'utf8',
  );
  const exportStatements = rootDeclaration
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .split(/;\s*\n/)
    .filter((statement) => /^\s*export\b/.test(statement));
  for (const exported of ['ValidationIssue', 'ValidationSettings']) {
    const pattern = new RegExp(`(?:^|[{,\\s])(?:type\\s+)?${exported}(?:[},\\s]|$)`);
    if (!exportStatements.some((statement) => pattern.test(statement))) {
      throw new Error(
        `${exported} is not exported from the packed root declaration; the public `
          + 'signatures name it, so a consumer cannot type what this package returns',
      );
    }
  }

  const packageCache = join(packageDir, 'fhir-package-cache');
  await writeMinimalR4CorePackage(packageCache);
  await writeMiiPresetSmokePackage(packageCache);
  await writeFile(
    join(packageDir, 'smoke.mjs'),
    `
import {
  ValueSetValidator,
  createFilesystemProfileSource,
  getRecordsValidatorClass,
  parseFhirJson,
  setEngineLogger,
  setProfileSource,
} from '@records-fhir/validator';
import { toOperationOutcome } from '@records-fhir/validator/conformance';
import { createMii2026ValidationSettings } from '@records-fhir/validation-types';

for (const specifier of ['@records-fhir/validator/modules', '@records-fhir/validation-types/validation/workspace-modules']) {
  try {
    await import(specifier);
    throw new Error('Unexpected package export: ' + specifier);
  } catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
  }
}

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

setEngineLogger(noopLogger);
setProfileSource(createFilesystemProfileSource({ packageDirs: [] }));

const RecordsValidator = await getRecordsValidatorClass();
const packageCachePath = new URL('./fhir-package-cache', import.meta.url).pathname;
const validator = new RecordsValidator({
  autoDownload: false,
  enableCaching: false,
  packageCachePath,
  bundledProfilesPath: packageCachePath,
});

if (typeof validator.validate !== 'function') {
  throw new Error('RecordsValidator.validate is not available');
}

const miiSettings = createMii2026ValidationSettings({ packageDownload: { autoDownload: false } });
const profileUrl = 'https://example.test/StructureDefinition/Patient';
const { resources } = parseFhirJson(JSON.stringify({
  resourceType: 'Patient', id: 'preset-smoke', meta: { profile: [profileUrl] },
}));
const miiResult = await validator.validateBatch(resources, { fhirVersion: 'R4', settings: miiSettings });
const miiIssues = miiResult.get(resources[0]);
const loaded = await validator.loadProfileWithSnapshot(profileUrl, 'R4');
const pins = validator.getSdLoader().getPackageVersionPins();
if (miiSettings.packageDownload.workspaceModules !== undefined
  || pins['de.medizininformatikinitiative.kerndatensatz.base'] !== '2026.0.0'
  || loaded?.url !== profileUrl || loaded?.version !== '2026.0.0'
  || !Array.isArray(miiIssues) || miiIssues.some(issue => issue.severity === 'error')) {
  throw new Error('Packed KDS 2026 preset did not validate against the pinned profile: ' + JSON.stringify(miiIssues));
}

const metadataIssues = await validator.validateMetadata({
  resourceType: 'Patient',
  id: 'metadata-runtime-smoke',
  meta: {
    profile: ['http://hl7.org/fhir/StructureDefinition/Patient'],
    tag: [{ code: 'smoke' }],
  },
});
if (metadataIssues.some((issue) => (
  issue.code === 'validation-error' ||
  issue.code === 'metadata-validation-error' ||
  issue.message?.includes('Directory import')
))) {
  throw new Error('Metadata runtime smoke returned an engine failure: ' + JSON.stringify(metadataIssues));
}

const valueSetValidator = new ValueSetValidator();
const issues = await valueSetValidator.validateBinding(
  'definitely-not-a-fhir-observation-status',
  {
    strength: 'required',
    valueSet: 'http://hl7.org/fhir/ValueSet/observation-status|4.0.1',
  },
  'Observation.status',
);

if (!issues.some((issue) => issue.code === 'terminology-binding-required-code')) {
  throw new Error('Expected required terminology binding issue from package import');
}

const outcome = toOperationOutcome(issues);
if (outcome.resourceType !== 'OperationOutcome' || outcome.issue.length === 0) {
  throw new Error('OperationOutcome conversion failed');
}
`,
  );

  await run(consumerNode, ['smoke.mjs'], { cwd: packageDir });

  await mkdir(join(packageDir, 'fixtures'), { recursive: true });
  await writeFile(
    join(packageDir, 'fixtures', 'patient.json'),
    JSON.stringify({ resourceType: 'Patient', id: 'cli-smoke' }, null, 2),
  );
  await writeFile(
    join(packageDir, 'fixtures', 'skip-me.json'),
    JSON.stringify({ resourceType: 'Observation', id: 'skip-me' }, null, 2),
  );
  await writeFile(join(packageDir, 'fixtures', 'notes.txt'), 'not fhir json\n');

  const cliHome = join(packageDir, 'home');
  const cliPackageCache = join(packageDir, 'fhir-package-cache');
  await mkdir(cliHome, { recursive: true });
  await writeMinimalR4CorePackage(cliPackageCache);

  await run(
    consumerNode,
    [
      join(packageDir, 'node_modules/@records-fhir/validator/dist/cli.js'),
      'fixtures',
      '--include',
      'fixtures/**/*.json',
      '--exclude',
      'fixtures/skip-*.json',
      '--format=json',
      '--summary-only',
      '--output',
      'validation-report.json',
      '--fail-on=none',
    ],
    {
      cwd: packageDir,
      env: {
        HOME: cliHome,
        FHIR_PACKAGE_CACHE_PATH: cliPackageCache,
        RECORDS_BUNDLED_PROFILES_PATH: cliPackageCache,
      },
    },
  );

  const report = JSON.parse(await readFile(join(packageDir, 'validation-report.json'), 'utf8'));
  if (report.summary?.files !== 1 || report.summary?.errors !== 0) {
    throw new Error(`Unexpected CLI smoke summary: ${JSON.stringify(report.summary)}`);
  }
  if ('results' in report) {
    throw new Error('Expected --summary-only JSON output to omit results');
  }

  const { stdout: consumerVersion } = await run(consumerNode, ['--version']);
  console.log(`OSS validator package smoke test passed (consumer Node ${consumerVersion.trim()})`);
} finally {
  if (process.env.KEEP_SMOKE_TMP !== '1') {
    await rm(tmp, { force: true, recursive: true });
  } else {
    console.log(`Keeping smoke test directory: ${tmp}`);
  }
}
