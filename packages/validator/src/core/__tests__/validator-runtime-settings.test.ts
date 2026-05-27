import { describe, expect, it } from 'vitest';
import type { ValidationSettings } from '../../types';
import { buildTerminologyResolutionConfig } from '../validator-runtime-settings';

describe('buildTerminologyResolutionConfig', () => {
  it('passes two-phase expansion settings to the validator runtime', () => {
    const settings = {
      terminologyServers: [{
        id: 'tx',
        url: 'https://tx.example/fhir',
        enabled: true,
        circuitOpen: false,
        fhirVersions: ['R4'],
      }],
      terminologyResolution: {
        strategy: 'local-first',
        twoPhaseExpansion: {
          enabled: true,
          mode: 'shadow',
          logMismatches: true,
        },
      },
    } as ValidationSettings;

    expect(buildTerminologyResolutionConfig(settings).twoPhaseExpansion).toEqual({
      enabled: true,
      mode: 'shadow',
      logMismatches: true,
    });
  });
});
