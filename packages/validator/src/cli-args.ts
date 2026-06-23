import { splitPatterns } from './cli-file-matching';
import type { CliOptions } from './cli-types';
import type { PublicFhirVersion } from './index';

export function usage(): string {
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

export function parseArgs(args: string[]): CliOptions {
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
      options.failOn = value as CliOptions['failOn'];
      i = nextIndex;
      continue;
    }
    if (arg.startsWith('--format')) {
      const [value, nextIndex] = readOption(args, i);
      if (!['text', 'json'].includes(value || '')) {
        throw new Error('--format must be one of: text, json');
      }
      options.format = value as CliOptions['format'];
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
