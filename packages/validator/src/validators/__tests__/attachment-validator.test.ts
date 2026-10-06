import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AttachmentValidator, checkAttachmentHasContent } from '../attachment-validator';

describe('AttachmentValidator', () => {
  const validator = new AttachmentValidator();

  it('reports mismatched decoded size and SHA-1 hash', () => {
    const data = Buffer.from('attachment bytes').toString('base64');
    const resource = {
      resourceType: 'DocumentReference',
      content: [{
        attachment: {
          contentType: 'text/plain',
          data,
          size: 999,
          hash: Buffer.alloc(20, 1).toString('base64'),
        },
      }],
    };

    const issues = validator.validate(resource);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'structural-attachment-size-mismatch',
        severity: 'error',
        path: 'DocumentReference.content[0].attachment',
      }),
      expect.objectContaining({
        code: 'structural-attachment-hash-mismatch',
        severity: 'error',
        path: 'DocumentReference.content[0].attachment',
        details: expect.objectContaining({ hashAlgorithm: 'SHA-1' }),
      }),
    ]));
  });

  it('accepts matching size and SHA-1 hash', () => {
    const bytes = Buffer.from('attachment bytes');
    const resource = {
      resourceType: 'DocumentReference',
      content: [{
        attachment: {
          contentType: 'text/plain',
          data: bytes.toString('base64'),
          size: bytes.length,
          hash: createHash('sha1').update(bytes).digest('base64'),
        },
      }],
    };

    expect(validator.validate(resource)).toHaveLength(0);
  });

  // Core example Media/example wraps its content data into lines; Binary/example
  // does the same, but a Binary is no Attachment.
  it('fails attachment data wrapped into lines, but not a Binary', () => {
    const data = 'R0lGODlhEwARAPcAAAAAAAAA/+9aAO+1AP/WAP/eAP/eCP/eEP/eGP/nAP/nCP/nEP/n\nIf/nKf/nUv/nWv/vAP/vCP/vEP/v';
    const media = { resourceType: 'Media', content: { contentType: 'image/gif', data } };
    const binary = { resourceType: 'Binary', contentType: 'image/gif', data };

    expect(validator.validate(media)).toEqual([expect.objectContaining({
      code: 'structural-invalid-base64-format',
      severity: 'error',
      path: 'Media.content',
    })]);
    expect(validator.validate(binary)).toEqual([]);
  });

  it('terminates safely for cyclic object graphs', () => {
    const resource: Record<string, unknown> = { resourceType: 'DocumentReference' };
    resource.self = resource;

    expect(validator.validate(resource)).toEqual([]);
  });

  it('warns for a presentedForm attachment with neither data nor url', () => {
    const resource = {
      resourceType: 'DiagnosticReport',
      presentedForm: [{ title: 'Befundbericht' }],
    };

    const issues = validator.validate(resource);

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'attachment-no-content',
        severity: 'warning',
        path: 'DiagnosticReport.presentedForm[0]',
      }),
    ]);
  });

  it('does not warn when a content-less attachment carries contentType or language', () => {
    const resource = {
      resourceType: 'DiagnosticReport',
      presentedForm: [
        { contentType: 'application/pdf', title: 'x' },
        { language: 'de', title: 'y' },
      ],
    };

    expect(validator.validate(resource)).toHaveLength(0);
  });

  it('does not warn for empty attachments or ones stating why their content is absent', () => {
    const resource = {
      resourceType: 'DiagnosticReport',
      presentedForm: [{
        extension: [{
          url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
          valueCode: 'masked',
        }],
      }, {}],
    };

    expect(validator.validate(resource)).toHaveLength(0);
  });

  it('warns for an attachment that carries only other extensions', () => {
    const resource = {
      resourceType: 'DiagnosticReport',
      presentedForm: [{
        extension: [{ url: 'http://example.org/fhir/StructureDefinition/rendering', valueCode: 'print' }],
      }],
    };

    expect(validator.validate(resource)).toEqual([
      expect.objectContaining({ code: 'attachment-no-content', path: 'DiagnosticReport.presentedForm[0]' }),
    ]);
  });

  it('counts a content element carried only by its extensions as present', () => {
    const attachment = {
      title: 'Scanned report',
      _contentType: { extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason', valueCode: 'unknown' }] },
    };

    expect(checkAttachmentHasContent(attachment, 'DiagnosticReport.presentedForm[0]')).toBeNull();
    expect(checkAttachmentHasContent({ title: 'Scanned report' }, 'DiagnosticReport.presentedForm[0]'))
      .toEqual(expect.objectContaining({ code: 'attachment-no-content', severity: 'warning' }));
  });

  it('reports att-1 when data is present without contentType', () => {
    const resource = {
      resourceType: 'DiagnosticReport',
      presentedForm: [{ data: 'aGk=' }],
    };

    const issues = validator.validate(resource);

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'attachment-att1-violation',
        severity: 'error',
        path: 'DiagnosticReport.presentedForm[0]',
        details: expect.objectContaining({ constraintKey: 'att-1' }),
      }),
    ]);
  });

  it('reports att-1 for choice-typed attachment elements', () => {
    const resource = {
      resourceType: 'Communication',
      payload: [{ contentAttachment: { data: 'aGk=', title: 'note' } }],
    };

    const issues = validator.validate(resource);

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'attachment-att1-violation',
        path: 'Communication.payload[0].contentAttachment',
      }),
    ]);
  });

  it('accepts an attachment with url and contentType', () => {
    const resource = {
      resourceType: 'DiagnosticReport',
      presentedForm: [{
        contentType: 'application/pdf',
        url: 'https://example.org/report.pdf',
      }],
    };

    expect(validator.validate(resource)).toHaveLength(0);
  });

  it('does not misread backbone elements named like attachment containers', () => {
    const resource = {
      resourceType: 'DocumentReference',
      content: [{
        attachment: {
          contentType: 'text/plain',
          url: 'https://example.org/doc.txt',
        },
      }],
    };

    expect(validator.validate(resource)).toHaveLength(0);
  });
});
