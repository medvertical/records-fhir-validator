/**
 * Unit Tests for Validation Issue Factory
 * 
 * Tests the createValidationIssue factory function and convenience factories.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    createValidationIssue,
    createBindingViolation,
    createRequiredElementMissing,
    createReferenceTypeMismatch,
    createConstraintViolation,
    createValidationError,
    resetIssueCounter,
} from '../validation-issue-factory';

describe('validation-issue-factory', () => {
    beforeEach(() => {
        resetIssueCounter();
    });

    describe('createValidationIssue', () => {
        it('creates issue with basic params', () => {
            const issue = createValidationIssue({
                code: 'validation-error',
                path: 'Patient.name',
                resourceType: 'Patient',
            });

            expect(issue).toMatchObject({
                code: 'validation-error',
                path: 'Patient.name',
                resourceType: 'Patient',
            });
            expect(issue.id).toBeDefined();
            expect(issue.timestamp).toBeDefined();
            expect(issue.schemaVersion).toBe('R4');
        });

        it('applies code metadata (aspect, severity)', () => {
            const issue = createValidationIssue({
                code: 'terminology-binding-required',
                path: 'Patient.gender',
                resourceType: 'Patient',
            });

            expect(issue.aspect).toBe('terminology');
            expect(issue.severity).toBe('error');
        });

        it('allows severity override', () => {
            const issue = createValidationIssue({
                code: 'terminology-binding-required',
                path: 'Patient.gender',
                resourceType: 'Patient',
                severityOverride: 'warning',
            });

            expect(issue.severity).toBe('warning');
        });

        it('allows aspect override', () => {
            const issue = createValidationIssue({
                code: 'validation-error',
                path: 'Patient.name',
                resourceType: 'Patient',
                aspectOverride: 'profile',
            });

            expect(issue.aspect).toBe('profile');
        });

        it('uses custom message when provided', () => {
            const issue = createValidationIssue({
                code: 'validation-error',
                path: 'Patient.name',
                resourceType: 'Patient',
                customMessage: 'Custom error message',
            });

            expect(issue.message).toBe('Custom error message');
        });

        it('includes profile when provided', () => {
            const issue = createValidationIssue({
                code: 'profile-constraint-violation',
                path: 'Patient.identifier',
                resourceType: 'Patient',
                profile: 'http://example.org/StructureDefinition/MyPatient',
            });

            expect(issue.profile).toBe('http://example.org/StructureDefinition/MyPatient');
        });

        it('merges details with messageParams', () => {
            const issue = createValidationIssue({
                code: 'terminology-binding-required',
                path: 'Patient.gender',
                resourceType: 'Patient',
                messageParams: { code: 'invalid', system: 'http://example.org' },
                details: { customKey: 'customValue' },
            });

            expect(issue.details?.customKey).toBe('customValue');
            expect(issue.details?.code).toBe('invalid');
            expect(issue.details?.system).toBe('http://example.org');
        });

        it('generates unique IDs', () => {
            const issue1 = createValidationIssue({
                code: 'validation-error',
                path: 'Patient.name',
                resourceType: 'Patient',
            });

            const issue2 = createValidationIssue({
                code: 'validation-error',
                path: 'Patient.name',
                resourceType: 'Patient',
            });

            expect(issue1.id).not.toBe(issue2.id);
        });

        it('handles unknown codes gracefully', () => {
            const issue = createValidationIssue({
                code: 'unknown-code-xyz',
                path: 'Patient.name',
                resourceType: 'Patient',
            });

            expect(issue.code).toBe('unknown-code-xyz');
            expect(issue.aspect).toBe('structural'); // default
            expect(issue.severity).toBe('warning'); // default
        });
    });

    describe('createBindingViolation', () => {
        it('creates required binding violation', () => {
            const issue = createBindingViolation({
                strength: 'required',
                code: 'invalid-code',
                system: 'http://example.org',
                valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender',
                path: 'Patient.gender',
                resourceType: 'Patient',
            });

            expect(issue.code).toBe('terminology-binding-required');
            expect(issue.severity).toBe('error');
        });

        it('creates extensible binding violation', () => {
            const issue = createBindingViolation({
                strength: 'extensible',
                code: 'custom-code',
                system: 'http://example.org',
                valueSet: 'http://example.org/ValueSet/custom',
                path: 'Patient.maritalStatus',
                resourceType: 'Patient',
            });

            expect(issue.code).toBe('terminology-binding-extensible');
        });

        it('creates preferred binding violation', () => {
            const issue = createBindingViolation({
                strength: 'preferred',
                code: 'custom-code',
                system: 'http://example.org',
                valueSet: 'http://example.org/ValueSet/custom',
                path: 'Patient.communication.language',
                resourceType: 'Patient',
            });

            expect(issue.code).toBe('terminology-binding-preferred');
        });

        it('creates example binding violation', () => {
            const issue = createBindingViolation({
                strength: 'example',
                code: 'custom-code',
                system: 'http://example.org',
                valueSet: 'http://example.org/ValueSet/custom',
                path: 'Observation.category',
                resourceType: 'Observation',
            });

            expect(issue.code).toBe('terminology-binding-example');
        });

        it('creates binding violation for primitive code type (no system)', () => {
            const issue = createBindingViolation({
                strength: 'required',
                code: 'final',
                // No system provided - this is a primitive code type like Observation.status
                valueSet: 'http://hl7.org/fhir/ValueSet/observation-status',
                path: 'Observation.status',
                resourceType: 'Observation',
            });

            expect(issue.code).toBe('terminology-binding-required-code');
            expect(issue.message).toBe("Code 'final' is not in value set 'http://hl7.org/fhir/ValueSet/observation-status' (binding strength: required)");
            expect(issue.message).not.toContain('undefined');
            expect(issue.message).not.toContain('system');
        });
    });

    describe('createRequiredElementMissing', () => {
        it('creates required element missing issue', () => {
            const issue = createRequiredElementMissing({
                element: 'name',
                path: 'Patient.name',
                resourceType: 'Patient',
            });

            expect(issue.code).toBe('structural-required-element-missing');
            expect(issue.severity).toBe('error');
            expect(issue.path).toBe('Patient.name');
        });

        it('includes profile when provided', () => {
            const issue = createRequiredElementMissing({
                element: 'identifier',
                path: 'Patient.identifier',
                resourceType: 'Patient',
                profile: 'http://example.org/StructureDefinition/MyPatient',
            });

            expect(issue.profile).toBe('http://example.org/StructureDefinition/MyPatient');
        });
    });

    describe('createReferenceTypeMismatch', () => {
        it('creates reference type mismatch issue', () => {
            const issue = createReferenceTypeMismatch({
                actual: 'Device',
                allowed: ['Patient', 'Practitioner'],
                path: 'Observation.subject',
                resourceType: 'Observation',
            });

            expect(issue.code).toBe('reference-type-mismatch');
            expect(issue.details?.actual).toBe('Device');
            expect(issue.details?.allowed).toBe('Patient, Practitioner');
        });
    });

    describe('createConstraintViolation', () => {
        it('creates constraint violation issue', () => {
            const issue = createConstraintViolation({
                key: 'dom-2',
                message: 'If resource is contained, it SHALL NOT contain nested Resources',
                path: 'Patient',
                resourceType: 'Patient',
            });

            expect(issue.code).toBe('profile-constraint-violation');
            expect(issue.details?.key).toBe('dom-2');
        });

        it('allows severity override', () => {
            const issue = createConstraintViolation({
                key: 'warning-constraint',
                message: 'This is just a warning',
                path: 'Patient.name',
                resourceType: 'Patient',
                severity: 'warning',
            });

            expect(issue.severity).toBe('warning');
        });
    });

    describe('createValidationError', () => {
        it('creates generic validation error', () => {
            const issue = createValidationError({
                message: 'Something went wrong',
                path: 'Patient',
                resourceType: 'Patient',
            });

            expect(issue.code).toBe('validation-error');
            expect(issue.message).toBe('Something went wrong');
        });

        it('allows aspect override', () => {
            const issue = createValidationError({
                message: 'Profile error',
                path: 'Patient.identifier',
                resourceType: 'Patient',
                aspect: 'profile',
            });

            expect(issue.aspect).toBe('profile');
        });
    });
});
