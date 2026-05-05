#!/usr/bin/env node
/**
 * Standalone single-file validator example.
 *
 * Usage:
 *   node standalone-validate.mjs path/to/resource.json [profile-url]
 *
 * Exit codes:
 *   0 — no errors (warnings and information are still printed)
 *   1 — at least one error-severity issue
 *   2 — bad input (missing file, invalid JSON, unknown CLI args)
 */

import { readFileSync } from 'node:fs';
import { recordsValidator } from '@records-fhir/validator';

const [, , filePath, profileUrlArg] = process.argv;

if (!filePath) {
  console.error('Usage: node standalone-validate.mjs <file.json> [profile-url]');
  process.exit(2);
}

let resource;
try {
  resource = JSON.parse(readFileSync(filePath, 'utf-8'));
} catch (err) {
  console.error(`Could not read or parse ${filePath}: ${err.message}`);
  process.exit(2);
}

const profileUrl =
  profileUrlArg ||
  `http://hl7.org/fhir/StructureDefinition/${resource?.resourceType ?? 'Resource'}`;

const issues = await recordsValidator.validate(resource, profileUrl, 'R4');

let errors = 0;
let warnings = 0;
for (const issue of issues) {
  if (issue.severity === 'error' || issue.severity === 'fatal') errors++;
  else if (issue.severity === 'warning') warnings++;
  console.log(`${issue.severity.toUpperCase()} ${issue.code} @ ${issue.path ?? ''}: ${issue.message}`);
}

console.log(`\n${resource.resourceType}: ${errors} error(s), ${warnings} warning(s), ${issues.length} total.`);
process.exit(errors > 0 ? 1 : 0);
