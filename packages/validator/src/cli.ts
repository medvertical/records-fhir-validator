#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs, usage } from './cli-args';
import { renderCliOutput } from './cli-renderer';
import { findInputFiles, runValidation } from './cli-runner';
import type { CliOptions } from './cli-types';
import { setEngineLogger } from './index';

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
  files = findInputFiles(options);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'No JSON files found.' || message === 'No JSON files matched the include/exclude filters.') {
    console.error(message);
  } else {
    console.error(`Could not read input path: ${message}`);
  }
  process.exit(2);
}

const { summary, results } = await runValidation(files, options);
const rendered = renderCliOutput(summary, results, options);

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

if (options.failOn === 'error' && summary.errors > 0) process.exit(1);
if (options.failOn === 'warning' && (summary.errors > 0 || summary.warnings > 0)) process.exit(1);
