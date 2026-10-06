import type { ValueSetValidator } from "../../validators/valueset-validator.js";

export type TerminologyBindingValidationPort = Pick<
  ValueSetValidator,
  "validateBinding"
> & Partial<Pick<ValueSetValidator, "pinBindingToProfile">>;

export type TerminologyCodeSystemValidationPort = Pick<
  ValueSetValidator,
  "validateCodeInCodeSystem" | "validateCodeInLocalCodeSystemOnly"
> & Partial<Pick<ValueSetValidator, "getDefinitionLookup" | "validateCodeInLocalCodeSystemWithLanguage">>;

export type TerminologyValidationPort = Pick<
  ValueSetValidator,
  | "setResolutionConfig"
  | "getResolutionConfig"
  | "clearCache"
  | "resolveCodeMembership"
  | "resolveSubsumption"
> &
  // Optional so a port without host packages (test doubles, embedders) needs no scope binding.
  Partial<Pick<ValueSetValidator, "setSourceContext" | "withSourceContext">> &
  TerminologyBindingValidationPort &
  TerminologyCodeSystemValidationPort;

export type { TerminologyDefinitionLookup } from "../../validators/valueset-validator.js";

export type TerminologyLocalCodeSystemValidationPort = Pick<
  TerminologyCodeSystemValidationPort, 'validateCodeInLocalCodeSystemOnly' | 'getDefinitionLookup' | 'validateCodeInLocalCodeSystemWithLanguage'
>;
