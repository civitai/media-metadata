import type { ExifData } from '../shared/types';

/**
 * Civitai stamps `Artist: ai` into the EXIF of media generated on-site;
 * that tag is the on-site marker.
 */
export function isMadeOnSite(exif: ExifData): boolean {
  const artist = exif.Artist;
  if (!artist) return false;
  const value = Array.isArray(artist) ? artist.join(', ') : artist;
  return value === 'ai';
}

export const MADE_ON_SITE_ARTIST = 'ai';
