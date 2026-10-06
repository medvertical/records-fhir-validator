import { describe, expect, it } from 'vitest';
import { createTerminologyEvidencePort, validateLocalWithInvocationEvidence } from '../terminology-validation-evidence-port.js';
import { validateDeepLocalCodings } from '../terminology-local-coding-rules.js';
import { parseCodeSystemValidationParameters } from '../../../validators/terminology-code-system-result.js';
import type { CodeSystemValidationResult } from '../../../validators/terminology-api-types.js';
import { createTerminologyValidationPortMock } from './terminology-validation-port.test-support.js';

const system = 'https://invocation.example.test/CodeSystem/codes';
const coding = { system, code: 'member', display: 'Member', version: '1' };
const body = (language?: string) => ({ resourceType: 'Observation', ...(language ? { language } : {}), code: { coding: [{ ...coding }] } });
const incomplete = (issues: Awaited<ReturnType<typeof validateDeepLocalCodings>>) => issues.some(issue => typeof issue.details === 'object' && issue.details !== null && issue.details.validationComplete === false);
const parsed = (result: boolean, extra: unknown[] = []): CodeSystemValidationResult => parseCodeSystemValidationParameters({ resourceType: 'Parameters', parameter: [{ name: 'result', valueBoolean: result }, ...extra] }, coding.code, system);
const displayNegative = () => parsed(false, [{ name: 'issues', resource: { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'invalid', details: { coding: [{ system: 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type', code: 'invalid-display' }], text: 'Wrong Display Name' } }] } }]);
async function recorded(result = parsed(true), options: { language?: string } = { language: 'en-NZ' }) {
  const port = createTerminologyValidationPortMock();
  port.validateCodeInCodeSystem.mockResolvedValue(result);
  const wrapper = createTerminologyEvidencePort(port);
  if (options.language) await wrapper.validateCodeInCodeSystem(coding.code, system, coding.display, 'R4', coding.version, options.language);
  else await wrapper.validateCodeInCodeSystem(coding.code, system, coding.display, 'R4', coding.version);
  return { port, wrapper, result };
}

describe('exact invocation CodeSystem evidence in the deep local pass', () => {
  it.each([true, false])('reuses actual language-specific result %s without local U', async valid => {
    const { wrapper, port } = await recorded(parsed(valid));
    const issues = await validateDeepLocalCodings(body('en-NZ'), [], wrapper, 'R4');
    expect(incomplete(issues)).toBe(false);
    expect(issues.filter(issue => issue.code === 'terminology-code-invalid')).toHaveLength(valid ? 0 : 1);
    expect(port.validateCodeInCodeSystem).toHaveBeenCalledTimes(1);
    expect(port.validateCodeInLocalCodeSystemOnly).toHaveBeenCalledWith('member', system, 'Member', 'R4', '1');
  });
  it('preserves the actual typed display rejection', async () => {
    const { wrapper } = await recorded(displayNegative());
    const issues = await validateDeepLocalCodings(body('en-NZ'), [], wrapper, 'R4');
    expect(incomplete(issues)).toBe(false);
    expect(issues.map(issue => issue.code)).toEqual(['terminology-display-mismatch']);
  });
  it('preserves inactive lifecycle warnings from the actual result', async () => {
    const { wrapper } = await recorded(parsed(true, [{ name: 'inactive', valueBoolean: true }]));
    const issues = await validateDeepLocalCodings(body('en-NZ'), [], wrapper, 'R4');
    expect(incomplete(issues)).toBe(false);
    expect(issues.map(issue => issue.code)).toEqual(['terminology-code-inactive']);
  });
  it('deduplicates an already reported exact negative without adding local U', async () => {
    const { wrapper } = await recorded(displayNegative());
    const first = await validateDeepLocalCodings(body('en-NZ'), [], wrapper, 'R4');
    expect(first.map(issue => issue.code)).toEqual(['terminology-display-mismatch']);
    expect(await validateDeepLocalCodings(body('en-NZ'), first, wrapper, 'R4')).toEqual([]);
  });
  it.each([undefined, 'de-CH', 'en-US'])('does not reuse another own resource language %s', async language => {
    const { wrapper } = await recorded();
    expect(incomplete(await validateDeepLocalCodings(body(language), [], wrapper, 'R4'))).toBe(true);
  });
  it.each(['code', 'system', 'display', 'version'] as const)('does not reuse changed %s', async key => {
    const { wrapper } = await recorded();
    const changed = { ...body('en-NZ'), code: { coding: [{ ...coding, [key]: key === 'system' ? 'https://other.example.test/CodeSystem/codes' : 'other' }] } };
    expect(incomplete(await validateDeepLocalCodings(changed, [], wrapper, 'R4'))).toBe(true);
  });
  it('does not reuse a different FHIR release', async () => {
    const { wrapper } = await recorded();
    expect(incomplete(await validateDeepLocalCodings(body('en-NZ'), [], wrapper, 'R5'))).toBe(true);
  });
  it('never overrides a non-null actual local negative', async () => {
    const { wrapper, port } = await recorded();
    port.validateCodeInLocalCodeSystemOnly.mockResolvedValue(parsed(false));
    const issues = await validateDeepLocalCodings(body('en-NZ'), [], wrapper, 'R4');
    expect(issues.map(issue => issue.code)).toEqual(['terminology-code-invalid']);
  });
  it('never overrides a non-null actual local display negative', async () => {
    const { wrapper, port } = await recorded();
    port.validateCodeInLocalCodeSystemOnly.mockResolvedValue(displayNegative());
    expect((await validateDeepLocalCodings(body('en-NZ'), [], wrapper, 'R4')).map(issue => issue.code)).toEqual(['terminology-display-mismatch']);
  });
  it.each(['no-server', 'circuit-open', 'remote-budget-exhausted', 'national-extension-unverified', 'delegation-disabled'] as const)('does not turn %s into evidence', async reason => {
    const { wrapper } = await recorded({ valid: true, reason });
    expect(incomplete(await validateDeepLocalCodings(body('en-NZ'), [], wrapper, 'R4'))).toBe(true);
  });
  it('does not trust a bare unmarked acceptance object', async () => {
    const { wrapper } = await recorded({ valid: true });
    expect(incomplete(await validateDeepLocalCodings(body('en-NZ'), [], wrapper, 'R4'))).toBe(true);
  });
  it('does not trust malformed actual Parameters', async () => {
    const { wrapper } = await recorded(parseCodeSystemValidationParameters({ resourceType: 'Parameters', parameter: [] }, coding.code, system));
    expect(incomplete(await validateDeepLocalCodings(body('en-NZ'), [], wrapper, 'R4'))).toBe(true);
  });
  it('a second invocation must obtain its own result even with the same host port', async () => {
    const { wrapper, port } = await recorded();
    const next = createTerminologyEvidencePort(port);
    expect(incomplete(await validateDeepLocalCodings(body('en-NZ'), [], next, 'R4'))).toBe(true);
    expect(incomplete(await validateDeepLocalCodings(body('en-NZ'), [], wrapper, 'R4'))).toBe(false);
  });
  it('an actual marked warm-cache result returned in a new invocation is usable', async () => {
    const { port, result } = await recorded();
    const next = createTerminologyEvidencePort(port);
    expect(await next.validateCodeInCodeSystem('member', system, 'Member', 'R4', '1', 'en-NZ')).toBe(result);
    expect(incomplete(await validateDeepLocalCodings(body('en-NZ'), [], next, 'R4'))).toBe(false);
    expect(port.validateCodeInCodeSystem).toHaveBeenCalledTimes(2);
  });
  it.each(['contained', 'parameter'] as const)('does not reuse parent evidence below %s resource boundaries', async location => {
    const { wrapper } = await recorded();
    const nested = body('en-NZ');
    const parent = location === 'contained' ? { ...body('en-NZ'), contained: [nested] } : { ...body('en-NZ'), parameter: [{ name: 'nested', resource: nested }] };
    const issues = await validateDeepLocalCodings(parent, [], wrapper, 'R4');
    expect(issues.filter(issue => issue.code === 'terminology-codesystem-unverified').map(issue => issue.path)).toEqual([location === 'contained' ? 'Observation.contained[0].code.coding[0].code' : 'Observation.parameter[0].resource.code.coding[0].code']);
  });
  it('does not reuse omitted-language legacy parent evidence in a contained child', async () => {
    const { wrapper } = await recorded(parsed(true), {});
    const issues = await validateDeepLocalCodings({ ...body(), contained: [body()] }, [], wrapper, 'R4');
    expect(issues.filter(issue => issue.code === 'terminology-codesystem-unverified').map(issue => issue.path)).toEqual(['Observation.contained[0].code.coding[0].code']);
  });
  it('a bundle parent does not walk an entry resource using its receipt', async () => {
    const { wrapper } = await recorded();
    const bundle = { resourceType: 'Bundle', language: 'en-NZ', entry: [{ resource: body('en-NZ') }] };
    expect(await validateDeepLocalCodings(bundle, [], wrapper, 'R4')).toEqual([]);
    const child = createTerminologyEvidencePort(createTerminologyValidationPortMock());
    expect(incomplete(await validateDeepLocalCodings(body('en-NZ'), [], child, 'R4'))).toBe(true);
  });
  it('a complete local positive wins over a remote negative', async () => {
    const { wrapper, port } = await recorded(parsed(false));
    port.validateCodeInLocalCodeSystemOnly.mockResolvedValue(parsed(true));
    expect(await validateDeepLocalCodings(body('en-NZ'), [], wrapper, 'R4')).toEqual([]);
  });
  it('a nested wrapper cannot treat an earlier wrapper receipt as actual local authority', async () => {
    const { wrapper } = await recorded(parsed(true), {});
    const nested = createTerminologyEvidencePort(wrapper);
    expect(incomplete(await validateDeepLocalCodings(body(), [], nested, 'R4'))).toBe(true);
  });
  it('does not admit extra runtime arguments into exact evidence', async () => {
    const port = createTerminologyValidationPortMock();
    port.validateCodeInCodeSystem.mockResolvedValue(parsed(true));
    const wrapper = createTerminologyEvidencePort(port);
    await Reflect.apply(wrapper.validateCodeInCodeSystem, wrapper, ['member', system, 'Member', 'R4', '1', 'en-NZ', 'extra']);
    expect(incomplete(await validateDeepLocalCodings(body('en-NZ'), [], wrapper, 'R4'))).toBe(true);
  });
  it('does not trust conflicting typed result booleans', async () => {
    const { wrapper } = await recorded(parsed(true, [{ name: 'result', valueBoolean: false }]));
    expect(incomplete(await validateDeepLocalCodings(body('en-NZ'), [], wrapper, 'R4'))).toBe(true);
  });
  it.each([6, 7])('does not truncate a %s-argument actual local request into evidence', async length => {
    const { wrapper, port } = await recorded();
    const arguments_ = ['member', system, 'Member', 'R4', '1', ...Array.from({ length: length - 5 }, () => 'extra')];
    expect(await Reflect.apply(validateLocalWithInvocationEvidence, undefined, [wrapper, arguments_, 'en-NZ', true])).toBeNull();
    expect(port.validateCodeInLocalCodeSystemOnly).toHaveBeenCalledWith(...arguments_);
  });
  it('preserves a non-null incomplete local fragment against remote acceptance', async () => {
    const { wrapper, port } = await recorded();
    port.validateCodeInLocalCodeSystemOnly.mockResolvedValue({ valid: false, incompleteCodeSystem: true, message: 'Absent from local fragment' });
    const issues = await validateDeepLocalCodings(body('en-NZ'), [], wrapper, 'R4');
    expect(incomplete(issues)).toBe(true);
    expect(issues.map(issue => [issue.code, issue.severity])).toEqual([['terminology-code-invalid', 'warning']]);
  });
  it.each([2, 4, 5])('does not admit a null optional at remote position %s', async index => {
    const port = createTerminologyValidationPortMock();
    port.validateCodeInCodeSystem.mockResolvedValue(parsed(true));
    const wrapper = createTerminologyEvidencePort(port);
    const arguments_: unknown[] = ['member', system, 'Member', 'R4', '1', 'en-NZ'];
    arguments_[index] = null;
    await Reflect.apply(wrapper.validateCodeInCodeSystem, wrapper, arguments_);
    expect(incomplete(await validateDeepLocalCodings(body('en-NZ'), [], wrapper, 'R4'))).toBe(true);
  });
  it('preserves omitted-language legacy local API behavior independently', async () => {
    const { wrapper, result } = await recorded();
    expect(await wrapper.validateCodeInLocalCodeSystemOnly('member', system, 'Member', 'R4', '1')).toBeNull();
    await wrapper.validateCodeInCodeSystem('member', system, 'Member', 'R4', '1');
    expect(await wrapper.validateCodeInLocalCodeSystemOnly('member', system, 'Member', 'R4', '1')).toBe(result);
  });
});
