import type { ValidationIssue } from '@records-fhir/validation-types';
import { hasAuthoritativeDisplayMismatch } from '../../validators/valueset-display-evidence.js';
import { isRejectedCodeSystemDisplayResult, isVerifiedCodeSystemResult } from '../../validators/code-system-validation-evidence.js';
import type { CodeSystemValidationResult } from '../../validators/terminology-api-types.js';
import type { TerminologyLocalCodeSystemValidationPort, TerminologyValidationPort } from './terminology-validation-port.js';

type CodeSystemArguments = Parameters<TerminologyValidationPort['validateCodeInCodeSystem']>;
type LocalCodeSystemArguments = Parameters<TerminologyValidationPort['validateCodeInLocalCodeSystemOnly']>;
type LocalPort = TerminologyLocalCodeSystemValidationPort;
interface InvocationEvidence {
  actualLocal: LocalPort['validateCodeInLocalCodeSystemOnly'];
  actualLocalWithLanguage?: LocalPort['validateCodeInLocalCodeSystemWithLanguage'];
  exact: Map<string, CodeSystemValidationResult>;
  displayExact: Map<string, CodeSystemValidationResult>;
}
const invocationEvidence = new WeakMap<object, InvocationEvidence>();

function exactKey(arguments_: CodeSystemArguments): string | undefined {
  const [code, system, display, fhirVersion, version, language] = arguments_;
  if (arguments_.length > 6 || !code || !system || typeof code !== 'string' || typeof system !== 'string'
    || [display, version, language].some(value => value !== undefined && typeof value !== 'string')
    || (fhirVersion !== undefined && !['R4', 'R5', 'R6'].includes(fhirVersion))) return undefined;
  return JSON.stringify([code, system, display, fhirVersion, version, language]);
}

/** One validation run owns the coding evidence; no result crosses its source scope. */
export function createTerminologyEvidencePort(port: TerminologyValidationPort): TerminologyValidationPort {
  const verified = new Map<string, CodeSystemValidationResult>();
  const exact = new Map<string, CodeSystemValidationResult>();
  const displayExact = new Map<string, CodeSystemValidationResult>();
  const key = (arguments_: CodeSystemArguments | LocalCodeSystemArguments) => JSON.stringify(arguments_);
  const actualLocal = invocationEvidence.get(port)?.actualLocal
    ?? ((...arguments_: LocalCodeSystemArguments) => port.validateCodeInLocalCodeSystemOnly(...arguments_));
  const actualLocalWithLanguage = invocationEvidence.get(port)?.actualLocalWithLanguage
    ?? port.validateCodeInLocalCodeSystemWithLanguage?.bind(port);
  const validateCodeInCodeSystem = async (...arguments_: CodeSystemArguments) => {
    const result = await port.validateCodeInCodeSystem(...arguments_);
    if (isVerifiedCodeSystemResult(result)) {
      verified.set(key(arguments_), result);
      const exactQuery = exactKey(arguments_);
      if (exactQuery !== undefined) exact.set(exactQuery, result);
    }
    if (isVerifiedCodeSystemResult(result) || isRejectedCodeSystemDisplayResult(result)) {
      const exactQuery = exactKey(arguments_);
      if (exactQuery !== undefined) displayExact.set(exactQuery, result);
    }
    return result;
  };
  const validateCodeInLocalCodeSystemOnly = async (...arguments_: LocalCodeSystemArguments) => {
    const result = await port.validateCodeInLocalCodeSystemOnly(...arguments_);
    return result ?? verified.get(key(arguments_)) ?? null;
  };

  // Host ports can be classes with private fields. Other methods must retain
  // their original receiver rather than being called on the run wrapper.
  const wrapper = new Proxy(port, {
    get(target, property) {
      if (property === 'validateCodeInCodeSystem') return validateCodeInCodeSystem;
      if (property === 'validateCodeInLocalCodeSystemOnly') return validateCodeInLocalCodeSystemOnly;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  invocationEvidence.set(wrapper, { actualLocal, actualLocalWithLanguage, exact, displayExact });
  return wrapper;
}

/** Deep scanning may reuse evidence only for the owning resource's exact request. */
export async function validateLocalWithInvocationEvidence(
  port: LocalPort,
  arguments_: LocalCodeSystemArguments,
  displayLanguage?: string,
  rootOwned = true,
): Promise<CodeSystemValidationResult | null> {
  const evidence = invocationEvidence.get(port);
  const [code, system, display, fhirVersion, version] = arguments_;
  const query = arguments_.length <= 5 ? exactKey([code, system, display, fhirVersion, version, displayLanguage]) : undefined;
  const actualLanguageLocal = evidence?.actualLocalWithLanguage ?? port.validateCodeInLocalCodeSystemWithLanguage?.bind(port);
  const local = actualLanguageLocal && query !== undefined
    ? await actualLanguageLocal(code, system, display, fhirVersion, version, displayLanguage)
    : evidence ? await evidence.actualLocal(...arguments_)
    : await port.validateCodeInLocalCodeSystemOnly(...arguments_);
  if (local !== null || !evidence || !rootOwned || arguments_.length > 5) return local;
  return query === undefined ? null : evidence.exact.get(query) ?? null;
}

/** Resolve only absent local display authority with this run's actual exact display response. */
export function reconcileInvocationDisplayUnknowns(
  port: TerminologyValidationPort,
  issues: ValidationIssue[],
  fhirVersion: 'R4' | 'R5' | 'R6',
  displayLanguage?: string,
): ValidationIssue[] {
  const evidence = invocationEvidence.get(port);
  if (!evidence) return issues;
  return issues.filter(issue => {
    const details = issue.details;
    if (issue.code !== 'terminology-display-unverified' || !details || typeof details !== 'object' || details.localDisplayAuthority !== false
      || typeof details.code !== 'string' || typeof details.system !== 'string' || typeof details.display !== 'string'
      || !Array.isArray(details.requestedCodeSystemVersions)) return true;
    const results = details.requestedCodeSystemVersions.map(version => {
      if (version !== null && typeof version !== 'string') return undefined;
      const query = exactKey([details.code as string, details.system as string, details.display as string,
        fhirVersion, version ?? undefined, displayLanguage]);
      const result = query === undefined ? undefined : evidence.displayExact.get(query);
      return result;
    });
    const accepted = results.some(result => result !== undefined && isVerifiedCodeSystemResult(result)
      && result.valid && result.reason === undefined && !result.incompleteCodeSystem
      && !result.issues?.some(entry => entry.severity === 'error'));
    const rejected = results.length > 0 && results.every(result => result !== undefined && hasAuthoritativeDisplayMismatch(result));
    return !accepted && !rejected;
  });
}
