import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shouldIncludeFile, walkJson } from './cli-file-matching';
import { severityOf } from './cli-renderer';
import type { CliOptions, CliSummary, CliValidationIssue, FileResult } from './cli-types';
import { recordsValidator } from './index';

interface FhirResourceLike {
  resourceType: string;
}

export interface CliRunResult {
  summary: CliSummary;
  results: FileResult[];
}

function isFhirResource(value: unknown): value is FhirResourceLike {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { resourceType?: unknown }).resourceType === 'string';
}

export function findInputFiles(options: Pick<CliOptions, 'paths' | 'include' | 'exclude' | 'output'>): string[] {
  let files = Array.from(new Set(options.paths.flatMap((path) => Array.from(walkJson(path))))).sort();
  if (files.length === 0) {
    throw new Error('No JSON files found.');
  }

  files = files.filter((file) => shouldIncludeFile(file, options));
  if (options.output) {
    const outputPath = resolve(options.output);
    files = files.filter((file) => resolve(file) !== outputPath);
  }
  if (files.length === 0) {
    throw new Error('No JSON files matched the include/exclude filters.');
  }

  return files;
}

export async function runValidation(files: string[], options: CliOptions): Promise<CliRunResult> {
  const results: FileResult[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalIssues = 0;

  for (const file of files) {
    let resource: unknown;
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

    if (!isFhirResource(resource)) {
      continue;
    }

    const profileUrl =
      options.profileUrl || `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`;

    try {
      const issues = await recordsValidator.validate(resource, profileUrl, options.fhirVersion);
      const issueList: CliValidationIssue[] = Array.isArray(issues) ? issues : [];
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

  return {
    results,
    summary: {
      files: results.length,
      errors: totalErrors,
      warnings: totalWarnings,
      issues: totalIssues,
    },
  };
}
