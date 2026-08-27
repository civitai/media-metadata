/**
 * Paste-into-prompt — parse A1111 parameter text a user pasted into a form.
 *
 * Mirrors in the civitai app:
 *   src/components/generation_v2/inputs/PromptInput.tsx:65  parsePromptMetadata(...)
 *
 * Run: pnpm exec tsx examples/04-paste-prompt-parameters.ts
 */
import { parseGenerationText } from '../src/index';
import { civitai } from '../src/civitai/index';

const pasted = `a cozy cabin in a snowy forest, warm light in the windows
Negative prompt: blurry, low quality
Steps: 28, Sampler: DPM++ 2M Karras, CFG scale: 6.5, Seed: 1234567, Size: 832x1216, Model: dreamshaper_8`;

// the civitai plugin makes `Civitai resources:`/`Civitai metadata:` blocks parse too
const meta = parseGenerationText(pasted, { plugins: [civitai()] });
console.log(JSON.stringify(meta, null, 2));
