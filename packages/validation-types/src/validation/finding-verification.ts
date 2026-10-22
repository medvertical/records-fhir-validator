import { z } from 'zod';

export const findingIdentitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('logical'), signature: z.string().regex(/^logical:[a-f0-9]{32}$/) }).strict(),
  z.object({ kind: z.literal('data-quality'), signature: z.string().startsWith('dqa:').min(5).max(512) }).strict(),
]);
export type FindingIdentity = z.infer<typeof findingIdentitySchema>;

export const verifyFindingsRequestSchema = z.object({
  sourceRunId: z.number().int().positive().safe(),
  verificationRunId: z.number().int().positive().safe(),
  findings: z.array(findingIdentitySchema).min(1).max(50),
}).strict().superRefine((request, context) => {
  if (new Set(request.findings.map(finding => finding.signature)).size !== request.findings.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Finding identities must be unique', path: ['findings'] });
  }
});
export type VerifyFindingsRequest = z.infer<typeof verifyFindingsRequestSchema>;

export const findingVerificationStatusSchema = z.enum(['resolved', 'persists', 'not_comparable', 'inconclusive']);
export type FindingVerificationStatus = z.infer<typeof findingVerificationStatusSchema>;
export const verifyFindingsResultSchema = z.object({
  sourceRunId: z.number().int().positive().safe(),
  verificationRunId: z.number().int().positive().safe(),
  validatorChanged: z.boolean().nullable(),
  findings: z.array(z.object({
    identity: findingIdentitySchema,
    status: findingVerificationStatusSchema,
    reason: z.string(),
    sourceOccurrences: z.number().int().nonnegative().nullable(),
    remainingOccurrences: z.number().int().nonnegative().nullable(),
    qualityRulePassed: z.boolean().nullable(),
  }).strict()).max(50),
}).strict();
export type VerifyFindingsResult = z.infer<typeof verifyFindingsResultSchema>;

const issueUrlSchema = z.string().max(2048).url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    && /^\/[^/]+\/[^/]+\/issues\/\d+$/.test(url.pathname);
}, 'Expected an HTTPS GitHub or GitHub Enterprise issue URL');

export const githubFindingManifestSchema = z.object({
  schemaVersion: z.literal(1),
  issues: z.array(z.object({
    url: issueUrlSchema,
    sourceRunId: z.number().int().positive().safe(),
    findings: z.array(findingIdentitySchema).min(1).max(2000),
  }).strict()).min(1).max(200),
}).strict().superRefine((manifest, context) => {
  const urls = manifest.issues.map(issue => issue.url);
  if (new Set(urls).size !== urls.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Issue URLs must be unique' });
  for (const [index, issue] of manifest.issues.entries()) {
    if (new Set(issue.findings.map(finding => finding.signature)).size !== issue.findings.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Finding identities must be unique', path: ['issues', index, 'findings'] });
    }
  }
  if (manifest.issues.reduce((count, issue) => count + issue.findings.length, 0) > 10_000) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Manifest exceeds 10000 finding references' });
  }
});
export type GitHubFindingManifest = z.infer<typeof githubFindingManifestSchema>;
