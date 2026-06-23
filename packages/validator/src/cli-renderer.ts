import type { CliOptions, CliSummary, CliValidationIssue, FileResult } from './cli-types';

export function severityOf(issue: CliValidationIssue): string {
  return typeof issue.severity === 'string' ? issue.severity : 'information';
}

export function issuePath(issue: CliValidationIssue): string {
  return typeof issue.path === 'string' && issue.path.length > 0 ? issue.path : '<resource>';
}

export function issueMessage(issue: CliValidationIssue): string {
  return typeof issue.message === 'string' && issue.message.length > 0
    ? issue.message
    : String(issue.code || 'validation issue');
}

export function renderCliOutput(
  summary: CliSummary,
  results: FileResult[],
  options: Pick<CliOptions, 'format' | 'summaryOnly'>,
): string {
  if (options.format === 'json') {
    return JSON.stringify({
      summary,
      ...(options.summaryOnly ? {} : { results }),
    }, null, 2);
  }

  const lines: string[] = [];
  if (!options.summaryOnly) {
    for (const result of results) {
      if (result.error) {
        lines.push(`ERROR ${result.file}: ${result.error}`);
        continue;
      }
      for (const issue of result.issues) {
        lines.push(
          `${severityOf(issue).toUpperCase()} ${result.file} ${issuePath(issue)} ${issue.code || 'issue'}: ${issueMessage(issue)}`,
        );
      }
    }
  }
  lines.push(`Validated ${summary.files} file(s): ${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.issues} issue(s).`);
  return lines.join('\n');
}
