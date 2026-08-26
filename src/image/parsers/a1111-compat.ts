import type { GenerationMetadata } from '../../shared/schema';
import { findKeyForValue } from '../../shared/utils';

/** Maps sampler names to A1111-compatible names for cross-format consistency. */
export function applyA1111Compat(
  metadata: GenerationMetadata,
  samplerMap: ReadonlyMap<string, string[]>,
  options?: { preserveOriginal?: boolean }
) {
  const samplerName = metadata.sampler as string | undefined;
  if (options?.preserveOriginal) metadata.originalSampler = samplerName;
  let a1111sampler: string | undefined;
  if (metadata.scheduler == 'karras') {
    a1111sampler = findKeyForValue(samplerMap, samplerName + '_karras');
  }
  if (!a1111sampler) a1111sampler = findKeyForValue(samplerMap, samplerName as string);
  if (a1111sampler) metadata.sampler = a1111sampler;

  const models = metadata.models as string[] | undefined;
  if (models && models.length > 0) {
    metadata.Model = models[0].replace(/\.[^/.]+$/, '');
  }
}
