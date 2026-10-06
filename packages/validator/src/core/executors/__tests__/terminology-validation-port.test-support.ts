import { expect, vi } from "vitest";
import { parseCodeSystemValidationParameters } from "../../../validators/terminology-code-system-result.js";
import type { CodeSystemValidationIssue } from "../../../validators/terminology-api-types.js";

import { DEFAULT_RESOLUTION_CONFIG } from "../../../validators/valueset-types.js";
import type { TerminologyValidationPort } from "../terminology-validation-port.js";

export function createTerminologyValidationPortMock() {
  const validateBinding = vi.fn<TerminologyValidationPort["validateBinding"]>();
  validateBinding.mockResolvedValue([]);
  const validateCodeInCodeSystem =
    vi.fn<TerminologyValidationPort["validateCodeInCodeSystem"]>();
  validateCodeInCodeSystem.mockResolvedValue({ valid: true });
  const validateCodeInLocalCodeSystemOnly =
    vi.fn<TerminologyValidationPort["validateCodeInLocalCodeSystemOnly"]>();
  validateCodeInLocalCodeSystemOnly.mockResolvedValue(null);

  return {
    validateBinding,
    validateCodeInCodeSystem,
    validateCodeInLocalCodeSystemOnly,
    setResolutionConfig:
      vi.fn<TerminologyValidationPort["setResolutionConfig"]>(),
    getResolutionConfig: vi.fn<
      TerminologyValidationPort["getResolutionConfig"]
    >(() => ({ ...DEFAULT_RESOLUTION_CONFIG })),
    clearCache: vi.fn<TerminologyValidationPort["clearCache"]>(),
    resolveCodeMembership: vi.fn<
      TerminologyValidationPort["resolveCodeMembership"]
    >(async () => "unverified"),
    resolveSubsumption: vi.fn<TerminologyValidationPort["resolveSubsumption"]>(
      async () => "unknown",
    ),
  } satisfies TerminologyValidationPort;
}

export type TerminologyValidationPortMock = ReturnType<
  typeof createTerminologyValidationPortMock
>;

// A compatibility acceptance result cannot substitute for the server's explicit response.
export function codeSystemServerResponse(response: {
  result: boolean;
  message?: string;
  display?: string;
  inactive?: boolean;
  issues?: CodeSystemValidationIssue[];
}) {
  return async (code: string, system: string) =>
    parseCodeSystemValidationParameters(
      {
        resourceType: "Parameters",
        parameter: [
          { name: "result", valueBoolean: response.result },
          ...(response.message ? [{ name: "message", valueString: response.message }] : []),
          ...(response.display ? [{ name: "display", valueString: response.display }] : []),
          ...(response.inactive ? [{ name: "inactive", valueBoolean: true }] : []),
          ...(response.issues?.length ? [{
            name: "issues",
            resource: {
              resourceType: "OperationOutcome",
              issue: response.issues.map((issue) => ({
                severity: issue.severity,
                code: "invalid",
                details: { coding: [{
                  system: "http://hl7.org/fhir/tools/CodeSystem/tx-issue-type",
                  code: issue.code,
                }] },
                diagnostics: issue.message,
                ...(issue.expression ? { expression: issue.expression } : {}),
              })),
            },
          }] : []),
        ],
      },
      code,
      system,
    );
}

export function localCodeSystemUnverifiedIssue(
  code: string, system: string, path: string, display?: string,
) {
  return expect.objectContaining({
    aspect: "terminology",
    severity: "information",
    code: "terminology-codesystem-unverified",
    path,
    message: `CodeSystem membership could not be verified locally for '${system}#${code}'`,
    details: expect.objectContaining({
      code, system, ...(display ? { display } : {}),
      reason: "local-code-system-unverified",
      validationComplete: false,
      validationStatus: "incomplete",
    }),
  });
}
