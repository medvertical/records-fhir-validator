import { inheritCodeSystemVerification, isVerifiedCodeSystemResult } from './code-system-validation-evidence.js';
import {
  extractAcceptedDisplays,
  hasAuthoritativeDisplayMismatch,
  sourceDisplaysEquivalent,
} from './valueset-display-evidence.js';
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
  displayLanguage,
  fhirVersion,
  primaryOverride,
  resolutionConfig,
  system,
}: {
  apiClient: TerminologyApiClient;
  code: string;
  codeSystemVersion?: string;
  display?: string;
  displayLanguage?: string;
  fhirVersion?: FhirVersion;
  primaryOverride?: TerminologyServerOverride;
  resolutionConfig: TerminologyResolutionConfig;
  system: string;
}): Promise<CodeSystemValidationResult> {
  const result = await callCodeSystemValidator(
    apiClient, code, system, display, primaryOverride, codeSystemVersion, displayLanguage,
  );
  if (!display || !isDisplayMismatchResult(result)) {
    const codeMembershipResult = await validateCodeMembershipWithFallbackServers({
      apiClient,
      code,
      codeSystemVersion,
      display,
      displayLanguage,
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
      displayLanguage,
      fhirVersion,
      primaryOverride,
      primaryResult: codeMembershipResult,
      resolutionConfig,
      system,
    });
  }
  const equivalent = isEquivalentDisplayMismatch(code, system, display, result);
  const { reason: _reason, issues, ...retainedResult } = result;
  const displayResult = equivalent
    ? inheritCodeSystemVerification({
      ...retainedResult,
      valid: true,
      ...(issues ? { issues: issues.filter(issue => issue.code !== 'invalid-display') } : {}),
    }, result)
    : await validateDisplayMismatchWithFallbackServers({
      apiClient,
      code,
      codeSystemVersion,
      display,
      displayLanguage,
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
    displayLanguage,
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
  displayLanguage,
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
  displayLanguage?: string;
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
      apiClient, code, system, display, server, codeSystemVersion, displayLanguage,
    );
    if (isConfirmedAcceptance(fallbackResult)) return fallbackResult;
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
  if (hasAuthoritativeDisplayMismatch(result) || result.reason !== 'display-mismatch'
    || result.issues?.some(issue => issue.severity === 'error' && issue.code !== 'invalid-display')) return false;
  const expectedDisplays = [
    ...extractAcceptedDisplays(result.message),
    ...(result.issues ?? []).flatMap(issue => extractAcceptedDisplays(issue.message)),
  ];

  return expectedDisplays.some(expected =>
    sourceDisplaysEquivalent(expected, actualDisplay, { code, system }),
  );
}

async function validateDisplayMismatchWithFallbackServers({
  apiClient,
  code,
  codeSystemVersion,
  display,
  displayLanguage,
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
  displayLanguage?: string;
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
      apiClient, code, system, display, server, codeSystemVersion, displayLanguage,
    );
    if (isConfirmedAcceptance(fallbackResult)) {
      const retainedIssues = primaryResult.issues?.filter(issue => issue.code !== 'invalid-display') ?? [];
      const independentError = retainedIssues.some(issue => issue.severity === 'error');
      return inheritCodeSystemVerification({
        ...fallbackResult,
        ...(independentError ? { valid: false, reason: 'code-unknown' as const, message: primaryResult.message } : {}),
        inactive: primaryResult.inactive || fallbackResult.inactive,
        ...(retainedIssues.length > 0 ? { issues: [...retainedIssues, ...(fallbackResult.issues ?? [])] } : {}),
      }, fallbackResult);
    }
  }

  return primaryResult;
}

async function validateInactiveCodeWithFallbackServers({
  apiClient,
  code,
  codeSystemVersion,
  displayLanguage,
  fhirVersion,
  primaryOverride,
  primaryResult,
  resolutionConfig,
  system,
}: {
  apiClient: TerminologyApiClient;
  code: string;
  codeSystemVersion?: string;
  displayLanguage?: string;
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
      apiClient, code, system, undefined, server, codeSystemVersion, displayLanguage,
    );
    if (isConfirmedAcceptance(fallbackResult) && !isInactiveResult(fallbackResult)) {
      const filteredIssues = primaryResult.issues?.filter(issue => !isInactiveIssue(issue)) ?? [];
      const { message, issues: _issues, ...activeResult } = primaryResult;
      return inheritCodeSystemVerification({
        ...activeResult,
        inactive: false,
        ...(!primaryResult.valid || filteredIssues.length > 0 ? { message } : {}),
        ...(filteredIssues.length > 0 ? { issues: filteredIssues } : {}),
      }, primaryResult);
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
  displayLanguage: string | undefined,
): Promise<CodeSystemValidationResult> {
  if (displayLanguage) return apiClient.validateCodeInCodeSystem(
    code, system, display, override, codeSystemVersion, displayLanguage,
  );
  return codeSystemVersion === undefined
    ? apiClient.validateCodeInCodeSystem(code, system, display, override)
    : apiClient.validateCodeInCodeSystem(code, system, display, override, codeSystemVersion);
}

function isDisplayMismatchResult(result: CodeSystemValidationResult): boolean {
  return result.reason === 'display-mismatch'
    || Boolean(result.issues?.some(issue => issue.code === 'invalid-display'));
}

function isConfirmedAcceptance(result: CodeSystemValidationResult): boolean {
  return result.valid && isVerifiedCodeSystemResult(result) && result.reason === undefined
    && !result.incompleteCodeSystem && !result.issues?.some(issue => issue.severity === 'error');
}

function isInactiveResult(result: CodeSystemValidationResult): boolean {
  return result.inactive === true
    || Boolean(result.issues?.some(isInactiveIssue));
}

function isInactiveIssue(issue: { code: string; severity?: string; message?: string }): boolean {
  return issue.code === 'code-comment' && issue.severity !== 'error' && /inactive/i.test(issue.message ?? '');
}
