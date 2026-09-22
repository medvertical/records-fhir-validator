import {
  displaysEquivalentForCodeInfo,
} from './valueset-display-utils.js';
import type {
  TerminologyResolutionConfig,
  TerminologyServerOverride,
} from './valueset-types.js';
import {
  TerminologyApiClient,
  type CodeSystemValidationResult,
} from './terminology-api-client.js';
import type { FhirVersion } from './valueset-expansion-cache-key.js';
import { listFallbackTerminologyServers } from './valueset-server-routing.js';

export async function validateCodeInCodeSystemWithFallbacks({
  apiClient,
  code,
  codeSystemVersion,
  display,
  fhirVersion,
  primaryOverride,
  resolutionConfig,
  system,
}: {
  apiClient: TerminologyApiClient;
  code: string;
  codeSystemVersion?: string;
  display?: string;
  fhirVersion?: FhirVersion;
  primaryOverride?: TerminologyServerOverride;
  resolutionConfig: TerminologyResolutionConfig;
  system: string;
}): Promise<CodeSystemValidationResult> {
  const result = await callCodeSystemValidator(
    apiClient, code, system, display, primaryOverride, codeSystemVersion,
  );
  if (!display || !isDisplayMismatchResult(result)) {
    const codeMembershipResult = await validateCodeMembershipWithFallbackServers({
      apiClient,
      code,
      codeSystemVersion,
      display,
      fhirVersion,
      primaryOverride,
      primaryResult: result,
      resolutionConfig,
      system,
    });
    return validateInactiveCodeWithFallbackServers({
      apiClient,
      code,
      codeSystemVersion,
      fhirVersion,
      primaryOverride,
      primaryResult: codeMembershipResult,
      resolutionConfig,
      system,
    });
  }
  if (isEquivalentDisplayMismatch(code, system, display, result)) {
    return { valid: true };
  }

  const displayResult = await validateDisplayMismatchWithFallbackServers({
    apiClient,
    code,
    codeSystemVersion,
    display,
    fhirVersion,
    primaryOverride,
    primaryResult: result,
    resolutionConfig,
    system,
  });
  return validateInactiveCodeWithFallbackServers({
    apiClient,
    code,
    codeSystemVersion,
    fhirVersion,
    primaryOverride,
    primaryResult: displayResult,
    resolutionConfig,
    system,
  });
}

async function validateCodeMembershipWithFallbackServers({
  apiClient,
  code,
  codeSystemVersion,
  display,
  fhirVersion,
  primaryOverride,
  primaryResult,
  resolutionConfig,
  system,
}: {
  apiClient: TerminologyApiClient;
  code: string;
  codeSystemVersion?: string;
  display?: string;
  fhirVersion?: FhirVersion;
  primaryOverride?: TerminologyServerOverride;
  primaryResult: CodeSystemValidationResult;
  resolutionConfig: TerminologyResolutionConfig;
  system: string;
}): Promise<CodeSystemValidationResult> {
  if (!shouldTryCodeMembershipFallback(primaryResult, primaryOverride)) return primaryResult;

  const fallbackServers = listFallbackTerminologyServers(
    resolutionConfig, primaryOverride, system, codeSystemVersion, fhirVersion,
  );
  if (fallbackServers.length === 0) return primaryResult;

  let displayMismatch: CodeSystemValidationResult | undefined;
  for (const server of fallbackServers) {
    const fallbackResult = await callCodeSystemValidator(
      apiClient, code, system, display, server, codeSystemVersion,
    );
    if (fallbackResult.valid) return fallbackResult;
    if (isDisplayMismatchResult(fallbackResult)) displayMismatch ??= fallbackResult;
  }

  return displayMismatch ?? primaryResult;
}

function shouldTryCodeMembershipFallback(
  result: CodeSystemValidationResult,
  primaryOverride: TerminologyServerOverride | undefined,
): boolean {
  if (result.valid) return false;
  if (result.reason === 'system-unresolvable') return true;

  // A preferred server is the configured authority for that CodeSystem. For a
  // generic default server, "unknown code" may only mean missing coverage.
  return result.reason === 'code-unknown' && !primaryOverride;
}

function isEquivalentDisplayMismatch(
  code: string,
  system: string,
  actualDisplay: string,
  result: CodeSystemValidationResult,
): boolean {
  const expectedDisplays = [
    ...extractExpectedDisplaysFromMessage(result.message),
    ...(result.issues ?? []).flatMap(issue => extractExpectedDisplaysFromMessage(issue.message)),
  ];

  return expectedDisplays.some(expected =>
    displaysEquivalentForCodeInfo(expected, actualDisplay, { code, system }),
  );
}

