// Shared types for the fix-suggestions catalog.

export interface FixPatch {
    /** What kind of change: add a missing element, replace a wrong value, or remove an invalid one */
    action: 'add' | 'replace' | 'remove';
    /** JSON path template — use {{key}} for interpolation from issue details */
    path: string;
    /** The value/snippet to apply — use {{key}} for interpolation */
    value?: string;
}

export interface FixSuggestion {
    why: string;
    fix: string;
    example?: string;
    specUrl?: string;
    /** Structured patch for concrete remediation (Phase C) */
    patch?: FixPatch;
}
