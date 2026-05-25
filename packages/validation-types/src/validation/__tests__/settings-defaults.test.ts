import { describe, expect, it } from 'vitest';
import {
  R4_DEFAULT_INCLUDED_RESOURCE_TYPES,
  R5_DEFAULT_INCLUDED_RESOURCE_TYPES,
  getDefaultValidationSettingsForVersion,
} from '../settings-utils';

describe('validation settings defaults', () => {
  it('includes Bundle in default R4 and R5 validation resource types', () => {
    expect(R4_DEFAULT_INCLUDED_RESOURCE_TYPES).toContain('Bundle');
    expect(R5_DEFAULT_INCLUDED_RESOURCE_TYPES).toContain('Bundle');
  });

  it('enables Bundle validation in generated default settings', () => {
    expect(getDefaultValidationSettingsForVersion('R4').resourceTypes.includedTypes).toContain('Bundle');
    expect(getDefaultValidationSettingsForVersion('R5').resourceTypes.includedTypes).toContain('Bundle');
  });
});
