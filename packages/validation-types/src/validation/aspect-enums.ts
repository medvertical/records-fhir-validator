// Validation aspects enum (for type safety)
export const ValidationAspect = {
  STRUCTURAL: 'structural',
  PROFILE: 'profile',
  TERMINOLOGY: 'terminology',
  REFERENCE: 'reference',
  INVARIANT: 'invariant',
  CUSTOM_RULE: 'customRule',
  METADATA: 'metadata',
  ANOMALY: 'anomaly',
} as const;

export type ValidationAspectType = typeof ValidationAspect[keyof typeof ValidationAspect];

// Severity enum
export const ValidationSeverity = {
  ERROR: 'error',
  WARNING: 'warning',
  INFORMATION: 'information',
} as const;

export type ValidationSeverityType = typeof ValidationSeverity[keyof typeof ValidationSeverity];
