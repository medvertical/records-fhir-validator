import type { ValidationIssue } from '@records-fhir/validation-types';
import { logger } from "../logger.js";
import { shouldSuppressBundleEntryIssue } from "./bundle-entry-issue-filter.js";
import { createValidationErrorIssue } from "./validation-utils.js";
import { createSafeValidationFailureMessage } from "../utils/validation-execution-failure.js";

export interface BundleEntryIssueContext {
  entryIndex: number;
  resourceType: string;
  resourceId?: string;
  includeBundleUnitDetails?: boolean;
  includeSuppressed?: boolean;
}

export interface BundleEntryIssueMapping {
  childIssues: ValidationIssue[];
  parentIssues: ValidationIssue[];
}

export function mapBundleEntryIssues(
  issues: ValidationIssue[],
  context: BundleEntryIssueContext,
): BundleEntryIssueMapping {
  const visibleIssues = context.includeSuppressed
    ? issues
    : issues.filter((issue) => !shouldSuppressBundleEntryIssue(issue));
  const childIssues = dedupeEntryIssues(visibleIssues);
  const prefix = bundleEntryResourcePrefix(context);

  return {
    childIssues,
    parentIssues: childIssues.map((issue) =>
      rewriteEntryIssue(issue, prefix, context),
    ),
  };
}

export function createBundleEntryValidationFailureIssue(
  entryIndex: number,
  resourceType: string,
): ValidationIssue {
  logger.warn("[RecordsValidator] Bundle entry validation failed", {
    entryIndex,
    entryResourceType: resourceType,
  });

  return createValidationErrorIssue(
    "profile",
    "validation-error",
    createSafeValidationFailureMessage(
      `Bundle entry[${entryIndex}] validation`,
    ),
    {
      entryIndex,
      resourceType,
    },
    `Bundle.entry[${entryIndex}].resource`,
  );
}

function dedupeEntryIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  const out: ValidationIssue[] = [];

  for (const issue of issues) {
    const key = `${issue.code}|${issue.path}|${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }

  return out;
}

function rewriteEntryIssue(
  issue: ValidationIssue,
  prefix: string,
  context: BundleEntryIssueContext,
): ValidationIssue {
  const rewritten: ValidationIssue = {
    ...issue,
    path: rewriteEntryPath(issue.path, prefix, context.resourceType),
  };
  if (context.includeBundleUnitDetails) {
    rewritten.details = attachBundleUnitDetails(issue.details, context);
  }
  if (issue.expression) {
    rewritten.expression = rewriteEntryPath(
      issue.expression,
      prefix,
      context.resourceType,
    );
  }
  return rewritten;
}

function attachBundleUnitDetails(
  details: ValidationIssue["details"],
  context: BundleEntryIssueContext,
): ValidationIssue["details"] {
  const bundleUnit = {
    entryIndex: context.entryIndex,
    resourceType: context.resourceType,
    ...(context.resourceId
      ? {
          resourceId: context.resourceId,
          reference: `${context.resourceType}/${context.resourceId}`,
        }
      : {}),
  };

  if (details && typeof details === "object" && !Array.isArray(details)) {
    return { ...details, bundleUnit };
  }
  if (details !== undefined && details !== null) {
    return { originalDetails: details, bundleUnit };
  }
  return { bundleUnit };
}

function rewriteEntryPath(
  path: string | undefined,
  prefix: string,
  resourceType: string,
): string | undefined {
  if (!path) return path;
  if (path === resourceType) return prefix;
  if (path.startsWith(`${resourceType}.`))
    return `${prefix}.${path.slice(resourceType.length + 1)}`;
  return `${prefix}.${path}`;
}

function bundleEntryResourcePrefix(context: BundleEntryIssueContext): string {
  const resourceIdentity =
    context.resourceId !== undefined
      ? `${context.resourceType}/${context.resourceId}`
      : context.resourceType;
  return `Bundle.entry[${context.entryIndex}].resource/*${resourceIdentity}*/`;
}
