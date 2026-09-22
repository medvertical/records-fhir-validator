import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { shouldIncludeFile, walkFhirInput } from './cli-file-matching.js';
import { severityOf } from './cli-renderer.js';
import type { CliOptions, CliSummary, CliValidationIssue, FileResult } from './cli-types.js';
import { inferCodeBasedProfiles } from './core/code-inferred-profiles.js';
import { getPrimaryDeclaredProfile } from './core/declared-profile-utils.js';
import { recordsValidator } from './index.js';
import { parseFhirNdjson, parseFhirXml } from './input/index.js';
import type { FhirInputDiagnostic } from './input/fhir-input-types.js';

interface FhirResourceLike {
  resourceType: string;
}

export interface CliRunResult {
  summary: CliSummary;
  results: FileResult[];
}

type ValidateRequest = typeof recordsValidator.validateRequest;

function isFhirResource(value: unknown): value is FhirResourceLike {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { resourceType?: unknown }).resourceType === 'string';
}

export function findInputFiles(options: Pick<CliOptions, 'paths' | 'include' | 'exclude' | 'output'>): string[] {
  let files = Array.from(new Set(options.paths.flatMap((path) => Array.from(walkFhirInput(path))))).sort();
  if (files.length === 0) {
    throw new Error('No FHIR JSON, XML, or NDJSON files found.');
  }

  files = files.filter((file) => shouldIncludeFile(file, options));
  if (options.output) {
    const outputPath = resolve(options.output);
    files = files.filter((file) => resolve(file) !== outputPath);
  }
  if (files.length === 0) {
    throw new Error('No FHIR input files matched the include/exclude filters.');
  }

  return files;
}

export async function runValidation(
  files: string[],
  options: CliOptions,
  validateRequest: ValidateRequest = request => recordsValidator.validateRequest(request),
): Promise<CliRunResult> {
  const results: FileResult[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalIssues = 0;

  for (const file of files) {
    const inputDiagnostics: FhirInputDiagnostic[] = [];
    let resources: FhirResourceLike[];
    try {
      resources = parseInputResources(
        file, readFileSync(file, 'utf8'), options.fhirVersion, inputDiagnostics,
      );
    } catch (err) {
      totalErrors++;
      results.push({
        file,
        error: `Could not parse FHIR input: ${err instanceof Error ? err.message : String(err)}`,
        issues: [],
      });
      continue;
    }

    for (let resourceIndex = 0; resourceIndex < resources.length; resourceIndex++) {
      const resource = resources[resourceIndex];
      const resultFile = resources.length === 1 ? file : `${file}#${resourceIndex + 1}`;
      // Naming the base StructureDefinition here is not the same as naming
      // nothing: the engine treats an explicit profile as the reader's
      // instruction and stops looking, so the base canonical silently
      // outranked the resource's own meta.profile and the profiles the
      // specification implies from its code. Only --profile-url is an
      // instruction; otherwise let the engine decide and report what it chose.
      const requestedProfileUrl = options.profileUrl;
      const profileUrl =
        requestedProfileUrl
        ?? getPrimaryDeclaredProfile(resource)
        ?? inferCodeBasedProfiles(resource)[0]
        ?? `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`;

      try {
        const issues = await validateRequest({
          resource,
          ...(requestedProfileUrl ? { profileUrl: requestedProfileUrl } : {}),
          fhirVersion: options.fhirVersion,
        });
        const issueList: CliValidationIssue[] = [
          ...inputDiagnostics.map((diagnostic) => ({
            severity: 'error',
            code: diagnostic.code === 'xml-text-not-allowed'
              ? 'structural-xml-text-not-allowed'
              : diagnostic.code === 'xml-attribute-empty'
                ? 'structural-xml-attribute-empty'
                : 'structural-xml-attribute-undefined',
            message: diagnostic.message,
            path: diagnostic.path,
          } as unknown as CliValidationIssue)),
          ...(Array.isArray(issues) ? issues : []),
        ];
        for (const issue of issueList) {
          totalIssues++;
          const severity = severityOf(issue);
          if (severity === 'error' || severity === 'fatal') totalErrors++;
          else if (severity === 'warning') totalWarnings++;
        }
        results.push({
          file: resultFile,
          resourceType: resource.resourceType,
          profileUrl,
          issues: issueList,
        });
      } catch (err) {
        totalErrors++;
        results.push({
          file: resultFile,
          resourceType: resource.resourceType,
          profileUrl,
          error: `Validator failed: ${err instanceof Error ? err.message : String(err)}`,
          issues: [],
        });
      }
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

function parseInputResources(
  file: string,
  source: string,
  fhirVersion?: string,
  diagnostics?: FhirInputDiagnostic[],
): FhirResourceLike[] {
  const extension = extname(file).toLowerCase();
  if (extension === '.xml') {
    // The release decides primitive types and cardinality, so parsing without
    // it normalises R4B/R5/R6 documents into the R4 shape and every later
    // finding is drawn from the wrong definitions.
    const parsed = parseFhirXml(source, {}, { fhirVersion });
    // Serialisation defects disappear in the object the validator sees, so the
    // adapter's findings have to be carried forward here.
    if (parsed.diagnostics?.length && diagnostics) diagnostics.push(...parsed.diagnostics);
    return requireFhirResources(parsed.resources, 'XML');
  }
  if (extension === '.ndjson') {
    return requireFhirResources(parseFhirNdjson(source).resources, 'NDJSON');
  }
  const parsed: unknown = JSON.parse(source);
  if (!isFhirResource(parsed)) {
    throw new Error('FHIR JSON input must contain an object with resourceType');
  }
  return [parsed];
}

function requireFhirResources(
  resources: Array<Record<string, unknown>>,
  format: string,
): FhirResourceLike[] {
  const valid: FhirResourceLike[] = [];
  for (const resource of resources) {
    if (!isFhirResource(resource)) {
      throw new Error(`FHIR ${format} input contains a record without resourceType`);
    }
    valid.push(resource);
  }
  return valid;
}
