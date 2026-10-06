import { afterEach, describe, expect, it, vi } from 'vitest';
import codeSystem from '../../../validators/__tests__/fixtures/mii-nlp-codesystem.json';
import { ValueSetValidator } from '../../../validators/valueset-validator.js';
import { ValueSetCache } from '../../../validators/valueset-cache.js';
import { ValueSetPackageResourceAccess } from '../../../validators/valueset-package-resource-access.js';
import { validateDeepLocalCodings } from '../terminology-local-coding-rules.js';
import { parseCodeSystemValidationParameters } from '../../../validators/terminology-code-system-result.js';
import type { CodeSystemValidationResult } from '../../../validators/terminology-api-types.js';
import { createTerminologyEvidencePort } from '../terminology-validation-evidence-port.js';

const coding = (display: string) => ({ system: codeSystem.url, code: 'surrogated', version: codeSystem.version, display });
function validator() {
  vi.spyOn(ValueSetPackageResourceAccess.prototype, 'getPackageDirectories').mockReturnValue([]);
  const values = new ValueSetValidator(new ValueSetCache(), undefined, []);
  expect(values.registerExternalTerminologyResource(codeSystem, 'R4')).toBe(true);
  return values;
}
afterEach(() => vi.restoreAllMocks());
const child = (language?: string) => ({ resourceType: 'Observation', ...(language ? { language } : {}),
  extension: [{ url: 'https://example.test/coding', valueCoding: coding('Surrogated document') }] });
for (const location of ['contained', 'parameter'] as const) {
  describe(`${location} nearest local language owner`, () => {
    it.each(['de-DE', 'en-NZ', undefined])('child language=%s is independent of parent language', async language => {
      const values = validator();
      const wrapper = createTerminologyEvidencePort(createTerminologyEvidencePort(values));
      for (const parentLanguage of ['en-NZ', 'de-DE']) {
        const nested = child(language);
        const resource = { resourceType: location === 'parameter' ? 'Parameters' : 'Observation', language: parentLanguage,
          ...(location === 'contained' ? { contained: [nested] } : location === 'parameter'
            ? { parameter: [{ name: 'nested', part: [{ name: 'child', resource: nested }] }] }
            : { backbone: { language: 'de-DE', extension: [{ valueCoding: coding('Surrogated document') }] } }) };
        const issues = await validateDeepLocalCodings(resource, [], wrapper, 'R4');
        const effective = language;
        expect(issues.filter(issue => issue.code === 'terminology-display-mismatch')).toHaveLength(effective === 'de-DE' ? 1 : 0);
        expect(issues.some(issue => issue.details?.validationComplete === false)).toBe(false);
      }
    });
  });
}

describe('local language capability and evidence ownership', () => {
  it('ignores ordinary backbone.language while keeping own resource.language', async () => {
    const values = validator();
    for (const language of ['de-DE', 'en-NZ']) for (const backboneLanguage of ['de-DE', 'en-NZ']) {
      const issues = await validateDeepLocalCodings({ resourceType: 'Observation', language,
        backbone: { language: backboneLanguage, extension: [{ valueCoding: coding('Surrogated document') }] } }, [], values, 'R4');
      expect(issues.filter(issue => issue.code === 'terminology-display-mismatch')).toHaveLength(language === 'de-DE' ? 1 : 0);
    }
  });
  it.each(['P', 'N', 'U'] as const)('actual nonnull language-capability %s wins over opposite remote evidence', async verdict => {
    vi.spyOn(ValueSetPackageResourceAccess.prototype, 'getPackageDirectories').mockReturnValue([]);
    const values = new ValueSetValidator(new ValueSetCache(), undefined, []);
    const localResult: CodeSystemValidationResult = verdict === 'N' ? { valid: false, reason: 'code-unknown' }
      : verdict === 'U' ? { valid: true, reason: 'display-unverified', issues: [{ severity: 'information', code: 'display-unverified', message: 'Known membership; unknown display language' }] }
      : { valid: true };
    const local = vi.fn(async () => localResult);
    const port = Object.assign(values, { validateCodeInLocalCodeSystemWithLanguage: local });
    vi.spyOn(values, 'validateCodeInLocalCodeSystemOnly').mockResolvedValue(null);
    vi.spyOn(values, 'validateCodeInCodeSystem').mockResolvedValue(parseCodeSystemValidationParameters({ resourceType: 'Parameters',
      parameter: [{ name: 'result', valueBoolean: verdict === 'N' }] }, 'surrogated', codeSystem.url));
    const wrapper = createTerminologyEvidencePort(createTerminologyEvidencePort(port));
    await wrapper.validateCodeInCodeSystem('surrogated', codeSystem.url, 'Surrogated document', 'R4', codeSystem.version, 'en-NZ');
    const issues = await validateDeepLocalCodings(child('en-NZ'), [], wrapper, 'R4');
    expect(issues.some(issue => issue.details?.validationComplete === false)).toBe(verdict === 'U');
    expect(issues.filter(issue => issue.code === 'terminology-code-invalid')).toHaveLength(verdict === 'N' ? 1 : 0);
    expect(local).toHaveBeenCalledWith('surrogated', codeSystem.url, 'Surrogated document', 'R4', codeSystem.version, 'en-NZ');
  });
  it('never borrows same-tuple parent receipt for child when language capability returns null', async () => {
    vi.spyOn(ValueSetPackageResourceAccess.prototype, 'getPackageDirectories').mockReturnValue([]);
    const values = new ValueSetValidator(new ValueSetCache(), undefined, []);
    const local = vi.fn(async () => null);
    const port = Object.assign(values, { validateCodeInLocalCodeSystemWithLanguage: local });
    vi.spyOn(values, 'validateCodeInLocalCodeSystemOnly').mockResolvedValue(null);
    vi.spyOn(values, 'validateCodeInCodeSystem').mockResolvedValue(parseCodeSystemValidationParameters({ resourceType: 'Parameters',
      parameter: [{ name: 'result', valueBoolean: true }] }, 'surrogated', codeSystem.url));
    const wrapper = createTerminologyEvidencePort(createTerminologyEvidencePort(port));
    await wrapper.validateCodeInCodeSystem('surrogated', codeSystem.url, 'Surrogated document', 'R4', codeSystem.version, 'en-NZ');
    const issues = await validateDeepLocalCodings({ ...child('en-NZ'), contained: [child('en-NZ')] }, [], wrapper, 'R4');
    expect(issues.filter(issue => issue.code === 'terminology-codesystem-unverified').map(issue => issue.path))
      .toEqual(['Observation.contained[0].extension[0].valueCoding.code']);
    expect(local).toHaveBeenCalledTimes(2);
  });
});
