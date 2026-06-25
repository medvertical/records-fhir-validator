import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

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

function structureDefinition(type, elements) {
  return {
    resourceType: 'StructureDefinition',
    url: `http://hl7.org/fhir/StructureDefinition/${type}`,
    version: '4.0.1',
    fhirVersion: '4.0.1',
    name: type,
    status: 'active',
    kind: 'resource',
    abstract: false,
    type,
    snapshot: {
      element: [
        { id: type, path: type, min: 0, max: '*' },
        ...elements,
      ],
    },
  };
}

async function writePackageResource(packageDir, filename, resource) {
  await writeFile(join(packageDir, filename), `${JSON.stringify(resource, null, 2)}\n`, 'utf8');
}

async function writeMinimalR4CorePackage(cacheRoot) {
  const packageDir = join(cacheRoot, 'hl7.fhir.r4.core#4.0.1', 'package');
  await mkdir(packageDir, { recursive: true });
  await writePackageResource(packageDir, 'package.json', {
    name: 'hl7.fhir.r4.core',
    version: '4.0.1',
    fhirVersions: ['4.0.1'],
  });
  await writePackageResource(packageDir, 'StructureDefinition-Patient.json', structureDefinition('Patient', [
    {
      id: 'Patient.gender',
      path: 'Patient.gender',
      min: 0,
      max: '1',
      type: [{ code: 'code' }],
      binding: {
        strength: 'required',
        valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender',
      },
    },
    {
      id: 'Patient.birthDate',
      path: 'Patient.birthDate',
      min: 0,
      max: '1',
      type: [{ code: 'date' }],
    },
  ]));
  await writePackageResource(packageDir, 'ValueSet-administrative-gender.json', {
    resourceType: 'ValueSet',
    url: 'http://hl7.org/fhir/ValueSet/administrative-gender',
    version: '4.0.1',
    status: 'active',
    expansion: {
      contains: ['male', 'female', 'other', 'unknown'].map((code) => ({
        system: 'http://hl7.org/fhir/administrative-gender',
        code,
      })),
    },
  });
}

async function packWorkspace(workspace, destination) {
  const { stdout } = await run('npm', [
    'pack',
    '--workspace',
    workspace,
    '--pack-destination',
    destination,
  ]);

  const tarball = stdout
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (!tarball) {
    throw new Error(`npm pack did not report a tarball for ${workspace}`);
  }

  return join(destination, basename(tarball));
}

const tmp = await mkdtemp(join(tmpdir(), 'records-fhir-validator-smoke-'));
const packageDir = join(tmp, 'consumer');

try {
  const typesTarball = await packWorkspace('@records-fhir/validation-types', tmp);
  const validatorTarball = await packWorkspace('@records-fhir/validator', tmp);

  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify({ type: 'module', private: true }, null, 2),
  );

  await run('npm', [
    'install',
    '--ignore-scripts',
    typesTarball,
    validatorTarball,
  ], { cwd: packageDir });

  await writeFile(
    join(packageDir, 'smoke.mjs'),
    `
import {
  ValueSetValidator,
  createFilesystemProfileSource,
  getRecordsValidatorClass,
  setEngineLogger,
  setProfileSource,
} from '@records-fhir/validator';
import { toOperationOutcome } from '@records-fhir/validator/core/operation-outcome-converter';

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

setEngineLogger(noopLogger);
setProfileSource(createFilesystemProfileSource({ packageDirs: [] }));

const RecordsValidator = await getRecordsValidatorClass();
const validator = new RecordsValidator({
  autoDownload: false,
  enableCaching: false,
  packageCachePath: new URL('./fhir-package-cache', import.meta.url).pathname,
});

if (typeof validator.validate !== 'function') {
  throw new Error('RecordsValidator.validate is not available');
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

  await run('node', ['smoke.mjs'], { cwd: packageDir });

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
    './node_modules/.bin/records-fhir-validator',
    [
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

  console.log('OSS validator package smoke test passed');
} finally {
  if (process.env.KEEP_SMOKE_TMP !== '1') {
    await rm(tmp, { force: true, recursive: true });
  } else {
    console.log(`Keeping smoke test directory: ${tmp}`);
  }
}
