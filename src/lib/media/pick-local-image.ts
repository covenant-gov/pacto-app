import { open as openFileDialog } from '@tauri-apps/plugin-dialog';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const;

/** Native file picker for a single local image. Returns a filesystem path or null if cancelled. */
export async function pickLocalImage(options: {
  title: string;
  filterName: string;
}): Promise<string | null> {
  const selected = await openFileDialog({
    title: options.title,
    filters: [{ name: options.filterName, extensions: [...IMAGE_EXTENSIONS] }],
    multiple: false,
  });
  if (selected == null) return null;
  if (typeof selected === 'string') return selected;
  return selected[0] ?? null;
}
