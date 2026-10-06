import { describe, expect, it } from 'vitest';
import { NarrativeValidator } from '../narrative-validator';

const validator = new NarrativeValidator();
const narrative = (img: string) => ({
  status: 'generated',
  div: `<div xmlns="http://www.w3.org/1999/xhtml">Recording:<br/>${img}</div>`,
});
const imageFindings = (resource: Record<string, unknown>) => validator
  .validateNarrative(resource, String(resource.resourceType))
  .filter(issue => issue.code === 'narrative-image-target-not-found');

describe('narrative image sources', () => {
  // Core example Media/sound draws '#11', which nothing in it carries.
  it('flags an image whose fragment names no id of the resource', () => {
    const media = { resourceType: 'Media', id: 'sound', text: narrative('<img src="#11" alt="diagram"/>') };

    expect(imageFindings(media)).toEqual([expect.objectContaining({
      severity: 'error',
      path: 'Media.text.div',
      message: "Image source '#11' does not resolve",
    })]);
  });

  // Spark's List/prognosis draws its family-history diagram from a contained Binary.
  it('resolves a fragment to a contained resource, an element id or an xhtml id', () => {
    const contained = { resourceType: 'List', id: 'prognosis', text: narrative('<img src="#image"/>'),
      contained: [{ resourceType: 'Binary', id: 'image', contentType: 'image/png' }] };
    const element = { resourceType: 'Media', id: 'm', text: narrative("<img src='#photo'/>"),
      content: { id: 'photo', contentType: 'image/png' } };
    const xhtml = { resourceType: 'Media', id: 'm', text: narrative('<img src="#fig"/><p id="fig">figure</p>') };

    expect([contained, element, xhtml].flatMap(imageFindings)).toEqual([]);
  });
});
