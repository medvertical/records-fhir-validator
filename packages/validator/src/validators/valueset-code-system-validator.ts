import {
  displaysEquivalentForCodeInfo,
} from './valueset-display-utils';
import type { TerminologyResolutionConfig } from './valueset-types';
import {
  TerminologyApiClient,
  type CodeSystemValidationResult,
} from './terminology-api-client';

type TerminologyServerOverride = { url: string; auth?: any };

export async function validateCodeInCodeSystemWithFallbacks({
  apiClient,
  code,
  display,
  primaryOverride,
  resolutionConfig,
  system,
}: {
  apiClient: TerminologyApiClient;
  code: string;
  display?: string;
  primaryOverride?: TerminologyServerOverride;
  resolutionConfig: TerminologyResolutionConfig;
  system: string;
}): Promise<CodeSystemValidationResult> {
  const result = await apiClient.validateCodeInCodeSystem(code, system, display, primaryOverride);
  if (!display || !isDisplayMismatchResult(result)) {
    return validateInactiveCodeWithFallbackServers({
      apiClient,
      code,
      primaryOverride,
      primaryResult: result,
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
    display,
    primaryOverride,
    primaryResult: result,
    resolutionConfig,
    system,
  });
  return validateInactiveCodeWithFallbackServers({
    apiClient,
    code,
    primaryOverride,
    primaryResult: displayResult,
    resolutionConfig,
    system,
  });
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
  display,
  primaryOverride,
  primaryResult,
  resolutionConfig,
  system,
}: {
  apiClient: TerminologyApiClient;
  code: string;
  display: string;
  primaryOverride?: TerminologyServerOverride;
  primaryResult: CodeSystemValidationResult;
  resolutionConfig: TerminologyResolutionConfig;
  system: string;
}): Promise<CodeSystemValidationResult> {
  const fallbackServers = getFallbackTerminologyServers(resolutionConfig, primaryOverride);
  if (fallbackServers.length === 0) return primaryResult;

  for (const server of fallbackServers) {
    const fallbackResult = await apiClient.validateCodeInCodeSystem(code, system, display, server);
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
  primaryOverride,
  primaryResult,
  resolutionConfig,
  system,
}: {
  apiClient: TerminologyApiClient;
  code: string;
  primaryOverride?: TerminologyServerOverride;
  primaryResult: CodeSystemValidationResult;
  resolutionConfig: TerminologyResolutionConfig;
  system: string;
}): Promise<CodeSystemValidationResult> {
  if (!isInactiveResult(primaryResult)) return primaryResult;

  const fallbackServers = getFallbackTerminologyServers(resolutionConfig, primaryOverride);
  if (fallbackServers.length === 0) return primaryResult;

  for (const server of fallbackServers) {
    // Validate the code status only. Passing the original display here can
    // turn an otherwise active code into a display-mismatch result.
    const fallbackResult = await apiClient.validateCodeInCodeSystem(code, system, undefined, server);
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

function getFallbackTerminologyServers(
  resolutionConfig: TerminologyResolutionConfig,
  primaryOverride: { url: string } | undefined,
): TerminologyServerOverride[] {
  const skippedUrls = new Set<string>();
  if (primaryOverride?.url) {
    skippedUrls.add(primaryOverride.url);
  } else if (resolutionConfig.serverUrl) {
    skippedUrls.add(resolutionConfig.serverUrl);
  }

  return (resolutionConfig.servers || [])
    .filter(server => server.enabled && !server.circuitOpen && Boolean(server.url))
    .filter(server => !skippedUrls.has(server.url))
    .map(server => ({ url: server.url, auth: server.authConfig }));
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
