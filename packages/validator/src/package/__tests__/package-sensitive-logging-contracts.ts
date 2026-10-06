import ts from 'typescript';
import { expect } from 'vitest';

export function assertPackageSensitiveLoggingBoundary(path: string, source: string): void {
    const loggerCalls = collectLoggerCalls(path, source);

    for (const call of loggerCalls) {
      expect(call.arguments[0]?.getText(call.getSourceFile())).not.toContain('`');

      const sanitizedCall = call.getText(call.getSourceFile())
        .replace(/packageReferenceMetadata\([^)]*\)/g, '')
        .replace(/packageTargetMetadata\([^)]*\)/g, '')
        .replace(/packageErrorMetadata\([^)]*\)/g, '')
        .replace(/profileSourceErrorMetadata\([^)]*\)/g, '')
        .replace(/this\.registryName\([^)]*\)/g, '');

      expect(sanitizedCall).not.toMatch(/\b(?:packageId|profileUrl|tarballUrl|targetPath|packageDir|registryUrl)\b/);
      expect(sanitizedCall).not.toMatch(/\b(?:err|error)\.message\b/);
      expect(sanitizedCall).not.toMatch(/,\s*(?:err|error)\s*\)/);
    }
}

function collectLoggerCalls(path: string, source: string): ts.CallExpression[] {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: ts.CallExpression[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'logger'
      && ['debug', 'info', 'warn', 'error'].includes(node.expression.name.text)
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return calls;
}
