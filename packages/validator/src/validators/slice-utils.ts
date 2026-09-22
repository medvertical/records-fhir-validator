/**
 * Stable internal facade for slice utility capabilities.
 *
 * Keep slicing consumers on this module while each implementation family
 * remains independently maintainable and testable.
 */

export * from './slice-binding-code-matching.js';
export * from './slice-canonical-matching.js';
export * from './slice-constraint-values.js';
export * from './slice-fixed-value-matching.js';
export * from './slice-path-resolution.js';
export * from './slice-pattern-matching.js';
export * from './slice-value-equality.js';
export * from './slice-value-type.js';
