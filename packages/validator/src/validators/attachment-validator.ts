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
 *
 * Duck-typing cannot see a content-less Attachment (e.g. a `presentedForm`
 * entry carrying only `title`), so element names whose type is always
 * Attachment in R4/R5 are additionally treated as attachment slots.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { createHash } from 'node:crypto';

// Keys that are Attachment-typed everywhere they occur in FHIR R4/R5.
// Ambiguous names (`content`, `document`, `form`) are deliberately absent:
// they also name BackboneElements, and misclassifying those would produce
// false attachment-no-content warnings.
const ATTACHMENT_ELEMENT_KEYS = new Set(['attachment', 'presentedForm', 'photo']);
const ATTACHMENT_CHOICE_SUFFIX = 'Attachment';

function isAttachmentTypedKey(key: string): boolean {
    return ATTACHMENT_ELEMENT_KEYS.has(key)
        || (key.length > ATTACHMENT_CHOICE_SUFFIX.length && key.endsWith(ATTACHMENT_CHOICE_SUFFIX));
}

const DATA_ABSENT_REASON = 'http://hl7.org/fhir/StructureDefinition/data-absent-reason';
const CONTENT_ELEMENTS = ['data', 'url', 'contentType', 'language'];

/**
 * TYPE_SPECIFIC_CHECKS_DT_ATT_NO_CONTENT: an Attachment without `data` and
 * `url` should at least carry `contentType` and/or `language`. An empty
 * attachment is ele-1's to report, and one whose data-absent-reason says why
 * the content is missing already answers what the warning asks.
 */
export function checkAttachmentHasContent(
    attachment: Record<string, unknown>,
    path: string,
): ValidationIssue | null {
    // A primitive carried only by its extensions (`_contentType`) is present.
    if (CONTENT_ELEMENTS.some(name => attachment[name] !== undefined || attachment[`_${name}`] !== undefined)) {
        return null;
    }
    if (Object.keys(attachment).length === 0 || statesAbsentReason(attachment)) return null;
    return createValidationIssue({
        code: 'attachment-no-content',
        path,
        resourceType: path.split('.')[0],
        customMessage:
            'Attachment has no data and no url: attachments should have data and/or url, or else at least a contentType and/or language',
        severityOverride: 'warning',
        details: {
            fieldPath: path,
            fixHint: 'Provide Attachment.data or Attachment.url, or describe the referenced content with contentType and/or language.',
        },
    });
}

