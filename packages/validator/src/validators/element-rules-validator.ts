/**
 * Element Rules Validator
 *
 * Enforces additional ElementDefinition constraints that are not covered by
 * cardinality/type validation:
 *  - fixed[x] values
 *  - pattern[x] values
 *  - minValue[x] / maxValue[x] for ordered primitives and simple quantities
 *  - minLength / maxLength for string-based primitives
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import type { ElementDefinition } from '../core/structure-definition-types';
import { isDeepStrictEqual } from 'util';

export class ElementRulesValidator {
  validate(
    value: any,
    elementDef: ElementDefinition,
    path: string,
    profileUrl?: string
  ): ValidationIssue[] {
    if (Array.isArray(value)) {
      const issues: ValidationIssue[] = [];
      value.forEach((item, index) => {
        issues.push(
          ...this.validateSingle(item, elementDef, `${path}[${index}]`, profileUrl)
        );
      });
      return issues;
    }

    return this.validateSingle(value, elementDef, path, profileUrl);
  }

  private validateSingle(
    value: any,
    elementDef: ElementDefinition,
    path: string,
    profileUrl?: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const elementAny = elementDef as unknown as Record<string, unknown>;

    if (value === undefined || value === null) {
      // Nothing to validate when the element is absent
      return issues;
    }

    // fixed[x] enforcement
    const fixedKeys = Object.keys(elementAny).filter((key) => key.startsWith('fixed'));
    for (const fixedKey of fixedKeys) {
      const expected = elementAny[fixedKey];
      if (!this.matchesFixedValue(value, expected)) {
        issues.push(createValidationIssue({
          code: 'profile-fixed-value-mismatch',
          path,
          resourceType: 'Unknown',
          profile: profileUrl,
          messageParams: { path, expected: JSON.stringify(expected), actual: JSON.stringify(value) },
        }));
      }
    }

    // pattern[x] enforcement (subset match)
    const patternKeys = Object.keys(elementAny).filter((key) => key.startsWith('pattern'));
    for (const patternKey of patternKeys) {
      const pattern = elementAny[patternKey];
      const patternMatch = this.checkPatternMatch(value, pattern, path);
      if (!patternMatch.matches) {
        issues.push(createValidationIssue({
          code: 'profile-pattern-mismatch',
          path: patternMatch.mismatchedPath || path,
          resourceType: 'Unknown',
          profile: profileUrl,
          customMessage: patternMatch.message || 'Pattern mismatch',
        }));
      }
    }

    // minLength / maxLength (FHIR primitive string-based constraints)
    if (typeof value === 'string') {
      if (typeof elementAny.minLength === 'number' && value.length < elementAny.minLength) {
        issues.push(createValidationIssue({
          code: 'profile-min-length',
          path,
          resourceType: 'Unknown',
          profile: profileUrl,
          messageParams: { path, minLength: elementAny.minLength, actualLength: value.length },
        }));
      }

      if (typeof elementAny.maxLength === 'number' && value.length > elementAny.maxLength) {
        issues.push(createValidationIssue({
          code: 'profile-max-length',
          path,
          resourceType: 'Unknown',
          profile: profileUrl,
          messageParams: { path, maxLength: elementAny.maxLength, actualLength: value.length },
        }));
      }
    }

    issues.push(...this.validateValueBounds(value, elementAny, path, profileUrl));

    return issues;
  }

  private validateValueBounds(
    value: any,
    elementAny: Record<string, unknown>,
    path: string,
    profileUrl?: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const minValueKeys = Object.keys(elementAny).filter((key) => key.startsWith('minValue'));
    for (const minValueKey of minValueKeys) {
      const minimum = elementAny[minValueKey];
      const comparison = this.compareOrderedValues(value, minimum, minValueKey, 'min');
      if (comparison !== undefined && comparison < 0) {
        issues.push(createValidationIssue({
          code: this.isRelativeDurationConstraint(value, minimum, minValueKey) ?
            'profile-min-value-duration-violation' :
            'profile-min-value-violation',
          path,
          resourceType: 'Unknown',
          profile: profileUrl,
          customMessage: `Value ${JSON.stringify(value)} is less than minimum ${JSON.stringify(minimum)}`,
          severityOverride: 'error',
        }));
      }
    }

    const maxValueKeys = Object.keys(elementAny).filter((key) => key.startsWith('maxValue'));
    for (const maxValueKey of maxValueKeys) {
      const maximum = elementAny[maxValueKey];
      const comparison = this.compareOrderedValues(value, maximum, maxValueKey, 'max');
      if (comparison !== undefined && comparison > 0) {
        issues.push(createValidationIssue({
          code: this.isRelativeDurationConstraint(value, maximum, maxValueKey) ?
            'profile-max-value-duration-violation' :
            'profile-max-value-violation',
          path,
          resourceType: 'Unknown',
          profile: profileUrl,
          customMessage: `Value ${JSON.stringify(value)} is greater than maximum ${JSON.stringify(maximum)}`,
          severityOverride: 'error',
        }));
      }
    }

    return issues;
  }

  private matchesFixedValue(value: any, expected: any): boolean {
    if (expected === undefined || expected === null) {
      return true;
    }

    return isDeepStrictEqual(value, expected);
  }

  private checkPatternMatch(value: any, pattern: any, basePath: string): { matches: boolean; message?: string; mismatchedPath?: string } {
    if (pattern === undefined || pattern === null) {
      return { matches: true };
    }

    // Primitive pattern: require exact match
    if (typeof pattern !== 'object' || pattern === null) {
      const matches = isDeepStrictEqual(value, pattern);
      if (!matches) {
        return {
          matches: false,
          message: `Element '${basePath}' does not match pattern: expected '${pattern}', found '${value}'`,
          mismatchedPath: basePath
        };
      }
      return { matches: true };
    }

    // If value is not object-like, it cannot satisfy an object pattern
    if (typeof value !== 'object' || value === null) {
      return {
        matches: false,
        message: `Element '${basePath}' is not an object but pattern requires object structure`,
        mismatchedPath: basePath
      };
    }

    // Arrays: FHIR pattern[x] is a subset rule. The actual array may contain
    // additional entries, but every pattern entry must be represented.
    if (Array.isArray(pattern)) {
      if (!Array.isArray(value)) {
        return {
          matches: false,
          message: `Element '${basePath}' is not an array but pattern requires array`,
          mismatchedPath: basePath
        };
      }

      for (let i = 0; i < pattern.length; i++) {
        const patternItem = pattern[i];
        const matchIndex = value.findIndex((actualItem) => {
          return this.checkPatternMatch(actualItem, patternItem, `${basePath}[${i}]`).matches;
        });

        if (matchIndex === -1) {
          return {
            matches: false,
            message: `Element '${basePath}' does not contain an item matching pattern entry ${i}`,
            mismatchedPath: `${basePath}[${i}]`
          };
        }
      }
      return { matches: true };
    }

    // Objects: actual value must contain and recursively satisfy each pattern
    // property. Slice-specific elements are skipped by StructuralExecutor
    // before this validator is invoked.
    for (const key of Object.keys(pattern)) {
      if (!(key in value)) {
        return {
          matches: false,
          message: `Element '${basePath}.${key}' is missing but required by pattern`,
          mismatchedPath: `${basePath}.${key}`
        };
      }
      const propMatch = this.checkPatternMatch(value[key], pattern[key], `${basePath}.${key}`);
      if (!propMatch.matches) {
        return propMatch;
      }
    }

    return { matches: true };
  }

  private matchesPattern(value: any, pattern: any): boolean {
    return this.checkPatternMatch(value, pattern, '').matches;
  }

  private compareOrderedValues(
    actual: any,
    bound: any,
    constraintKey: string,
    direction: 'min' | 'max'
  ): number | undefined {
    if (actual === undefined || actual === null || bound === undefined || bound === null) {
      return undefined;
    }

    const relativeDurationBoundary = this.getRelativeDurationBoundary(actual, bound, constraintKey, direction);
    if (relativeDurationBoundary !== undefined) {
      const actualTemporal = this.toComparableValue(actual);
      if (actualTemporal === undefined) {
        return undefined;
      }

      if (actualTemporal < relativeDurationBoundary) return -1;
      if (actualTemporal > relativeDurationBoundary) return 1;
      return 0;
    }

    if (this.areQuantityLike(actual) || this.areQuantityLike(bound)) {
      if (!this.areQuantityLike(actual) || !this.areQuantityLike(bound)) {
        return undefined;
      }

      if (!this.haveCompatibleQuantityUnits(actual, bound)) {
        return undefined;
      }

      const actualQuantityComparable = this.toComparableQuantityValue(actual);
      const boundQuantityComparable = this.toComparableQuantityValue(bound);

      if (actualQuantityComparable === undefined || boundQuantityComparable === undefined) {
        return undefined;
      }

      if (actualQuantityComparable < boundQuantityComparable) return -1;
      if (actualQuantityComparable > boundQuantityComparable) return 1;
      return 0;
    }

    const actualComparable = this.toComparableValue(actual);
    const boundComparable = this.toComparableValue(bound);

    if (actualComparable === undefined || boundComparable === undefined) {
      return undefined;
    }

    if (actualComparable < boundComparable) return -1;
    if (actualComparable > boundComparable) return 1;
    return 0;
  }

  private isRelativeDurationConstraint(actual: any, bound: any, constraintKey: string): boolean {
    return typeof actual === 'string' && constraintKey.endsWith('Duration') && this.areQuantityLike(bound);
  }

  private getRelativeDurationBoundary(
    actual: any,
    duration: any,
    constraintKey: string,
    direction: 'min' | 'max'
  ): number | undefined {
    if (!this.isRelativeDurationConstraint(actual, duration, constraintKey)) {
      return undefined;
    }

    const boundary = this.addDurationToDate(new Date(), duration, direction === 'min' ? -1 : 1);
    return boundary?.getTime();
  }

  private addDurationToDate(date: Date, duration: any, sign: 1 | -1): Date | undefined {
    if (typeof duration.value !== 'number' || !Number.isFinite(duration.value)) {
      return undefined;
    }

    const code = duration.code ?? duration.unit;
    const result = new Date(date.getTime());
    const amount = duration.value * sign;

    switch (code) {
      case 'a':
      case 'year':
      case 'years':
        result.setFullYear(result.getFullYear() + amount);
        return result;
      case 'mo':
      case 'month':
      case 'months':
        result.setMonth(result.getMonth() + amount);
        return result;
      case 'wk':
      case 'week':
      case 'weeks':
        result.setDate(result.getDate() + amount * 7);
        return result;
      case 'd':
      case 'day':
      case 'days':
        result.setDate(result.getDate() + amount);
        return result;
      case 'h':
      case 'hour':
      case 'hours':
        result.setHours(result.getHours() + amount);
        return result;
      case 'min':
      case 'minute':
      case 'minutes':
        result.setMinutes(result.getMinutes() + amount);
        return result;
      case 's':
      case 'second':
      case 'seconds':
        result.setSeconds(result.getSeconds() + amount);
        return result;
      default:
        return undefined;
    }
  }

  private toComparableValue(value: any): number | undefined {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined;
    }

    if (typeof value === 'string') {
      return this.parseTemporalValue(value);
    }

    if (value && typeof value === 'object' && typeof value.value === 'number') {
      return Number.isFinite(value.value) ? value.value : undefined;
    }

    return undefined;
  }

  private parseTemporalValue(value: string): number | undefined {
    if (/^\d{2}:\d{2}(:\d{2}(?:\.\d+)?)?$/.test(value)) {
      const [hours, minutes, seconds = '0'] = value.split(':');
      return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
    }

    let normalized = value;
    if (/^\d{4}$/.test(value)) {
      normalized = `${value}-01-01T00:00:00Z`;
    } else if (/^\d{4}-\d{2}$/.test(value)) {
      normalized = `${value}-01T00:00:00Z`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      normalized = `${value}T00:00:00Z`;
    }

    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private areQuantityLike(value: any): boolean {
    return Boolean(value && typeof value === 'object' && 'value' in value);
  }

  private haveCompatibleQuantityUnits(actual: any, bound: any): boolean {
    if (!this.areQuantityLike(actual) || !this.areQuantityLike(bound)) {
      return true;
    }

    const actualSystem = actual.system;
    const boundSystem = bound.system;
    if (actualSystem !== undefined && boundSystem !== undefined && actualSystem !== boundSystem) {
      return false;
    }

    const actualCode = actual.code ?? actual.unit;
    const boundCode = bound.code ?? bound.unit;
    if (actualCode !== undefined && boundCode !== undefined) {
      if (actualCode === boundCode) {
        return true;
      }

      const normalizedActual = this.normalizeUcumQuantity(actual);
      const normalizedBound = this.normalizeUcumQuantity(bound);
      return Boolean(
        normalizedActual &&
        normalizedBound &&
        normalizedActual.dimension === normalizedBound.dimension
      );
    }

    return true;
  }

  private toComparableQuantityValue(value: any): number | undefined {
    if (!this.areQuantityLike(value) || typeof value.value !== 'number' || !Number.isFinite(value.value)) {
      return undefined;
    }

    return this.normalizeUcumQuantity(value)?.value ?? value.value;
  }

  private normalizeUcumQuantity(value: any): { dimension: string; value: number } | undefined {
    if (value.system !== 'http://unitsofmeasure.org') {
      return undefined;
    }

    const code = value.code ?? value.unit;
    const massFactorToGram: Record<string, number> = {
      kg: 1000,
      g: 1,
      mg: 0.001,
      ug: 0.000001,
      ng: 0.000000001,
    };

    if (typeof code === 'string' && code in massFactorToGram) {
      return {
        dimension: 'mass-g',
        value: value.value * massFactorToGram[code],
      };
    }

    return undefined;
  }
}
