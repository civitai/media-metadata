import * as z from 'zod';

const stringToNumber = z.coerce.number().optional();

const undefinedString = z
  .preprocess((value) => (value ? value : undefined), z.string().optional())
  .optional();

export type ComfyMetaSchema = z.infer<typeof comfyMetaSchema>;
export const comfyMetaSchema = z
  .object({
    prompt: z.looseObject({}),
    workflow: z.looseObject({
      nodes: z.looseObject({}).array().optional(),
    }),
  })
  .partial();

export const externalMetaSchema = z.object({
  source: z
    .object({
      name: z.string().optional(),
      homepage: z.url().optional(),
    })
    .optional(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  createUrl: z.url().optional(),
  referenceUrl: z.url().optional(),
});
export type ExternalMetaSchema = z.infer<typeof externalMetaSchema>;

export const metadataResourceSchema = z.object({
  type: z.string(),
  name: z.string().optional(),
  weight: z.number().optional(),
  hash: z.string().optional(),
  unmatched: z.boolean().optional(),
});
export type MetadataResource = z.infer<typeof metadataResourceSchema>;

export const additionalResourceSchema = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  strength: z.number().optional(),
  strengthClip: z.number().optional(),
  air: z.string().optional(),
});
export type AdditionalResource = z.infer<typeof additionalResourceSchema>;

export type CivitaiResource = z.infer<typeof civitaiResourceSchema>;
export const civitaiResourceSchema = z.object({
  type: z.string().optional(),
  weight: z.number().optional(),
  modelVersionId: z.number(),
});

export const generationSchema = z.object({
  baseModel: z.string().optional(),
  prompt: undefinedString,
  negativePrompt: undefinedString,
  cfgScale: stringToNumber,
  steps: stringToNumber,
  sampler: undefinedString,
  seed: stringToNumber,
  hashes: z.record(z.string(), z.string()).optional(),
  clipSkip: z.coerce.number().optional(),
  'Clip skip': z.coerce.number().optional(),
  comfy: z.union([z.string().optional(), comfyMetaSchema.optional()]).optional(),
  external: externalMetaSchema.optional(),
  effects: z.record(z.string(), z.any()).optional(),
  engine: z.string().optional(),
  version: z.string().optional(),
  process: z.string().optional(),
  type: z.string().optional(),
  workflow: z.string().optional(),
  resources: metadataResourceSchema.array().optional(),
  additionalResources: additionalResourceSchema.array().optional(),
  civitaiResources: civitaiResourceSchema.array().optional(),
  extra: z.record(z.string(), z.unknown()).optional().catch(undefined),
});

export const generationMetadataSchema = z.looseObject({ ...generationSchema.shape });

/**
 * The loose metadata bag every parser produces. Passthrough keys (e.g. 'Model hash',
 * 'AddNet Module 1') are preserved and read downstream by string literal.
 */
export type GenerationMetadata = z.infer<typeof generationMetadataSchema> & Record<string, unknown>;
