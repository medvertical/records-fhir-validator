import type { PublicFhirVersion } from './index';

export type FailOn = 'error' | 'warning' | 'none';
export type OutputFormat = 'text' | 'json';

export interface CliOptions {
  paths: string[];
  profileUrl?: string;
  fhirVersion: PublicFhirVersion;
  failOn: FailOn;
  format: OutputFormat;
  output?: string;
  summaryOnly: boolean;
  include: string[];
  exclude: string[];
}

export interface CliValidationIssue {
  severity?: unknown;
  path?: unknown;
  message?: unknown;
  code?: unknown;
}

export interface FileResult {
  file: string;
  resourceType?: string;
  profileUrl?: string;
  error?: string;
  issues: CliValidationIssue[];
}

export interface CliSummary {
  files: number;
  errors: number;
  warnings: number;
  issues: number;
}
