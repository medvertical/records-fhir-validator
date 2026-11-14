import { z } from 'zod';

const selectionId = z.string().min(1).max(160).regex(/^[a-z0-9][a-z0-9._-]*$/);

// An embedding application owns the catalog and validates the selected context.
const WorkspaceModuleSchema = z.object({
  id: selectionId,
  version: z.string().min(1).max(80).regex(/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/),
  context: selectionId,
  parts: z.array(selectionId).max(32).optional(),
  localAuthorities: z.boolean().optional(),
}).strict();

export const WorkspaceValidationModulesSchema = z.array(WorkspaceModuleSchema).max(32)
  .refine(modules => new Set(modules.map(module => module.id)).size === modules.length, 'Module identities must be unique');

export type WorkspaceValidationModule = z.infer<typeof WorkspaceModuleSchema>;
