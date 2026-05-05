/**
 * JSON Source Map Tests
 *
 * Covers the FHIR-path → LSP range pipeline used by the diagnostic formatter:
 *   - building a source map from a raw JSON string
 *   - resolving JSON-Pointer-style paths to line/character positions
 *   - ancestor fallback for unresolved sub-paths
 *   - converting FHIR paths via `fhirPathToJsonPath` + `DiagnosticFormatter`
 */

import { describe, it, expect } from 'vitest';
import { buildJsonSourceMap } from '../json-source-map';
import {
    DiagnosticFormatter,
    fhirPathToJsonPath,
} from '../diagnostic-formatter';
import type { ValidationIssue } from '../../types';

describe('buildJsonSourceMap', () => {
    const PATIENT = [
        '{',
        '  "resourceType": "Patient",',
        '  "id": "example",',
        '  "name": [',
        '    {',
        '      "family": "Doe",',
        '      "given": ["Jane", "Marie"]',
        '    }',
        '  ],',
        '  "active": true',
        '}',
    ].join('\n');

    it('maps primitive fields to their line/character positions', () => {
        const map = buildJsonSourceMap(PATIENT);

        const idRange = map.lookup('id');
        expect(idRange).toBeDefined();
        expect(idRange!.start.line).toBe(2);
        // `"id": ` — the value starts after the colon + space
        expect(idRange!.start.character).toBeGreaterThan(0);
    });

    it('maps nested object fields', () => {
        const map = buildJsonSourceMap(PATIENT);

        const familyRange = map.lookup('name/0/family');
        expect(familyRange).toBeDefined();
        expect(familyRange!.start.line).toBe(5);
    });

    it('maps array elements by numeric index', () => {
        const map = buildJsonSourceMap(PATIENT);

        const firstGiven = map.lookup('name/0/given/0');
        const secondGiven = map.lookup('name/0/given/1');

        expect(firstGiven).toBeDefined();
        expect(secondGiven).toBeDefined();
        expect(firstGiven!.start.line).toBe(6);
        expect(secondGiven!.start.line).toBe(6);
        // Jane comes before Marie on the same line
        expect(firstGiven!.start.character).toBeLessThan(
            secondGiven!.start.character,
        );
    });

    it('falls back to the nearest ancestor when path is unknown', () => {
        const map = buildJsonSourceMap(PATIENT);

        // `name/0/extension/0/value` is not in the document; we should get the
        // `name/0` range as fallback.
        const fallback = map.lookup('name/0/extension/0/value');
        const nameZero = map.lookup('name/0');

        expect(fallback).toBeDefined();
        expect(fallback).toEqual(nameZero);
    });

    it('maps the document root to the empty path', () => {
        const map = buildJsonSourceMap(PATIENT);

        const root = map.lookup('');
        expect(root).toBeDefined();
        expect(root!.start.line).toBe(0);
    });

    it('returns an empty map for empty input instead of throwing', () => {
        const map = buildJsonSourceMap('');
        expect(map.size).toBe(0);
        expect(map.lookup('anything')).toBeUndefined();
    });

    it('is robust against malformed JSON (best-effort partial map)', () => {
        // Missing closing brace — should not throw
        const map = buildJsonSourceMap('{"a": 1, "b": 2');
        // Partial map is acceptable; we only require no crash and at least
        // one entry captured before the parser gave up.
        expect(map.size).toBeGreaterThanOrEqual(1);
    });
});

describe('fhirPathToJsonPath', () => {
    it('strips the leading resource type', () => {
        expect(fhirPathToJsonPath('Patient.name')).toBe('name');
    });

    it('converts bracket indices to slash segments', () => {
        expect(fhirPathToJsonPath('Patient.name[0].given[1]')).toBe(
            'name/0/given/1',
        );
    });

    it('handles paths with no resource type prefix', () => {
        expect(fhirPathToJsonPath('name[0].family')).toBe('name/0/family');
    });

    it('returns an empty string for empty input', () => {
        expect(fhirPathToJsonPath('')).toBe('');
    });
});

describe('DiagnosticFormatter LSP range mapping', () => {
    const PATIENT_SRC = [
        '{',
        '  "resourceType": "Patient",',
        '  "id": "example",',
        '  "name": [',
        '    {',
        '      "family": "Doe",',
        '      "given": ["Jane"]',
        '    }',
        '  ]',
        '}',
    ].join('\n');

    const issues: ValidationIssue[] = [
        {
            severity: 'error',
            code: 'structural-required-element-missing',
            message: 'Test issue',
            path: 'Patient.name[0].family',
        } as ValidationIssue,
    ];

    it('returns line 0 when no source is provided (legacy behaviour)', () => {
        const formatter = new DiagnosticFormatter();
        const diagnostics = formatter.toLSPDiagnostics(issues);

        expect(diagnostics[0].range.start.line).toBe(0);
        expect(diagnostics[0].range.start.character).toBe(0);
    });

    it('resolves real line/character positions when a source is supplied', () => {
        const formatter = new DiagnosticFormatter();
        const diagnostics = formatter.toLSPDiagnostics(
            issues,
            undefined,
            PATIENT_SRC,
        );

        expect(diagnostics[0].range.start.line).toBe(5); // "family": "Doe"
        expect(diagnostics[0].range.end.line).toBe(5);
        expect(diagnostics[0].range.start.character).toBeGreaterThan(0);
    });

    it('falls back to ancestor range for unknown sub-paths', () => {
        const formatter = new DiagnosticFormatter();
        const unknownIssue: ValidationIssue[] = [
            {
                severity: 'error',
                code: 'extension-missing',
                message: 'Missing extension on name',
                path: 'Patient.name[0].extension[0].valueString',
            } as ValidationIssue,
        ];

        const diagnostics = formatter.toLSPDiagnostics(
            unknownIssue,
            undefined,
            PATIENT_SRC,
        );

        // Should fall back to the `name/0` range on line 4 rather than
        // silently returning line 0.
        expect(diagnostics[0].range.start.line).toBeGreaterThan(0);
    });

    it('does not leak source map state between calls', () => {
        const formatter = new DiagnosticFormatter();
        formatter.toLSPDiagnostics(issues, undefined, PATIENT_SRC);
        const without = formatter.toLSPDiagnostics(issues);

        expect(without[0].range.start.line).toBe(0);
    });
});
