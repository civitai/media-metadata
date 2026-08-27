import type { GenerationMetadata } from '../shared/schema';
import { extractBalancedJson } from '../image/parsers/a1111-text';
import type { A1111DetailExtractor } from '../image/parsers/types';
import type { ParsedAir } from './air';

const CIVITAI_RESOURCES = /, Civitai resources:\s*(\[\{.*?\}\])/;
const CIVITAI_METADATA_PREFIX = ', Civitai metadata: ';

type CivitaiResourceRaw = {
  weight?: number;
  air?: string;
  modelVersionId?: number;
  type?: string;
  versionName?: string;
  modelName?: string;
};

/** `, Civitai resources: [{...}]` → metadata.civitaiResources with AIRs resolved to version ids. */
export function civitaiResourcesExtractor(
  resolveAir: (air: string) => ParsedAir
): A1111DetailExtractor {
  return (detailsLine, metadata) => {
    const match = detailsLine.match(CIVITAI_RESOURCES)?.[1];
    if (!match) return detailsLine;
    metadata.civitaiResources = JSON.parse(match);
    for (const resource of metadata.civitaiResources as CivitaiResourceRaw[]) {
      delete resource.modelName;
      delete resource.versionName;
      if (!resource.air) continue;
      const { version, type } = resolveAir(resource.air);
      resource.modelVersionId = version;
      resource.type = type;
      delete resource.air;
    }
    return detailsLine.replace(CIVITAI_RESOURCES, '');
  };
}

/** `, Civitai metadata: {...}` (may nest) → metadata.extra. */
export const civitaiMetadataExtractor: A1111DetailExtractor = (
  detailsLine,
  metadata: GenerationMetadata
) => {
  const result = extractBalancedJson(detailsLine, CIVITAI_METADATA_PREFIX);
  if (!result) return detailsLine;
  const data = JSON.parse(result.json) as Record<string, any>;
  if (Object.keys(data).length !== 0) metadata.extra = data;
  return detailsLine.slice(0, result.start) + detailsLine.slice(result.end);
};
