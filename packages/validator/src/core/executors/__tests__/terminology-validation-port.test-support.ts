import { vi } from "vitest";

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
