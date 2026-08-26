import { automatic1111Parser } from './automatic1111';
import { comfyUiParser } from './comfyui';
import { ruinedFooocusParser } from './ruinedfooocus';
import { swarmUiParser } from './swarmui';
import type { MetadataParser } from './types';

/** Detection order is behavior — several formats overlap, and the first match wins. */
export const defaultParsers: MetadataParser<any>[] = [
  automatic1111Parser,
  swarmUiParser,
  ruinedFooocusParser,
  comfyUiParser,
];