async function validateDisplayMismatchWithFallbackServers({
  apiClient,
  code,
  codeSystemVersion,
  display,
  fhirVersion,
  primaryOverride,
  primaryResult,
  resolutionConfig,
  system,
}: {
  apiClient: TerminologyApiClient;
  code: string;
  codeSystemVersion?: string;
  display: string;
  fhirVersion?: FhirVersion;
  primaryOverride?: TerminologyServerOverride;
  primaryResult: CodeSystemValidationResult;
  resolutionConfig: TerminologyResolutionConfig;
  system: string;
}): Promise<CodeSystemValidationResult> {
  const fallbackServers = listFallbackTerminologyServers(
    resolutionConfig, primaryOverride, system, codeSystemVersion, fhirVersion,
  );
  if (fallbackServers.length === 0) return primaryResult;

  for (const server of fallbackServers) {
    const fallbackResult = await callCodeSystemValidator(
      apiClient, code, system, display, server, codeSystemVersion,
    );
    if (fallbackResult.valid) {
      return {
        ...fallbackResult,
        inactive: primaryResult.inactive || fallbackResult.inactive,
      };
    }
  }

  return primaryResult;
}

async function validateInactiveCodeWithFallbackServers({
  apiClient,
  code,
  codeSystemVersion,
  fhirVersion,
  primaryOverride,
  primaryResult,
  resolutionConfig,
  system,
}: {
  apiClient: TerminologyApiClient;
  code: string;
  codeSystemVersion?: string;
  fhirVersion?: FhirVersion;
  primaryOverride?: TerminologyServerOverride;
  primaryResult: CodeSystemValidationResult;
  resolutionConfig: TerminologyResolutionConfig;
  system: string;
}): Promise<CodeSystemValidationResult> {
  if (!isInactiveResult(primaryResult)) return primaryResult;

  const fallbackServers = listFallbackTerminologyServers(
    resolutionConfig, primaryOverride, system, codeSystemVersion, fhirVersion,
  );
  if (fallbackServers.length === 0) return primaryResult;

  for (const server of fallbackServers) {
    // Validate the code status only. Passing the original display here can
    // turn an otherwise active code into a display-mismatch result.
    const fallbackResult = await callCodeSystemValidator(
      apiClient, code, system, undefined, server, codeSystemVersion,
    );
    if (fallbackResult.valid && !isInactiveResult(fallbackResult)) {
      const filteredIssues = primaryResult.issues?.filter(issue => !isInactiveIssue(issue)) ?? [];
      const { message: _message, issues: _issues, ...activeResult } = primaryResult;
      return {
        ...activeResult,
        inactive: false,
        ...(filteredIssues.length > 0 ? { issues: filteredIssues } : {}),
      };
    }
  }

  return primaryResult;
}

function callCodeSystemValidator(
  apiClient: TerminologyApiClient,
  code: string,
  system: string,
  display: string | undefined,
  override: TerminologyServerOverride | undefined,
  codeSystemVersion: string | undefined,
): Promise<CodeSystemValidationResult> {
  return codeSystemVersion === undefined
    ? apiClient.validateCodeInCodeSystem(code, system, display, override)
    : apiClient.validateCodeInCodeSystem(code, system, display, override, codeSystemVersion);
}

function isDisplayMismatchResult(result: CodeSystemValidationResult): boolean {
  return result.reason === 'display-mismatch'
    || Boolean(result.issues?.some(issue => issue.code === 'invalid-display'));
}

function extractExpectedDisplaysFromMessage(message: string | undefined): string[] {
  if (!message) return [];

  const validDisplayIndex = message.toLocaleLowerCase().indexOf('valid display');
  if (validDisplayIndex < 0) return [];

  const validDisplayClause = message.slice(validDisplayIndex);
  return [...validDisplayClause.matchAll(/'([^']+)'/g)]
    .map(match => match[1])
    .filter((display): display is string => Boolean(display?.trim()));
}

function isInactiveResult(result: CodeSystemValidationResult): boolean {
  return result.inactive === true
    || Boolean(result.issues?.some(isInactiveIssue));
}

function isInactiveIssue(issue: { message?: string }): boolean {
  return /inactive/i.test(issue.message ?? '');
}
