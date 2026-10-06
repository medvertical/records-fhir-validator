import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NarrativeValidator } from '../narrative-validator.js';

interface TargetControl {
  id: string;
  resource: Record<string, unknown>;
  select?: 'root' | 'contained' | 'entry';
  boundBundle?: boolean;
  cloneSelected?: boolean;
  expectedCodes: string[];
  expectedComplete: boolean;
}
const controls = JSON.parse(readFileSync(new URL('./fixtures/narrative-textlink-data-targets.json', import.meta.url), 'utf8')) as TargetControl[];

function selectedResource(control: TargetControl): Record<string, unknown> {
  let selected: unknown = control.resource;
  if (control.select === 'contained' && Array.isArray(control.resource.contained)) selected = control.resource.contained[0];
  if (control.select === 'entry' && Array.isArray(control.resource.entry)) selected = control.resource.entry[0].resource;
  if (typeof selected !== 'object' || selected === null || Array.isArray(selected)) throw new Error('Malformed controlled fixture');
  return control.cloneSelected ? structuredClone(selected) as Record<string, unknown> : selected as Record<string, unknown>;
}

describe('Narrative textLink target identity and unavailable context', () => {
  for (const control of controls) {
    it(control.id, () => {
      const resource = selectedResource(control);
      const issues = new NarrativeValidator().validateNarrative(resource, String(resource.resourceType),
        control.boundBundle ? control.resource : undefined).filter(issue => issue.code?.startsWith('narrative-textlink-'));
      expect(issues.map(issue => issue.code)).toEqual(control.expectedCodes);
      expect(issues.some(issue => typeof issue.details === 'object' && issue.details !== null && issue.details.validationComplete === false)).toBe(!control.expectedComplete);
      expect(issues.some(issue => issue.code === 'narrative-textlink-uri-no-target')).toBe(false);
      for (const issue of issues) {
        expect(issue.severity).toBe(issue.code === 'narrative-textlink-target-unverified' ? 'information' : 'error');
      }
    });
  }
});
