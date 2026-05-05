/**
 * Markdown Validator
 * 
 * Enhanced validation for FHIR markdown content:
 * - CommonMark syntax validation
 * - Dangerous content detection (XSS, scripts)
 * - Link validation (broken links, external URLs)
 * - Image reference validation
 * - Max length enforcement
 * - Heading structure validation
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { logger } from '../logger';

// ============================================================================
// Types
// ============================================================================

export interface MarkdownValidationConfig {
    /** Maximum allowed length */
    maxLength?: number;
    /** Allow external URLs */
    allowExternalUrls?: boolean;
    /** Allow images */
    allowImages?: boolean;
    /** Allow raw HTML */
    allowRawHtml?: boolean;
    /** Check for XSS patterns */
    detectXss?: boolean;
}

// ============================================================================
// Dangerous Patterns
// ============================================================================

const XSS_PATTERNS = [
    /<script\b[^>]*>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,  // onclick=, onload=, etc.
    /data:text\/html/gi,
    /<iframe\b/gi,
    /<object\b/gi,
    /<embed\b/gi,
    /expression\s*\(/gi,  // CSS expression()
    /vbscript:/gi,
];

const RAW_HTML_PATTERN = /<[^>]+>/g;

// ============================================================================
// Markdown Structure Patterns
// ============================================================================

const LINK_PATTERN = /\[([^\]]*)\]\(([^)]+)\)/g;
const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/g;
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/gm;
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`]+`/g;

// ============================================================================
// Markdown Validator
// ============================================================================

export class MarkdownValidator {
    private config: MarkdownValidationConfig;

    constructor(config?: MarkdownValidationConfig) {
        this.config = {
            maxLength: 10000,
            allowExternalUrls: true,
            allowImages: true,
            allowRawHtml: false,
            detectXss: true,
            ...config
        };
    }

