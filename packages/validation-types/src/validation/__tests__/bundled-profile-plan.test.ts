import { describe, expect, it } from 'vitest';

import {
  getBundledProfilePlan,
  parseBundledProfilePreset,
} from '../defaults/bundled-profile-plan';
import { HL7_EU_EHDS_2026_PACKAGE_SET } from '../defaults/ig-packages';

describe('bundled profile plan', () => {
  it('ships both IPS targets while activating only the EPS dependency version', () => {
    const ipsVersions = (packages: readonly { id: string; version: string }[]) => packages
      .filter(pkg => pkg.id === 'hl7.fhir.uv.ips')
      .map(pkg => pkg.version);
    expect(ipsVersions(getBundledProfilePlan('ehds-2026').packages)).toEqual(['2.0.0', '2.0.1']);
    expect(ipsVersions(HL7_EU_EHDS_2026_PACKAGE_SET)).toEqual(['2.0.0']);
  });

  it('bundles only neutral infrastructure by default and keeps EHDS separate from MII', () => {
    const defaults = getBundledProfilePlan('default');
    expect(defaults.packages.every(pkg => /^(hl7\.fhir\.(r\d+b?\.core|uv\.extensions\.)|hl7\.terminology\.)/.test(pkg.id))).toBe(true);
    const ehds = getBundledProfilePlan('ehds-2026');
    expect(ehds.packages.some(pkg => pkg.id.startsWith('de.'))).toBe(false);
    expect(ehds.ownedDependencyPrefixes).not.toContain('de.medizininformatikinitiative.');
    expect(ehds.requiredDependencyIds).toEqual([]);
  });
  it('parses configured presets strictly while retaining the explicit default', () => {
    expect(parseBundledProfilePreset(undefined)).toBe('default');
    expect(parseBundledProfilePreset(' mii-2026 ')).toBe('mii-2026');
    expect(() => parseBundledProfilePreset('mii-2025'))
      .toThrow('Unsupported bundled profile preset: mii-2025');
  });

  it('includes the Rare Disease package and its owned Study dependency', () => {
    const plan = getBundledProfilePlan('mii-2026');
    const versions = new Map(plan.packages.map(pin => [pin.id, pin.version]));

    expect(versions.get('de.medizininformatikinitiative.kerndatensatz.seltene'))
      .toBe('2026.0.1');
    expect(versions.get('de.medizininformatikinitiative.kerndatensatz.studie'))
      .toBe('2026.0.2');
    expect(plan.ownedDependencyPrefixes)
      .toContain('de.medizininformatikinitiative.');
    expect(plan.requiredDependencyIds)
      .toContain('de.einwilligungsmanagement');
    expect(versions.get('de.einwilligungsmanagement')).toBe('2.0.3');
    expect(versions.get('de.medizininformatikinitiative.kerndatensatz.pros'))
      .toBe('2026.3.0');
  });
});
