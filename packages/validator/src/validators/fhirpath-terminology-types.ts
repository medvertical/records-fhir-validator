import type { SubsumptionOutcome } from './terminology-api-types.js';
import type { CodeBindingOutcome } from './valueset-types.js';

export type FHIRPathTerminologyVersion = 'R4' | 'R5' | 'R6';
export type FHIRPathInvocationParameterType =
  | 'Expr'
  | 'AnyAtRoot'
  | 'Identifier'
  | 'TypeSpecifier'
  | 'Any'
  | 'Integer'
  | 'Boolean'
  | 'Number'
  | 'String';
export type FHIRPathInvocationTable = Record<string, {
  fn: (inputs: unknown[], argument: unknown) => unknown;
  arity: Record<number, FHIRPathInvocationParameterType[]>;
}>;

export interface FHIRPathTerminologyResolver {
  resolveCodeMembership(
    code: string,
    system: string | undefined,
    valueSetUrl: string,
    fhirVersion: FHIRPathTerminologyVersion,
  ): Promise<CodeBindingOutcome>;
  resolveSubsumption(
    system: string,
    codeA: string,
    codeB: string,
  ): Promise<SubsumptionOutcome>;
}

export class FHIRPathTerminologyUnverifiedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FHIRPathTerminologyUnverifiedError';
  }
}
