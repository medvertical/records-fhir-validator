import { describe, expect, it } from 'vitest';
import { TerminologyResourceValidator } from '../terminology-resource-validator';

describe('TerminologyResourceValidator — ValueSet.expansion best-practice', () => {
  const validator = new TerminologyResourceValidator();

  function vsWithExpansion(expansion: any) {
    return {
      resourceType: 'ValueSet',
      url: 'http://example.org/vs',
      status: 'active',
      expansion,
    };
  }

  it('flags missing expansion.parameter as a warning', () => {
    const issues = validator.validate(vsWithExpansion({
      timestamp: '2024-01-01',
      identifier: 'urn:uuid:abc',
      contains: [{ system: 'http://example.org/cs|1.0', code: 'a' }],
    }));
    const noParams = issues.filter(i => i.code === 'tx-valueset-expansion-no-parameters');
    expect(noParams).toHaveLength(1);
    expect(noParams[0].severity).toBe('warning');
    expect(noParams[0].path).toBe('ValueSet.expansion');
  });

  it('flags missing expansion.identifier as information', () => {
    const issues = validator.validate(vsWithExpansion({
      parameter: [{ name: 'used-codesystem', valueUri: 'http://example.org/cs|1.0' }],
      contains: [{ system: 'http://example.org/cs|1.0', code: 'a' }],
    }));
    const noIdent = issues.filter(i => i.code === 'tx-valueset-expansion-no-identifier');
    expect(noIdent).toHaveLength(1);
    expect(noIdent[0].severity).toBe('information');
  });

  it('flags an unversioned system without used-codesystem parameter', () => {
    const issues = validator.validate(vsWithExpansion({
      parameter: [{ name: 'profile', valueUri: 'http://hl7.org/fhir/ValueSet/expansion-profile' }],
      identifier: 'urn:uuid:abc',
      contains: [{ system: 'http://loinc.org', code: '80764-4' }],
    }));
    const noVer = issues.filter(i => i.code === 'tx-valueset-expansion-system-no-version');
    expect(noVer).toHaveLength(1);
    expect(noVer[0].severity).toBe('warning');
    expect(noVer[0].message).toContain("'http://loinc.org'");
    expect(noVer[0].message).toContain("'used-codesystem'");
  });

  it('does not flag an unversioned system when used-codesystem declares it', () => {
    const issues = validator.validate(vsWithExpansion({
      parameter: [
        { name: 'used-codesystem', valueUri: 'http://loinc.org|2.78' },
      ],
      identifier: 'urn:uuid:abc',
      contains: [{ system: 'http://loinc.org', code: '80764-4' }],
    }));
    expect(issues.some(i => i.code === 'tx-valueset-expansion-system-no-version')).toBe(false);
  });

  it('does not flag a system that already pins a version inline', () => {
    const issues = validator.validate(vsWithExpansion({
      parameter: [{ name: 'profile', valueUri: 'http://example.org/p' }],
      identifier: 'urn:uuid:abc',
      contains: [{ system: 'http://loinc.org|2.78', code: '80764-4' }],
    }));
    expect(issues.some(i => i.code === 'tx-valueset-expansion-system-no-version')).toBe(false);
  });

  it('reports a system only once even when many contains entries share it', () => {
    const issues = validator.validate(vsWithExpansion({
      parameter: [{ name: 'profile', valueUri: 'http://example.org/p' }],
      identifier: 'urn:uuid:abc',
      contains: [
        { system: 'http://loinc.org', code: 'a' },
        { system: 'http://loinc.org', code: 'b' },
        { system: 'http://loinc.org', code: 'c' },
      ],
    }));
    const noVer = issues.filter(i => i.code === 'tx-valueset-expansion-system-no-version');
    expect(noVer).toHaveLength(1);
  });

  it('does not run when ValueSet has no expansion', () => {
    const issues = validator.validate({
      resourceType: 'ValueSet',
      url: 'http://example.org/vs',
      status: 'active',
    });
    expect(issues.some(i => i.code?.startsWith('tx-valueset-expansion-'))).toBe(false);
  });
});
