import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveValueSetPackageDirectories } from '../valueset-package-resource-access.js';
import { isPackageDefinedUrl } from '../package-defined-urls.js';
import { unlessPackageDefined, validateExampleUrl } from '../example-url-rule.js';
import { validateUnresolvedHl7Url } from '../hl7-url-resolution.js';

vi.mock('../valueset-package-resource-access.js', () => ({ resolveValueSetPackageDirectories: vi.fn(() => []) }));
vi.mock('../package-defined-urls.js', () => ({ isPackageDefinedUrl: vi.fn(async () => false) }));
vi.mock('../hl7-registrar-packages.js', () => ({ installedHl7CanonicalBases: vi.fn(async () => []) }));

describe('package discovery is needed only for a URL rule that actually applies', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('does not discover packages for ordinary primitives, external URLs, defining URLs, and known exemptions', async () => {
    await expect(unlessPackageDefined(null, 'synthetic')).resolves.toBeNull();
    for (const [value, type, path] of [
      [true, 'boolean', 'Patient.active'], ['synthetic', 'string', 'Patient.name[0].text'],
      ['https://external.test/value', 'url', 'Patient.implicitRules'],
      ['http://hl7.org/fhir/sid/us-npi', 'uri', 'Patient.identifier[0].value'],
      ['http://hl7.org/fhir/unknown', 'uri', 'Patient.url'],
    ] as const) await expect(validateUnresolvedHl7Url(value, type, path, 'Patient')).resolves.toBeNull();
    expect(resolveValueSetPackageDirectories).not.toHaveBeenCalled();
    expect(isPackageDefinedUrl).not.toHaveBeenCalled();
  });

  it('still discovers the packages and preserves the finding when the example URL is not defined', async () => {
    const value = 'http://example.org/synthetic';
    const issue = validateExampleUrl(value, 'uri', 'Patient.implicitRules', 'Patient');
    expect(issue).not.toBeNull();
    await expect(unlessPackageDefined(issue, value)).resolves.toBe(issue);
    expect(resolveValueSetPackageDirectories).toHaveBeenCalledOnce();
    expect(isPackageDefinedUrl).toHaveBeenCalledWith(value, undefined, []);
  });

  it('still checks unresolved HL7 URLs and respects explicit stores', async () => {
    const url = 'http://hl7.org/fhir/unknown';
    const issue = await validateUnresolvedHl7Url(url, 'uri', 'Patient.implicitRules', 'Patient', undefined, ['/synthetic/packages']);
    expect(issue).toMatchObject({ code: 'structural-url-unresolved', path: 'Patient.implicitRules' });
    expect(resolveValueSetPackageDirectories).not.toHaveBeenCalled();
    expect(isPackageDefinedUrl).toHaveBeenCalledWith(url, undefined, ['/synthetic/packages']);
  });
});
