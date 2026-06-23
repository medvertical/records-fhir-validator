#!/usr/bin/env node
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { recordsValidator, setEngineLogger, type PublicFhirVersion } from './index';

type FailOn = 'error' | 'warning' | 'none';
type OutputFormat = 'text' | 'json';

interface CliOptions {
  paths: string[];
  profileUrl?: string;
  fhirVersion: PublicFhirVersion;
  failOn: FailOn;
  format: OutputFormat;
  output?: string;
  summaryOnly: boolean;
  include: string[];
  exclude: string[];
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
  --output <file>           Write validation output to a file instead of stdout.
  --summary-only            Print only aggregate counts; omit per-issue output.
  --include <glob>          Include matching JSON files. Repeatable. Default: **/*.json.
  --exclude <glob>          Exclude matching JSON files. Repeatable.
  -h, --help                Show this help.

Exit codes:
  0  Validation completed and did not meet the fail threshold.
  1  Validation completed and met --fail-on threshold.
  2  Invalid CLI input, unreadable paths, no matched JSON files, or output write failure.

Examples:
  npx -p @records-fhir/validator records-fhir-validator ./patient.json
  npx -p @records-fhir/validator records-fhir-validator ./fixtures --fail-on=warning
  npx -p @records-fhir/validator records-fhir-validator ./fixtures --format=json --output validation-report.json`;
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
    summaryOnly: false,
    include: [],
    exclude: [],
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
    if (arg.startsWith('--output')) {
      const [value, nextIndex] = readOption(args, i);
      if (!value) throw new Error('--output requires a value');
      options.output = value;
      i = nextIndex;
      continue;
    }
    if (arg === '--summary-only') {
      options.summaryOnly = true;
      continue;
    }
    if (arg.startsWith('--include')) {
      const [value, nextIndex] = readOption(args, i);
      if (!value) throw new Error('--include requires a value');
      options.include.push(...splitPatterns(value));
      i = nextIndex;
      continue;
    }
    if (arg.startsWith('--exclude')) {
      const [value, nextIndex] = readOption(args, i);
      if (!value) throw new Error('--exclude requires a value');
      options.exclude.push(...splitPatterns(value));
      i = nextIndex;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    options.paths.push(arg);
  }

  if (options.paths.length === 0) throw new Error('At least one file or folder path is required');
  return options;
}

function splitPatterns(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
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

function normalizePathForGlob(path: string): string {
  const normalized = path.split(sep).join('/');
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegExp(glob: string): RegExp {
  const normalized = normalizePathForGlob(glob);
  let source = '';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === '*' && next === '*') {
      i++;
      if (normalized[i + 1] === '/') {
        source += '(?:.*/)?';
        i++;
      } else {
        source += '.*';
      }
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += escapeRegExp(char);
  }
  return new RegExp(`^${source}$`);
}

function matchesAny(path: string, patterns: string[]): boolean {
  const normalized = normalizePathForGlob(path);
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

function shouldIncludeFile(file: string, options: CliOptions): boolean {
  const relativePath = normalizePathForGlob(relative(process.cwd(), file));
  const absolutePath = normalizePathForGlob(file);
  const includePatterns = options.include.length > 0 ? options.include : ['**/*.json'];
  const include = matchesAny(relativePath, includePatterns) || matchesAny(absolutePath, includePatterns);
  if (!include) return false;
  return !(matchesAny(relativePath, options.exclude) || matchesAny(absolutePath, options.exclude));
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

files = files.filter((file) => shouldIncludeFile(file, options));
if (files.length === 0) {
  console.error('No JSON files matched the include/exclude filters.');
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

const summary = {
  files: results.length,
  errors: totalErrors,
  warnings: totalWarnings,
  issues: totalIssues,
};

let rendered = '';
if (options.format === 'json') {
  rendered = JSON.stringify({
    summary,
    ...(options.summaryOnly ? {} : { results }),
  }, null, 2);
} else {
  const lines: string[] = [];
  if (!options.summaryOnly) {
    for (const result of results) {
      if (result.error) {
        lines.push(`ERROR ${result.file}: ${result.error}`);
        continue;
      }
      for (const issue of result.issues as any[]) {
        lines.push(
          `${severityOf(issue).toUpperCase()} ${result.file} ${issuePath(issue)} ${issue?.code || 'issue'}: ${issueMessage(issue)}`,
        );
      }
    }
  }
  lines.push(`Validated ${summary.files} file(s): ${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.issues} issue(s).`);
  rendered = lines.join('\n');
}

if (options.output) {
  try {
    const outputPath = resolve(options.output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${rendered}\n`, 'utf8');
  } catch (err) {
    console.error(`Could not write output file: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
} else {
  console.log(rendered);
}

if (options.failOn === 'error' && totalErrors > 0) process.exit(1);
if (options.failOn === 'warning' && (totalErrors > 0 || totalWarnings > 0)) process.exit(1);
