/**
 * Composite-action runner for `medvertical/records-fhir-validator@v0`.
 *
 * Reads inputs from `INPUT_*` env vars (set by action.yml), expands the
 * `paths` glob, validates each JSON file via `@records-fhir/validator`,
 * aggregates the issue list, writes the optional output file, sets
 * action outputs (`issue-count`, `error-count`, `warning-count`), and
 * exits non-zero when the configured severity threshold is hit.
 *
 * Kept dependency-free aside from the validator itself so the install
 * step in action.yml stays small (`npm install --no-save`).
 */

import { readFileSync, writeFileSync, statSync, existsSync, readdirSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { recordsValidator, setEngineLogger } from '@records-fhir/validator';

const PATHS = (process.env.INPUT_PATHS || '').trim();
const PROFILE_URL = (process.env.INPUT_PROFILE_URL || '').trim();
const FHIR_VERSION = (process.env.INPUT_FHIR_VERSION || 'R4').trim();
const FAIL_ON = (process.env.INPUT_FAIL_ON || 'error').toLowerCase().trim();
const OUTPUT_FILE = (process.env.INPUT_OUTPUT_FILE || '').trim();
const LOG_LEVEL = (process.env.INPUT_LOG_LEVEL || 'warn').toLowerCase().trim();
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;

const FAIL_LEVELS = new Set(['error', 'warning', 'none']);
if (!FAIL_LEVELS.has(FAIL_ON)) {
  console.error(`::error::fail-on must be one of: error, warning, none (got '${FAIL_ON}')`);
  process.exit(2);
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'];
if (!LOG_LEVELS.includes(LOG_LEVEL)) {
  console.error(`::error::log-level must be one of: ${LOG_LEVELS.join(', ')} (got '${LOG_LEVEL}')`);
  process.exit(2);
}

const LOG_THRESHOLD = LOG_LEVELS.indexOf(LOG_LEVEL);
const noop = () => {};
setEngineLogger({
  debug: LOG_THRESHOLD <= 0 ? (m, x) => x !== undefined ? console.debug(m, x) : console.debug(m) : noop,
  info:  LOG_THRESHOLD <= 1 ? (m, x) => x !== undefined ? console.info(m, x)  : console.info(m)  : noop,
  warn:  LOG_THRESHOLD <= 2 ? (m, x) => x !== undefined ? console.warn(m, x)  : console.warn(m)  : noop,
  error: LOG_THRESHOLD <= 3 ? (m, x) => x !== undefined ? console.error(m, x) : console.error(m) : noop,
});

if (!['R4', 'R4B', 'R5', 'R6'].includes(FHIR_VERSION)) {
  console.error(`::error::fhir-version must be R4, R4B, R5, or R6 (got '${FHIR_VERSION}')`);
  process.exit(2);
}

if (!PATHS) {
  console.error('::error::Input `paths` is required.');
  process.exit(2);
}

/** Expand the paths input — supports newline- or comma-separated patterns. */
function parsePatterns(raw) {
  return raw
    .split(/[\n,]/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Minimal directory walker — supports `**` recursion, `*` glob, and a
 * trailing extension filter. Avoids pulling in a glob dependency for
 * such a small surface area.
 */
function expandPattern(pattern) {
  const cwd = process.cwd();
  // Plain file path
  if (existsSync(pattern) && statSync(pattern).isFile()) {
    return [resolve(pattern)];
  }

  // Crude glob: split into base + matcher. We only support patterns the
  // FHIR-validator action actually needs (recursive `**`, single `*`).
  const star = pattern.indexOf('*');
  const baseDir = star >= 0 ? pattern.slice(0, star).replace(/\/$/, '') : pattern;
  const tail = star >= 0 ? pattern.slice(star) : '';
  const root = resolve(cwd, baseDir || '.');
  if (!existsSync(root)) return [];

  const wantsRecursive = tail.startsWith('**');
  const extMatch = tail.match(/\.([a-zA-Z0-9]+)$/);
  const wantedExt = extMatch ? extMatch[0] : '';

  const results = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (wantsRecursive) walk(full);
      } else if (e.isFile()) {
        if (!wantedExt || full.endsWith(wantedExt)) results.push(full);
      }
    }
  }

  if (statSync(root).isFile()) {
    if (!wantedExt || root.endsWith(wantedExt)) results.push(root);
  } else {
    walk(root);
  }
  return results;
}

const patterns = parsePatterns(PATHS);
const filesSet = new Set();
for (const p of patterns) {
  for (const f of expandPattern(p)) filesSet.add(f);
}
const files = Array.from(filesSet).sort();

if (files.length === 0) {
  console.error(`::error::No files matched the paths input: ${patterns.join(', ')}`);
  process.exit(2);
}

console.log(`::group::Validating ${files.length} files (FHIR ${FHIR_VERSION})`);

const aggregated = [];
let totalErrors = 0;
let totalWarnings = 0;
let totalIssues = 0;

for (const file of files) {
  let resource;
  try {
    resource = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error(`::error file=${file}::Failed to parse JSON: ${err.message}`);
    aggregated.push({ file, error: `parse error: ${err.message}`, issues: [] });
    totalErrors++;
    continue;
  }

  const profileUrl = PROFILE_URL
    || `http://hl7.org/fhir/StructureDefinition/${resource?.resourceType || 'Resource'}`;

  let issues;
  try {
    issues = await recordsValidator.validate(resource, profileUrl, FHIR_VERSION);
  } catch (err) {
    console.error(`::error file=${file}::Validator threw: ${err.message}`);
    aggregated.push({ file, error: `validator error: ${err.message}`, issues: [] });
    totalErrors++;
    continue;
  }

  const issueList = Array.isArray(issues) ? issues : [];
  for (const i of issueList) {
    totalIssues++;
    if (i?.severity === 'error') totalErrors++;
    else if (i?.severity === 'warning') totalWarnings++;
    const lvl = i?.severity === 'error' ? 'error'
      : i?.severity === 'warning' ? 'warning'
      : 'notice';
    const msg = (i?.message || i?.code || 'issue').replace(/\n/g, ' ');
    console.log(`::${lvl} file=${file}::${i?.code || 'issue'}: ${msg}`);
  }
  aggregated.push({
    file,
    resourceType: resource?.resourceType,
    profileUrl,
    issues: issueList,
  });
}

console.log('::endgroup::');
console.log(`Validated ${files.length} files: ${totalErrors} error(s), ${totalWarnings} warning(s), ${totalIssues} total issue(s).`);

if (OUTPUT_FILE) {
  writeFileSync(OUTPUT_FILE, JSON.stringify(aggregated, null, 2));
  console.log(`Wrote aggregated result to ${OUTPUT_FILE}`);
}

if (GITHUB_OUTPUT) {
  appendFileSync(GITHUB_OUTPUT,
    `issue-count=${totalIssues}\n` +
    `error-count=${totalErrors}\n` +
    `warning-count=${totalWarnings}\n`,
  );
}

if (FAIL_ON === 'error' && totalErrors > 0) process.exit(1);
if (FAIL_ON === 'warning' && (totalErrors > 0 || totalWarnings > 0)) process.exit(1);
