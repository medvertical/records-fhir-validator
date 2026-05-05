/**
 * Attachment Validator
 *
 * Enforces FHIR R4 Attachment invariants that the core structural executor
 * doesn't catch today:
 *
 * - `Attachment.size` (if present) must equal the decoded byte length of
 *   `Attachment.data` (if present). The Java validator flags this as a
 *   structure issue; see fhir-test-cases `attachment-with-wrong-size`.
 *
 * The Attachment data type is polymorphic and can appear anywhere in a
 * resource tree (e.g. `DocumentReference.content.attachment`,
 * `Patient.photo`, `Media.content`). Rather than enumerate every path,
 * this validator walks the resource and detects attachment-shaped objects
 * by duck-typing on the presence of `data` and/or `size`.
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';

export class AttachmentValidator {
    /**
     * Walk a resource and check every Attachment-shaped sub-object.
     */
    validate(resource: any): ValidationIssue[] {
        if (!resource || typeof resource !== 'object') return [];
        const issues: ValidationIssue[] = [];
        const rt = resource.resourceType || 'Resource';
        this.walk(resource, rt, issues);
        return issues;
    }

    private walk(obj: any, path: string, issues: ValidationIssue[]): void {
        if (!obj || typeof obj !== 'object') return;

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                this.walk(obj[i], `${path}[${i}]`, issues);
            }
            return;
        }

        // Detect Attachment-shaped objects by duck typing.
        // Required fingerprint: at least one of { data, url } plus one of
        // { size, contentType, title, hash, creation }. This avoids false
        // positives for plain objects that happen to have a `data` field.
        if (this.looksLikeAttachment(obj)) {
            const issue = this.checkSizeMatchesData(obj, path);
            if (issue) issues.push(issue);
        }

        for (const key of Object.keys(obj)) {
            this.walk(obj[key], `${path}.${key}`, issues);
        }
    }

    private looksLikeAttachment(obj: Record<string, any>): boolean {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return false;

        const hasContent = typeof obj.data === 'string' || typeof obj.url === 'string';
        const hasAttachmentMarker =
            typeof obj.size === 'number' ||
            typeof obj.contentType === 'string' ||
            typeof obj.title === 'string' ||
            typeof obj.hash === 'string' ||
            typeof obj.creation === 'string';

        return hasContent && hasAttachmentMarker;
    }

    /**
     * `Attachment.size` must equal decoded byte length of `Attachment.data`.
     * Only validates when both fields are present.
     */
    private checkSizeMatchesData(
        attachment: Record<string, any>,
        path: string
    ): ValidationIssue | null {
        const { data, size } = attachment;
        if (typeof data !== 'string' || typeof size !== 'number') return null;

        let decodedLength: number;
        try {
            decodedLength = Buffer.from(data, 'base64').length;
        } catch {
            return null; // Let base64 format validation report separately
        }

        if (decodedLength !== size) {
            return createValidationIssue({
                code: 'structural-attachment-size-mismatch',
                // Java emits the error at the Attachment element itself
                // (e.g. "Media.content") rather than `.size`. Matching that
                // lets the conformance diff pick up the shared path.
                path,
                resourceType: path.split('.')[0],
                customMessage:
                    `Stated Attachment Size ${size} does not match actual attachment size ${decodedLength}`,
                severityOverride: 'error',
            });
        }

        return null;
    }
}
