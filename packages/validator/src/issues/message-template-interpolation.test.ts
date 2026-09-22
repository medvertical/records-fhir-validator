import { describe, expect, it } from 'vitest';
import { interpolateMessageTemplate } from './message-template-interpolation';

describe('interpolateMessageTemplate', () => {
  it('substitutes supplied parameters', () => {
    expect(interpolateMessageTemplate(
      'Type mismatch for {element}: expected {expected}, found {actual}',
      { element: 'Patient.name', expected: 'string', actual: 'number' },
    )).toBe('Type mismatch for Patient.name: expected string, found number');
  });

  it('drops a detail clause whose parameters were never supplied', () => {
    // Callers of these codes pass no params, so the raw template used to reach
    // the reader and hide the finding behind template syntax.
    expect(interpolateMessageTemplate('Structural validation failed: {error}', {}))
      .toBe('Structural validation failed');
    expect(interpolateMessageTemplate('Slice validation failed: {error}', {}))
      .toBe('Slice validation failed');
  });

  it('drops the whole clause rather than leaving half of it', () => {
    // "expected at least , found" reads worse than saying nothing.
    expect(interpolateMessageTemplate(
      'Element {element} has too few values: expected at least {min}, found {actual}',
      {},
    )).toBe('Element has too few values');
  });

  it('keeps the parameters it did receive', () => {
    expect(interpolateMessageTemplate("Constraint '{key}' violated: {message}", { key: 'ele-1' }))
      .toBe("Constraint 'ele-1' violated");
  });

  it('leaves a fully substituted message untouched', () => {
    expect(interpolateMessageTemplate('Invalid JSON: {error}', { error: 'unexpected token' }))
      .toBe('Invalid JSON: unexpected token');
  });

  it('treats an empty parameter as supplied rather than missing', () => {
    // Substitution happened, so nothing is stripped and the spacing is left
    // exactly as the template had it. Only unsupplied parameters shorten a
    // message.
    expect(interpolateMessageTemplate('Value is {value}', { value: '' })).toBe('Value is ');
  });

  it('falls back to the raw template when stripping would empty the message', () => {
    expect(interpolateMessageTemplate('{error}', {})).toBe('{error}');
  });
});
