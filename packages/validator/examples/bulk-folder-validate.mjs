#!/usr/bin/env node
/**
 * Walk a folder, validate every `*.json` against its base StructureDefinition,
 * print a summary, and exit non-zero on any error-severity issue.
 *
 * Usage:
 *   node bulk-folder-validate.mjs <folder> [--fail-on=error|warning|none]
 *
 * The default fail threshold is `error`. `warning` fails on errors AND
 * warnings; `none` always exits 0 (reporting-only).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { recordsValidator } from '@records-fhir/validator';

const [, , folder, ...rest] = process.argv;
if (!folder) {
  console.error('Usage: node bulk-folder-validate.mjs <folder> [--fail-on=error|warning|none]');
  process.exit(2);
}

const failOnArg = rest.find(a => a.startsWith('--fail-on='));
const failOn = failOnArg ? failOnArg.split('=')[1] : 'error';
if (!['error', 'warning', 'none'].includes(failOn)) {
  console.error(`--fail-on must be one of: error, warning, none (got '${failOn}')`);
  process.exit(2);
}

function* walkJson(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walkJson(full);
    else if (s.isFile() && full.endsWith('.json')) yield full;
  }
}

let totalErrors = 0;
let totalWarnings = 0;
let totalFiles = 0;
let totalIssues = 0;

for (const file of walkJson(folder)) {
  totalFiles++;
  let resource;
  try {
    resource = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error(`PARSE ERROR ${file}: ${err.message}`);
    totalErrors++;
    continue;
  }

  // Skip non-FHIR JSON files. A bulk walk often picks up package.json,
  // tsconfig.json, or aggregated result files that the validator can't
  // sensibly validate.
  if (typeof resource?.resourceType !== 'string') {
    continue;
  }

  const profileUrl = `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`;
  let issues;
  try {
    issues = await recordsValidator.validate(resource, profileUrl, 'R4');
  } catch (err) {
    console.error(`VALIDATOR ERROR ${file}: ${err.message}`);
    totalErrors++;
    continue;
  }

  let fileErrors = 0;
  let fileWarnings = 0;
  for (const issue of issues) {
    totalIssues++;
    if (issue.severity === 'error' || issue.severity === 'fatal') {
      totalErrors++;
      fileErrors++;
    } else if (issue.severity === 'warning') {
      totalWarnings++;
      fileWarnings++;
    }
  }

  if (fileErrors > 0 || fileWarnings > 0) {
    console.log(`${file}: ${fileErrors} error(s), ${fileWarnings} warning(s)`);
  }
}

console.log(`\nValidated ${totalFiles} files: ${totalErrors} error(s), ${totalWarnings} warning(s), ${totalIssues} total issue(s).`);

if (failOn === 'error' && totalErrors > 0) process.exit(1);
if (failOn === 'warning' && (totalErrors > 0 || totalWarnings > 0)) process.exit(1);
process.exit(0);
