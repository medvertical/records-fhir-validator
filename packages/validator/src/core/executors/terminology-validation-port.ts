import type { ValueSetValidator } from "../../validators/valueset-validator.js";

export type TerminologyBindingValidationPort = Pick<
  ValueSetValidator,
  "validateBinding"
>;

export type TerminologyCodeSystemValidationPort = Pick<
  ValueSetValidator,
  "validateCodeInCodeSystem" | "validateCodeInLocalCodeSystemOnly"
>;

export type TerminologyValidationPort = Pick<
  ValueSetValidator,
  | "setResolutionConfig"
  | "getResolutionConfig"
  | "clearCache"
  | "resolveCodeMembership"
  | "resolveSubsumption"
> &
  // Optional so a port without host packages (test doubles, embedders) needs no scope binding.
  Partial<Pick<ValueSetValidator, "setSourceContext">> &
  TerminologyBindingValidationPort &
  TerminologyCodeSystemValidationPort;