    /**
     * Set validation config
     */
    setConfig(config: Partial<MarkdownValidationConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Validate markdown content
     */
    validate(
        markdown: string,
        path: string,
        resourceType: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (!markdown || typeof markdown !== 'string') {
            return issues;
        }

        logger.debug(`[MarkdownValidator] Validating ${path}`);

        // 1. Length check
        if (this.config.maxLength && markdown.length > this.config.maxLength) {
            issues.push(createValidationIssue({
                code: 'markdown-too-long',
                path,
                resourceType,
                customMessage: `Markdown exceeds maximum length (${markdown.length} > ${this.config.maxLength})`,
                severityOverride: 'warning',
            }));
        }

        // 2. XSS detection
        if (this.config.detectXss) {
            issues.push(...this.detectXss(markdown, path, resourceType));
        }

        // 3. Raw HTML detection
        if (!this.config.allowRawHtml) {
            issues.push(...this.detectRawHtml(markdown, path, resourceType));
        }

        // 4. Link validation
        issues.push(...this.validateLinks(markdown, path, resourceType));

        // 5. Image validation
        if (!this.config.allowImages) {
            issues.push(...this.detectImages(markdown, path, resourceType));
        }

        // 6. Structure validation
        issues.push(...this.validateStructure(markdown, path, resourceType));

        return issues;
    }

    /**
     * Detect potential XSS patterns
     */
    private detectXss(
        markdown: string,
        path: string,
        resourceType: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        for (const pattern of XSS_PATTERNS) {
            if (pattern.test(markdown)) {
                issues.push(createValidationIssue({
                    code: 'markdown-xss-detected',
                    path,
                    resourceType,
                    customMessage: `Potential XSS pattern detected in markdown content`,
                    severityOverride: 'error',
                }));
                break; // One XSS warning is enough
            }
        }

        return issues;
    }

    /**
     * Detect raw HTML in markdown
     */
    private detectRawHtml(
        markdown: string,
        path: string,
        resourceType: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // Exclude code blocks for HTML detection
        const withoutCode = markdown
            .replace(CODE_BLOCK_PATTERN, '')
            .replace(INLINE_CODE_PATTERN, '');

        const htmlMatches = withoutCode.match(RAW_HTML_PATTERN);
        if (htmlMatches && htmlMatches.length > 0) {
            // Filter out safe HTML like <br> or allowed tags
            const dangerousTags = htmlMatches.filter(tag =>
                !/<br\s*\/?>/i.test(tag) &&
                !/<hr\s*\/?>/i.test(tag)
            );

            if (dangerousTags.length > 0) {
                issues.push(createValidationIssue({
                    code: 'markdown-raw-html',
                    path,
                    resourceType,
                    customMessage: `Raw HTML detected in markdown (${dangerousTags.length} tags)`,
                    severityOverride: 'info',
                }));
            }
        }

        return issues;
    }

    /**
     * Validate links in markdown
     */
    private validateLinks(
        markdown: string,
        path: string,
        resourceType: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const links: { text: string; url: string }[] = [];

        let match;
        while ((match = LINK_PATTERN.exec(markdown)) !== null) {
            links.push({ text: match[1], url: match[2] });
        }

        for (const link of links) {
            // Check for empty URLs
            if (!link.url.trim()) {
                issues.push(createValidationIssue({
                    code: 'markdown-empty-link',
                    path,
                    resourceType,
                    customMessage: `Empty link URL found`,
                    severityOverride: 'warning',
                }));
                continue;
            }

            // Check for external URLs
            if (!this.config.allowExternalUrls) {
                if (link.url.startsWith('http://') || link.url.startsWith('https://')) {
                    issues.push(createValidationIssue({
                        code: 'markdown-external-url',
                        path,
                        resourceType,
                        customMessage: `External URL not allowed: ${link.url}`,
                        severityOverride: 'warning',
                    }));
                }
            }

            // Check for javascript: URLs (even without XSS detection)
            if (link.url.toLowerCase().startsWith('javascript:')) {
                issues.push(createValidationIssue({
                    code: 'markdown-javascript-url',
                    path,
                    resourceType,
                    customMessage: `JavaScript URL not allowed`,
                    severityOverride: 'error',
                }));
            }
        }

        return issues;
    }

    /**
     * Detect images in markdown
     */
    private detectImages(
        markdown: string,
        path: string,
        resourceType: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (IMAGE_PATTERN.test(markdown)) {
            issues.push(createValidationIssue({
                code: 'markdown-image-not-allowed',
                path,
                resourceType,
                customMessage: `Images not allowed in markdown content`,
                severityOverride: 'warning',
            }));
        }

        return issues;
    }

    /**
     * Validate markdown structure
     */
    private validateStructure(
        markdown: string,
        path: string,
        resourceType: string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const headings: { level: number; text: string }[] = [];

        let match;
        while ((match = HEADING_PATTERN.exec(markdown)) !== null) {
            headings.push({ level: match[1].length, text: match[2] });
        }

        // Check for heading hierarchy jumps (e.g., h1 -> h3)
        for (let i = 1; i < headings.length; i++) {
            const prev = headings[i - 1];
            const curr = headings[i];
            if (curr.level > prev.level + 1) {
                issues.push(createValidationIssue({
                    code: 'markdown-heading-skip',
                    path,
                    resourceType,
                    customMessage: `Heading level jumped from h${prev.level} to h${curr.level}`,
                    severityOverride: 'info',
                }));
            }
        }

        // Check for unclosed code blocks
        const codeBlockOpeners = (markdown.match(/```/g) || []).length;
        if (codeBlockOpeners % 2 !== 0) {
            issues.push(createValidationIssue({
                code: 'markdown-unclosed-code',
                path,
                resourceType,
                customMessage: `Unclosed code block detected`,
                severityOverride: 'warning',
            }));
        }

        return issues;
    }
}

// Singleton
export const markdownValidator = new MarkdownValidator();
