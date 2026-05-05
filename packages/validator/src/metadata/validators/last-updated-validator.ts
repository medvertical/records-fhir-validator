/**
 * Last Updated Validator
 *
 * Validates meta.lastUpdated field format and chronology.
 * Refactored to use createValidationIssue factory for consistent issue creation.
 */

import { parseISO, isValid, isAfter, isBefore, isSameSecond, subYears, differenceInYears, differenceInSeconds, getHours, getMinutes, getSeconds } from 'date-fns';
import type { ValidationIssue } from '../../types';
import { createValidationIssue } from '../../issues';
import { logger } from '../../logger';

const PATH = 'meta.lastUpdated';

/**
 * Validates meta.lastUpdated field format and chronology
 */
export class LastUpdatedValidator {
  /**
   * Validate lastUpdated format for R4
   */
  validate(lastUpdated: string, resourceType: string, profileUrl?: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    try {
      if (typeof lastUpdated !== 'string') {
        issues.push(createValidationIssue({
          code: 'metadata-last-updated-invalid-type',
          path: PATH, resourceType, profile: profileUrl,
          messageParams: { value: lastUpdated },
          details: { actualValue: lastUpdated, expectedType: 'string' },
        }));
        return issues;
      }

      if (!this.hasTimezone(lastUpdated)) {
        issues.push(createValidationIssue({
          code: 'metadata-last-updated-missing-timezone',
          path: PATH, resourceType, profile: profileUrl,
          messageParams: { value: lastUpdated },
        }));
      }

      const parsedDate = parseISO(lastUpdated);
      if (!isValid(parsedDate)) {
        issues.push(createValidationIssue({
          code: 'metadata-last-updated-invalid-format',
          path: PATH, resourceType, profile: profileUrl,
          messageParams: { value: lastUpdated },
        }));
        return issues;
      }

      // Recommend UTC — but +00:00 / -00:00 are semantically UTC
      if (!this.isUtc(lastUpdated) && this.hasTimezone(lastUpdated)) {
        issues.push(createValidationIssue({
          code: 'metadata-last-updated-non-utc',
          path: PATH, resourceType, profile: profileUrl,
          messageParams: { value: lastUpdated },
        }));
      }

      if (!this.hasSeconds(lastUpdated)) {
        issues.push(createValidationIssue({
          code: 'metadata-last-updated-missing-seconds',
          path: PATH, resourceType, profile: profileUrl,
          messageParams: { value: lastUpdated },
        }));
      }

      this.validateTimeBounds(parsedDate, lastUpdated, resourceType, profileUrl, issues);

    } catch (error) {
      logger.error('[LastUpdatedValidator] validation failed:', error);
      issues.push(createValidationIssue({
        code: 'metadata-last-updated-validation-error',
        path: PATH, resourceType, profile: profileUrl,
        messageParams: { error: error instanceof Error ? error.message : 'Unknown error' },
      }));
    }

    return issues;
  }

  private validateTimeBounds(
    parsedDate: Date, raw: string, resourceType: string, profileUrl: string | undefined, issues: ValidationIssue[]
  ): void {
    const now = new Date();

    if (isAfter(parsedDate, now)) {
      issues.push(createValidationIssue({
        code: 'metadata-last-updated-future',
        path: PATH, resourceType, profile: profileUrl,
        messageParams: { value: raw },
        details: { futureBySeconds: differenceInSeconds(parsedDate, now) },
      }));
    }

    const tenYearsAgo = subYears(now, 10);
    if (isBefore(parsedDate, tenYearsAgo)) {
      issues.push(createValidationIssue({
        code: 'metadata-last-updated-old',
        path: PATH, resourceType, profile: profileUrl,
        messageParams: { value: raw, years: differenceInYears(now, parsedDate) },
      }));
    }

    const unixEpoch = new Date('1970-01-01T00:00:00Z');
    if (isSameSecond(parsedDate, unixEpoch)) {
      issues.push(createValidationIssue({
        code: 'metadata-last-updated-unix-epoch',
        path: PATH, resourceType, profile: profileUrl,
        messageParams: { value: raw },
      }));
    }

    if (getHours(parsedDate) === 0 && getMinutes(parsedDate) === 0 && getSeconds(parsedDate) === 0) {
      issues.push(createValidationIssue({
        code: 'metadata-last-updated-at-midnight',
        path: PATH, resourceType, profile: profileUrl,
        messageParams: { value: raw },
      }));
    }
  }

  private hasTimezone(timestamp: string): boolean {
    return timestamp.endsWith('Z') || /(?:[+-]\d{2}:\d{2})$/.test(timestamp);
  }

  private isUtc(timestamp: string): boolean {
    return timestamp.endsWith('Z') || /[+-]00:00$/.test(timestamp);
  }

  private hasSeconds(timestamp: string): boolean {
    return /T\d{2}:\d{2}:\d{2}/.test(timestamp);
  }

  /**
   * Validate chronological order between timestamps
   */
  validateChronologicalOrder(
    earlierTimestamp: string,
    laterTimestamp: string,
    resourceType: string,
    context: string,
    profileUrl?: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    try {
      const earlier = parseISO(earlierTimestamp);
      const later = parseISO(laterTimestamp);

      if (!isValid(earlier) || !isValid(later)) {
        return issues;
      }

      if (isBefore(later, earlier)) {
        issues.push(createValidationIssue({
          code: 'metadata-chronological-order-violation',
          path: PATH, resourceType, profile: profileUrl,
          messageParams: { context },
          details: {
            context, earlierTimestamp, laterTimestamp,
            differenceSeconds: differenceInSeconds(earlier, later),
          },
        }));
      }

      if (isSameSecond(earlier, later)) {
        issues.push(createValidationIssue({
          code: 'metadata-identical-timestamps',
          path: PATH, resourceType, profile: profileUrl,
          messageParams: { context, value: earlierTimestamp },
        }));
      }

    } catch (error) {
      logger.error('[LastUpdatedValidator] Chronological validation failed:', error);
    }

    return issues;
  }
}
