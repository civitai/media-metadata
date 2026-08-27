import type { MediaMetadata } from '../src/index';
import { copyMetadata, encodeMetadata, payloadFromMediaMetadata, readMetadata } from '../src/index';

const drop = document.getElementById('drop')!;
const fileInput = document.getElementById('file') as HTMLInputElement;
const urlInput = document.getElementById('url') as HTMLInputElement;
const fetchBtn = document.getElementById('fetch')!;
const results = document.getElementById('results')!;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function describeExif(exif: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(exif)) {
    if (value instanceof Uint8Array) out[key] = `<${value.length} bytes>`;
    else if (typeof value === 'string' && value.length > 2000)
      out[key] = value.slice(0, 2000) + `… (${value.length} chars)`;
    else out[key] = value;
  }
  return out;
}

function section(title: string, body: string, open = false): HTMLElement {
  const details = el('details');
  details.open = open;
  details.append(el('summary', undefined, title));
  details.append(el('pre', undefined, body));
  return details;
}

function render(name: string, bytes: Uint8Array, md: MediaMetadata) {
  const card = el('div', 'card');
  const header = el('header');

  const img = el('img');
  img.src = URL.createObjectURL(new Blob([bytes as BlobPart]));
  header.append(img);

  const info = el('div');
  info.append(el('div', 'name', `${name} — ${(bytes.length / 1024).toFixed(0)} KB`));
  const badges = el('div', 'badges');
  badges.append(el('span', 'badge', md.format));
  badges.append(
    el('span', `badge ${md.generator ? 'gen' : 'bad'}`, md.generator ?? 'no generator detected')
  );
  if (md.madeOnSite) badges.append(el('span', 'badge good', 'made on civitai'));
  const metaKeys = Object.keys(md.meta).length;
  badges.append(el('span', 'badge', `${metaKeys} meta key${metaKeys === 1 ? '' : 's'}`));
  info.append(badges);
  header.append(info);
  card.append(header);

  card.append(section('Parsed metadata (meta)', JSON.stringify(md.meta, null, 2), true));
  const encoded = encodeMetadata(md.meta);
  if (encoded) card.append(section('Re-encoded A1111 text (encodeMetadata)', encoded));
  const payload = payloadFromMediaMetadata(md);
  card.append(
    section(
      'Embeddable payload (payloadFromMediaMetadata)',
      JSON.stringify(
        Object.fromEntries(
          Object.entries(payload).map(([k, v]) => [
            k,
            v instanceof Uint8Array ? `<${v.length} bytes>` : v,
          ])
        ),
        null,
        2
      )
    )
  );
  card.append(section('Raw tags (exif)', JSON.stringify(describeExif(md.exif), null, 2)));
  card.append(transformControls(name, bytes, md));

  const download = el('button', undefined, 'Download');
  download.addEventListener('click', () => downloadBytes(name, bytes, md.format));
  card.querySelector('.badges')?.after(download);

  results.prepend(card);
}

function downloadBytes(name: string, bytes: Uint8Array, format: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart]));
  a.download = /\.\w+$/.test(name) ? name : `${name}.${format}`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Diff two meta bags: keys whose JSON value changed or disappeared. */
function metaDiff(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

/**
 * Resize/convert via canvas — the same thing the civitai app does in
 * canvas-utils.ts — then restore the metadata with copyMetadata and re-read.
 */
function transformControls(name: string, source: Uint8Array, sourceMd: MediaMetadata): HTMLElement {
  const row = el('div', 'transform');
  row.append(
    el('span', 'tlabel', 'Resize / convert (canvas strips metadata; copyMetadata restores it):')
  );

  const widthInput = el('input') as HTMLInputElement;
  widthInput.type = 'number';
  widthInput.value = '512';
  widthInput.min = '16';
  widthInput.title = 'target width (px)';

  const formatSelect = el('select') as HTMLSelectElement;
  for (const f of ['png', 'jpeg', 'webp (unsupported)'] as const) {
    const opt = el('option', undefined, f);
    opt.value = f.split(' ')[0];
    formatSelect.append(opt);
  }
  formatSelect.value = sourceMd.format === 'jpeg' ? 'jpeg' : 'png';

  const go = el('button', undefined, 'Transform + copyMetadata');
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      const width = Math.max(16, Number(widthInput.value) || 512);
      const format = formatSelect.value;
      const bitmap = await createImageBitmap(new Blob([source as BlobPart]));
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(width, bitmap.width);
      canvas.height = Math.round(bitmap.height * (canvas.width / bitmap.width));
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, `image/${format}`, format === 'jpeg' ? 0.9 : undefined)
      );
      if (!blob) throw new Error('canvas.toBlob failed');
      const stripped = new Uint8Array(await blob.arrayBuffer());

      // this is the line the app's canvas-utils.ts collapses to:
      const restored = await copyMetadata(source, stripped);

      const md = await readMetadata(restored);
      const label = `${name} → ${canvas.width}px ${format}`;
      render(label, restored, md);

      // annotate the freshly prepended card with the round-trip verdict
      const badges = results.firstElementChild?.querySelector('.badges');
      const changed = metaDiff(sourceMd.meta, md.meta as Record<string, unknown>);
      if (changed.length === 0) {
        badges?.append(el('span', 'badge good', 'metadata fully preserved'));
      } else {
        badges?.append(
          el('span', 'badge bad', `lossy for this target: ${changed.length} key(s) changed`)
        );
        results.firstElementChild?.append(
          section(
            'Changed/lost keys vs source',
            JSON.stringify(
              Object.fromEntries(
                changed.map((k) => [k, { before: sourceMd.meta[k], after: md.meta[k] }])
              ),
              null,
              2
            ),
            true
          )
        );
      }
    } catch (error) {
      renderError(`${name} (transform)`, error);
    } finally {
      go.disabled = false;
    }
  });

  row.append(widthInput, formatSelect, go);
  return row;
}

function renderError(name: string, error: unknown) {
  const card = el('div', 'card');
  card.append(el('div', 'name', name));
  card.append(el('div', 'err', String(error)));
  results.prepend(card);
}

async function handleBytes(name: string, bytes: Uint8Array) {
  try {
    render(name, bytes, await readMetadata(bytes));
  } catch (error) {
    renderError(name, error);
  }
}

async function handleFiles(files: Iterable<File>) {
  for (const file of files) {
    await handleBytes(file.name, new Uint8Array(await file.arrayBuffer()));
  }
}

async function handleUrl(url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await handleBytes(url.split('/').pop() ?? url, new Uint8Array(await res.arrayBuffer()));
  } catch (error) {
    renderError(url, error);
  }
}

drop.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files) void handleFiles(fileInput.files);
  fileInput.value = '';
});
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  // Dragging from a web page yields a URL, from the desktop yields files
  if (e.dataTransfer?.files.length) {
    void handleFiles(e.dataTransfer.files);
    return;
  }
  const uri = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
  if (uri) void handleUrl(uri.trim());
});
document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files ?? [])];
  if (files.length) void handleFiles(files);
});
fetchBtn.addEventListener('click', () => {
  if (urlInput.value) void handleUrl(urlInput.value);
});
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && urlInput.value) void handleUrl(urlInput.value);
});
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-sample]')) {
  btn.addEventListener('click', () => void handleUrl(btn.dataset.sample!));
}