function statesAbsentReason(attachment: Record<string, unknown>): boolean {
    return Array.isArray(attachment.extension) && attachment.extension.some(extension =>
        typeof extension === 'object' && extension !== null
        && (extension as Record<string, unknown>).url === DATA_ABSENT_REASON);
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * The reference validator decodes an Attachment's data and hash as RFC 4648
 * has it, without whitespace: a value wrapped into lines fails there even
 * where the base64Binary type itself only discourages the whitespace (R4).
 * Other malformed values are the base64Binary check's to report.
 */
function checkStrictBase64(attachment: Record<string, unknown>, path: string): ValidationIssue[] {
    // Binary carries data and contentType as well, but is no Attachment.
    if (typeof attachment.resourceType === 'string') return [];
    return (['data', 'hash'] as const).flatMap(element => {
        const value = attachment[element];
        if (typeof value !== 'string' || !/\s/.test(value)) return [];
        const compact = value.replace(/\s/g, '');
        if (compact.length === 0 || compact.length % 4 !== 0 || !BASE64.test(compact)) return [];
        return [createValidationIssue({
            code: 'structural-invalid-base64-format',
            path,
            resourceType: path.split('.')[0],
            customMessage: `The base64 content in the ${element} element is not valid base64: `
                + 'whitespace is not part of the base64 alphabet (RFC 4648)',
            severityOverride: 'error',
            details: { fieldPath: `${path}.${element}` },
        })];
    });
}

export class AttachmentValidator {
    /**
     * Walk a resource and check every Attachment-shaped sub-object.
     */
    validate(resource: unknown): ValidationIssue[] {
        if (!resource || typeof resource !== 'object') return [];
        const issues: ValidationIssue[] = [];
        const record = Array.isArray(resource) ? null : resource as Record<string, unknown>;
        const rt = typeof record?.resourceType === 'string' ? record.resourceType : 'Resource';
        this.walk(resource, rt, issues, new WeakSet<object>());
        return issues;
    }

    private walk(
        obj: unknown,
        path: string,
        issues: ValidationIssue[],
        visited: WeakSet<object>,
        inAttachmentSlot = false,
    ): void {
        if (!obj || typeof obj !== 'object') return;
        if (visited.has(obj)) return;
        visited.add(obj);

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                this.walk(obj[i], `${path}[${i}]`, issues, visited, inAttachmentSlot);
            }
            return;
        }
        const record = obj as Record<string, unknown>;

        // Detect Attachments two ways: by duck typing (at least one of
        // { data, url } plus one of { size, contentType, title, hash,
        // creation } — avoids false positives for plain objects that happen
        // to have a `data` field), or by arriving through an element name
        // that is always Attachment-typed. The slot route is what catches
        // content-less attachments the shape gate cannot see.
        if (inAttachmentSlot || this.looksLikeAttachment(record)) {
            issues.push(...this.checkContentPresence(record, path));
            issues.push(...checkStrictBase64(record, path));
            issues.push(...this.checkDataIntegrity(record, path));
        }

        for (const [key, value] of Object.entries(record)) {
            this.walk(value, `${path}.${key}`, issues, visited, isAttachmentTypedKey(key));
        }
    }

    private looksLikeAttachment(obj: Record<string, unknown>): boolean {
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
     * Content-presence rules mirrored from the Java validator: invariant
     * att-1 (if `data` is present, `contentType` SHALL be present) and
     * TYPE_SPECIFIC_CHECKS_DT_ATT_NO_CONTENT.
     */
    private checkContentPresence(
        attachment: Record<string, unknown>,
        path: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const hasData = typeof attachment.data === 'string';
        const hasContentType = typeof attachment.contentType === 'string';

        if (hasData && !hasContentType) {
            issues.push(createValidationIssue({
                code: 'attachment-att1-violation',
                path,
                resourceType: path.split('.')[0],
                customMessage:
                    'Attachment has data but no contentType: if the Attachment has data, it SHALL have a contentType (att-1)',
                severityOverride: 'error',
                details: {
                    constraintKey: 'att-1',
                    fieldPath: path,
                    fixHint: 'Add Attachment.contentType (a MIME type such as application/pdf) describing the media type of Attachment.data.',
                },
            }));
        }

        const noContentIssue = checkAttachmentHasContent(attachment, path);
        if (noContentIssue) issues.push(noContentIssue);

        return issues;
    }

    /**
     * `Attachment.size` must equal decoded byte length of `Attachment.data`.
     * Only validates when both fields are present.
     */
    private checkDataIntegrity(
        attachment: Record<string, unknown>,
        path: string
    ): ValidationIssue[] {
        const { data, size, hash } = attachment;
        if (typeof data !== 'string') return [];

        let decodedData: Buffer;
        try {
            decodedData = Buffer.from(data, 'base64');
        } catch {
            return []; // Let base64 format validation report separately
        }

        const issues: ValidationIssue[] = [];
        if (typeof size === 'number' && decodedData.length !== size) {
            issues.push(createValidationIssue({
                code: 'structural-attachment-size-mismatch',
                // Java emits the error at the Attachment element itself
                // (e.g. "Media.content") rather than `.size`. Matching that
                // lets the conformance diff pick up the shared path.
                path,
                resourceType: path.split('.')[0],
                customMessage:
                    `Stated Attachment Size ${size} does not match actual attachment size ${decodedData.length}`,
                severityOverride: 'error',
                details: {
                    statedSize: size,
                    actualSize: decodedData.length,
                    fieldPath: path,
                },
            }));
        }

        if (typeof hash === 'string') {
            const statedHash = Buffer.from(hash, 'base64');
            const actualHash = createHash('sha1').update(decodedData).digest();
            if (!statedHash.equals(actualHash)) {
                issues.push(createValidationIssue({
                    code: 'structural-attachment-hash-mismatch',
                    path,
                    resourceType: path.split('.')[0],
                    customMessage:
                        `The hash of the Attachment data does not match the stated SHA-1 hash`,
                    severityOverride: 'error',
                    details: {
                        statedHash: hash,
                        actualHash: actualHash.toString('base64'),
                        hashAlgorithm: 'SHA-1',
                        fieldPath: path,
                        fixHint: 'Recompute Attachment.hash as the base64-encoded SHA-1 digest of Attachment.data.',
                    },
                }));
            }
        }

        return issues;
    }
}
