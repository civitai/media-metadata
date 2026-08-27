export type Generator = 'automatic1111' | 'swarmui' | 'ruinedfooocus' | 'comfyui';

export type ImageFormat = 'jpeg' | 'png' | 'webp';

/** Flattened EXIF/text-chunk tags: ExifReader tag values keyed by tag name. */
export type ExifData = Record<string, unknown>;

export type BinaryInput = Uint8Array | ArrayBuffer | Blob | File | string;

/** Namespace the civitai() plugin attaches to MediaMetadata. */
export interface CivitaiMetadata {
  /** EXIF Artist === 'ai' — the on-site generation marker. */
  madeOnSite: boolean;
  /** The `Civitai metadata:` payload / on-site extras. */
  extra?: Record<string, unknown>;
}
