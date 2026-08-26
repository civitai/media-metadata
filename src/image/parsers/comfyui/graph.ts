export type ComfyNode = {
  inputs: Record<string, number | string | Array<string | number> | ComfyNode>;
  class_type: string;
};

export type SamplerNode = {
  seed: number;
  noise_seed?: number;
  steps: number;
  cfg: number;
  sampler_name: string;
  scheduler: string;
  denoise: number;
  model: ComfyNode;
  positive: ComfyNode;
  negative: ComfyNode;
  latent_image: ComfyNode;
};

export function cleanBadJson(str: string) {
  return str
    .replace(/\[NaN\]/g, '[]')
    .replace(/\bNaN\b/g, '0')
    .replace(/\[Infinity\]/g, '[]');
}

const MAX_PROMPT_DEPTH = 20;

export function getPromptText(
  node: ComfyNode,
  target: 'positive' | 'negative' = 'positive',
  visited = new Set<ComfyNode>()
): string {
  if (visited.has(node) || visited.size >= MAX_PROMPT_DEPTH) return '';
  visited.add(node);

  if (node.class_type === 'ControlNetApply')
    return getPromptText(node.inputs.conditioning as ComfyNode, target, visited);
  if (node.class_type === 'FluxGuidance')
    return getPromptText(node.inputs.conditioning as ComfyNode, target, visited);

  // Handle wildcard nodes
  if (node.inputs?.populated_text) node.inputs.text = node.inputs.populated_text;

  if (node.inputs?.text) {
    if (typeof node.inputs.text === 'string') return node.inputs.text;
    if (typeof (node.inputs.text as ComfyNode).class_type !== 'undefined')
      return getPromptText(node.inputs.text as ComfyNode, target, visited);
  }
  if (node.inputs?.text_g) {
    if (!node.inputs?.text_l || node.inputs?.text_l === node.inputs?.text_g)
      return node.inputs.text_g as string;
    return `${node.inputs.text_g}, ${node.inputs.text_l}`;
  }
  if (node.inputs?.[`text_${target}`]) return node.inputs[`text_${target}`] as string;
  return '';
}

export type ComfyNumber = ComfyNode | number;
export function getNumberValue(input: ComfyNumber, valueNames = ['Value']) {
  if (typeof input === 'number') return input;
  for (const name of valueNames) {
    if (typeof input.inputs[name] !== 'undefined') return input.inputs[name] as number;
  }
  return 0;
}
