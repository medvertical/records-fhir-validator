#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { recordsValidator, setEngineLogger, type PublicFhirVersion } from './index';

type FailOn = 'error' | 'warning' | 'none';
type OutputFormat = 'text' | 'json';

interface CliOptions {
  paths: string[];
  profileUrl?: string;
  fhirVersion: PublicFhirVersion;
  failOn: FailOn;
  format: OutputFormat;
}

interface FileResult {
  file: string;
  resourceType?: string;
  profileUrl?: string;
  error?: string;
  issues: unknown[];
}

function usage(): string {
  return `Usage:
  records-fhir-validator <file-or-folder...> [options]

Options:
  --profile-url <url>       Validate every resource against this canonical profile.
  --fhir-version <version>  R4, R4B, R5, or R6. Default: R4.
  --fail-on <level>         error, warning, or none. Default: error.
  --format <format>         text or json. Default: text.
  -h, --help                Show this help.

Examples:
  npx -p @records-fhir/validator records-fhir-validator ./patient.json
  npx -p @records-fhir/validator records-fhir-validator ./fixtures --fail-on=warning
  npx -p @records-fhir/validator records-fhir-validator ./patient.json --profile-url http://hl7.org/fhir/StructureDefinition/Patient --format=json`;
}

function readOption(args: string[], index: number): [string | undefined, number] {
  const current = args[index];
  const eq = current.indexOf('=');
  if (eq >= 0) return [current.slice(eq + 1), index];
  return [args[index + 1], index + 1];
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    paths: [],
    fhirVersion: 'R4',
    failOn: 'error',
    format: 'text',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      console.log(usage());
      process.exit(0);
    }
    if (arg.startsWith('--profile-url')) {
      const [value, nextIndex] = readOption(args, i);
      if (!value) throw new Error('--profile-url requires a value');
      options.profileUrl = value;
      i = nextIndex;
      continue;
    }
    if (arg.startsWith('--fhir-version')) {
      const [value, nextIndex] = readOption(args, i);
      if (!['R4', 'R4B', 'R5', 'R6'].includes(value || '')) {
        throw new Error('--fhir-version must be one of: R4, R4B, R5, R6');
      }
      options.fhirVersion = value as PublicFhirVersion;
      i = nextIndex;
      continue;
    }
    if (arg.startsWith('--fail-on')) {
      const [value, nextIndex] = readOption(args, i);
      if (!['error', 'warning', 'none'].includes(value || '')) {
        throw new Error('--fail-on must be one of: error, warning, none');
      }
      options.failOn = value as FailOn;
      i = nextIndex;
      continue;
    }
    if (arg.startsWith('--format')) {
      const [value, nextIndex] = readOption(args, i);
      if (!['text', 'json'].includes(value || '')) {
        throw new Error('--format must be one of: text, json');
      }
      options.format = value as OutputFormat;
      i = nextIndex;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    options.paths.push(arg);
  }

  if (options.paths.length === 0) throw new Error('At least one file or folder path is required');
  return options;
}

function* walkJson(path: string): Generator<string> {
  const resolved = resolve(path);
  const stats = statSync(resolved);
  if (stats.isFile()) {
    if (resolved.endsWith('.json')) yield resolved;
    return;
  }
  if (!stats.isDirectory()) return;
  for (const entry of readdirSync(resolved)) {
    yield* walkJson(join(resolved, entry));
  }
}

function severityOf(issue: any): string {
  return typeof issue?.severity === 'string' ? issue.severity : 'information';
}

function issuePath(issue: any): string {
  return typeof issue?.path === 'string' && issue.path.length > 0 ? issue.path : '<resource>';
}

function issueMessage(issue: any): string {
  return typeof issue?.message === 'string' && issue.message.length > 0
    ? issue.message
    : String(issue?.code || 'validation issue');
}

setEngineLogger({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: (message, meta) => {
    if (meta !== undefined) console.error(message, meta);
    else console.error(message);
  },
});

let options: CliOptions;
try {
  options = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  console.error('');
  console.error(usage());
  process.exit(2);
}

let files: string[];
try {
  files = Array.from(new Set(options.paths.flatMap((path) => Array.from(walkJson(path))))).sort();
} catch (err) {
  console.error(`Could not read input path: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
if (files.length === 0) {
  console.error('No JSON files found.');
  process.exit(2);
}

const results: FileResult[] = [];
let totalErrors = 0;
let totalWarnings = 0;
let totalIssues = 0;

for (const file of files) {
  let resource: any;
  try {
    resource = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    totalErrors++;
    results.push({
      file,
      error: `Could not parse JSON: ${err instanceof Error ? err.message : String(err)}`,
      issues: [],
    });
    continue;
  }

  if (typeof resource?.resourceType !== 'string') {
    continue;
  }

  const profileUrl =
    options.profileUrl || `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`;

  try {
    const issues = await recordsValidator.validate(resource, profileUrl, options.fhirVersion);
    const issueList = Array.isArray(issues) ? issues : [];
    for (const issue of issueList) {
      totalIssues++;
      const severity = severityOf(issue);
      if (severity === 'error' || severity === 'fatal') totalErrors++;
      else if (severity === 'warning') totalWarnings++;
    }
    results.push({
      file,
      resourceType: resource.resourceType,
      profileUrl,
      issues: issueList,
    });
  } catch (err) {
    totalErrors++;
    results.push({
      file,
      resourceType: resource.resourceType,
      profileUrl,
      error: `Validator failed: ${err instanceof Error ? err.message : String(err)}`,
      issues: [],
    });
  }
}

if (options.format === 'json') {
  console.log(JSON.stringify({
    summary: {
      files: results.length,
      errors: totalErrors,
      warnings: totalWarnings,
      issues: totalIssues,
    },
    results,
  }, null, 2));
} else {
  for (const result of results) {
    if (result.error) {
      console.error(`ERROR ${result.file}: ${result.error}`);
      continue;
    }
    for (const issue of result.issues as any[]) {
      console.log(
        `${severityOf(issue).toUpperCase()} ${result.file} ${issuePath(issue)} ${issue?.code || 'issue'}: ${issueMessage(issue)}`,
      );
    }
  }
  console.log(`Validated ${results.length} file(s): ${totalErrors} error(s), ${totalWarnings} warning(s), ${totalIssues} issue(s).`);
}

if (options.failOn === 'error' && totalErrors > 0) process.exit(1);
if (options.failOn === 'warning' && (totalErrors > 0 || totalWarnings > 0)) process.exit(1);
