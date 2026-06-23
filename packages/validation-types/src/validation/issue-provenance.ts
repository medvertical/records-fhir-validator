export type ValidationIssueSourceExecutor =
  | 'structural'
  | 'profile'
  | 'terminology'
  | 'reference'
  | 'invariant'
  | 'metadata'
  | 'hapi'
  | 'unknown';

export type ValidationIssueVerificationState =
  | 'verified'
  | 'unverified'
  | 'not-applicable'
  | 'unknown';

export type ValidationIssueConfidence = 'high' | 'medium' | 'low' | 'unknown';

export interface ValidationIssueProvenanceInput {
  aspect?: string;
  rawCode?: string;
  canonicalCode?: string;
  message?: string;
  ruleId?: string | null;
  profile?: string | null;
  sourceExecutor?: ValidationIssueSourceExecutor;
  verification?: ValidationIssueVerificationState;
  confidence?: ValidationIssueConfidence;
}

export interface ValidationIssueProvenance {
  rawCode?: string;
  canonicalCode?: string;
  sourceExecutor: ValidationIssueSourceExecutor;
  ruleId?: string;
  profile?: string;
  verification: ValidationIssueVerificationState;
  confidence: ValidationIssueConfidence;
}

export function buildValidationIssueProvenance(
  input: ValidationIssueProvenanceInput,
): ValidationIssueProvenance {
  const canonicalCode = cleanText(input.canonicalCode) ?? cleanText(input.rawCode);
  const rawCode = cleanText(input.rawCode);
  const sourceExecutor = input.sourceExecutor ?? inferValidationIssueSourceExecutor(input);

  return {
    ...(rawCode ? { rawCode } : {}),
    ...(canonicalCode ? { canonicalCode } : {}),
    sourceExecutor,
    ...(cleanText(input.ruleId) ? { ruleId: cleanText(input.ruleId)! } : {}),
    ...(cleanText(input.profile) ? { profile: cleanText(input.profile)! } : {}),
    verification: input.verification ?? inferVerificationState(canonicalCode, input.message),
    confidence: input.confidence ?? inferIssueConfidence(canonicalCode, input.message),
  };
}

export function inferValidationIssueSourceExecutor(
  input: Pick<ValidationIssueProvenanceInput, 'aspect' | 'canonicalCode' | 'rawCode' | 'message'>,
): ValidationIssueSourceExecutor {
  const aspect = cleanText(input.aspect)?.toLowerCase();
  if (aspect && isKnownSourceExecutor(aspect)) return aspect;

  const code = `${input.canonicalCode ?? input.rawCode ?? ''}`.toLowerCase();
  const message = `${input.message ?? ''}`.toLowerCase();

  if (code.includes('terminology') || code.includes('codesystem') || code.includes('binding') || message.includes('valueset')) {
    return 'terminology';
  }
  if (code.includes('reference') || message.includes('reference')) return 'reference';
  if (code.includes('profile') || code.includes('constraint') || code.includes('slice')) return 'profile';
  if (code.includes('structural') || code.includes('cardinality') || code === 'required') return 'structural';
  if (code.includes('invariant')) return 'invariant';
  if (code.includes('metadata')) return 'metadata';
  if (code.startsWith('hapi-')) return 'hapi';
  return 'unknown';
}

function inferVerificationState(
  canonicalCode: string | undefined,
  message: string | undefined,
): ValidationIssueVerificationState {
  const text = `${canonicalCode ?? ''} ${message ?? ''}`.toLowerCase();
  if (
    text.includes('unverified') ||
    text.includes('could not be validated') ||
    text.includes('cannot be validated')
  ) return 'unverified';
  if (text.includes('server-failure') || text.includes('timeout')) return 'unknown';
  return 'verified';
}

function inferIssueConfidence(
  canonicalCode: string | undefined,
  message: string | undefined,
): ValidationIssueConfidence {
  const text = `${canonicalCode ?? ''} ${message ?? ''}`.toLowerCase();
  if (text.includes('server-failure') || text.includes('timeout')) return 'low';
  if (
    text.includes('unresolvable') ||
    text.includes('could not be validated') ||
    text.includes('cannot be validated')
  ) return 'medium';
  return 'high';
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isKnownSourceExecutor(value: string): value is ValidationIssueSourceExecutor {
  return value === 'structural' ||
    value === 'profile' ||
    value === 'terminology' ||
    value === 'reference' ||
    value === 'invariant' ||
    value === 'metadata' ||
    value === 'hapi';
}
