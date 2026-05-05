import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const packageRoots = [
  'packages/validator/src',
  'packages/validation-types/src',
  'packages/bundled-profiles',
];

const forbiddenSpecifiers = [
  /^@\/.*/,
  /^~\//,
  /^server(?:\/|$)/,
  /^client(?:\/|$)/,
  /^shared(?:\/|$)/,
  /^observability(?:\/|$)/,
  /^db(?:\/|$)/,
  /(?:^|\/)(?:server|client|shared|observability|db)(?:\/|$)/,
];

const forbiddenPackages = new Set([
  'drizzle-orm',
  'express',
  'winston',
  'pg',
  'postgres',
]);

const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'];
const includeTests = process.argv.includes('--include-tests');
const existingPackageRoots = packageRoots.filter((root) => existsSync(join(repoRoot, root)));

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with ${code}\n${stderr || stdout}`));
    });
  });
}

function isSourceFile(path) {
  return sourceExtensions.some((extension) => path.endsWith(extension));
}

function isTestFile(path) {
  return /(?:^|\/)__tests__\//.test(path)
    || /\.(?:test|spec)\.[cm]?[tj]sx?$/.test(path);
}

function isForbiddenSpecifier(specifier) {
  if (forbiddenPackages.has(specifier)) return true;
  return forbiddenSpecifiers.some((pattern) => pattern.test(specifier));
}

function owningPackageRoot(file) {
  return existingPackageRoots.find((root) => file === root || file.startsWith(`${root}/`));
}

function escapesPackageRoot(file, specifier) {
  if (!specifier.startsWith('.')) return false;

  const root = owningPackageRoot(file);
  if (!root) return false;

  const packageRoot = resolve(repoRoot, root);
  const target = resolve(repoRoot, dirname(file), specifier);
  return target !== packageRoot && !target.startsWith(`${packageRoot}/`);
}

function collectModuleSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(specifierFromMatch(match));
    }
  }

  return specifiers.filter(Boolean);
}

function specifierFromMatch(match) {
  return match[1]?.trim();
}

const filesOutput = await run('find', [
  ...existingPackageRoots,
  '-type',
  'f',
  '(',
  '-name',
  '*.ts',
  '-o',
  '-name',
  '*.tsx',
  '-o',
  '-name',
  '*.mts',
  '-o',
  '-name',
  '*.cts',
  '-o',
  '-name',
  '*.js',
  '-o',
  '-name',
  '*.mjs',
  '-o',
  '-name',
  '*.cjs',
  ')',
]);

const files = filesOutput
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .filter(isSourceFile)
  .filter((file) => includeTests || !isTestFile(file));

const violations = [];

for (const file of files) {
  const source = await readFile(join(repoRoot, file), 'utf8');
  for (const specifier of collectModuleSpecifiers(source)) {
    if (isForbiddenSpecifier(specifier)) {
      violations.push({ file, specifier });
    } else if (escapesPackageRoot(file, specifier)) {
      violations.push({ file, specifier: `${specifier} (escapes package root)` });
    }
  }
}

const validatorPackage = JSON.parse(
  await readFile(join(repoRoot, 'packages/validator/package.json'), 'utf8'),
);
if (validatorPackage.exports?.['./*']) {
  violations.push({
    file: 'packages/validator/package.json',
    specifier: 'exports["./*"]',
  });
}

const rootPackage = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
const isRecordsMonorepo = rootPackage.name === 'rest-express';
if (isRecordsMonorepo && (rootPackage.private !== true || rootPackage.license !== 'UNLICENSED')) {
  violations.push({
    file: 'package.json',
    specifier: 'root package must remain private + UNLICENSED',
  });
} else if (!isRecordsMonorepo && rootPackage.private !== true) {
  violations.push({
    file: 'package.json',
    specifier: 'public repo workspace root must remain private',
  });
}

if (violations.length > 0) {
  console.error('OSS validator boundary audit failed:');
  for (const violation of violations) {
    console.error(`  - ${relative(repoRoot, join(repoRoot, violation.file))}: ${violation.specifier}`);
  }
  process.exit(1);
}

const scope = includeTests ? 'runtime + tests' : 'runtime';
console.log(`OSS validator boundary audit passed (${scope}, ${files.length} files)`);
