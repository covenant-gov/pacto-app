type Platform = 'macos' | 'windows' | 'linux' | 'unknown';

interface ReleaseAsset {
  name: string;
  platform: string;
  arch: string;
  label: string;
  url: string;
  size: number;
  signatureUrl?: string;
}

interface ReleaseManifest {
  tag: string;
  publishedAt: string;
  releaseUrl: string;
  assets: ReleaseAsset[];
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  // Mobile and tablet platforms are not currently supported as install targets.
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod') || ua.includes('android')) return 'unknown';
  if (ua.includes('mac') || ua.includes('darwin')) return 'macos';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

function platformName(platform: Platform): string {
  switch (platform) {
    case 'macos':
      return 'macOS';
    case 'windows':
      return 'Windows';
    case 'linux':
      return 'Linux';
    default:
      return 'your platform';
  }
}

function detectArch(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('aarch64') || ua.includes('arm64')) return 'aarch64';
  if (ua.includes('x86_64') || ua.includes('x64') || ua.includes('intel')) return 'x86_64';
  if (ua.includes('arm')) return 'aarch64';
  return 'unknown';
}

async function loadManifest(): Promise<ReleaseManifest> {
  const base = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';
  const response = await fetch(`${base}/pacto-release.json`);
  if (!response.ok) {
    throw new Error(`Failed to load release manifest: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as ReleaseManifest;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function findBestAsset(assets: ReleaseAsset[], platform: Platform, arch: string): ReleaseAsset | null {
  if (platform === 'unknown') return null;

  const platformAssets = assets.filter(a => a.platform === platform);
  if (platformAssets.length === 0) return null;

  // Prefer an asset whose arch matches the visitor's detected arch.
  if (arch !== 'unknown') {
    const archMatch = platformAssets.find(a => a.arch === arch || (arch === 'aarch64' && a.arch === 'arm64'));
    if (archMatch) return archMatch;
  }

  // When multiple installers exist for the same platform, pick the preferred format.
  const preferred = platformAssets.find(a => a.name.toLowerCase().endsWith('.msi'));
  if (preferred) return preferred;

  return platformAssets[0];
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: { className?: string; text?: string; href?: string; download?: boolean; target?: string; rel?: string }
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options?.className) el.className = options.className;
  if (options?.text) el.textContent = options.text;
  if (options?.href && (el instanceof HTMLAnchorElement)) {
    el.href = options.href;
    if (options.download) el.setAttribute('download', '');
    if (options.target) el.target = options.target;
    if (options.rel) el.rel = options.rel;
  }
  return el;
}

function createPrimaryCard(
  manifest: ReleaseManifest,
  platform: Platform,
  asset: ReleaseAsset | null
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card primary-card';

  const heading = createElement('h2', { text: asset ? `Download for ${platformName(platform)}` : `No installer for ${platformName(platform)}` });
  card.appendChild(heading);

  const meta = createElement('p', { className: 'meta' });
  meta.textContent = asset
    ? `${asset.label} · ${formatBytes(asset.size)}`
    : "We don't have a prebuilt installer for your platform yet.";
  card.appendChild(meta);

  const link = createElement('a', {
    className: asset ? 'button' : 'button secondary',
    text: asset ? `Download ${asset.name}` : 'View releases on GitHub',
    href: asset ? asset.url : manifest.releaseUrl,
    ...(asset ? { download: true } : { target: '_blank', rel: 'noopener noreferrer' }),
  });
  card.appendChild(link);

  if (asset) {
    const tag = createElement('p', { className: 'tag', text: `Release ${manifest.tag}` });
    card.appendChild(tag);
  }

  return card;
}

function createAllDownloadsList(assets: ReleaseAsset[]): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'download-list hidden';
  list.id = 'download-list';
  list.setAttribute('aria-live', 'polite');

  for (const asset of assets) {
    const li = document.createElement('li');

    const info = document.createElement('div');
    info.className = 'info';

    const label = createElement('span', { className: 'label', text: asset.label });
    info.appendChild(label);

    const meta = createElement('span', { className: 'meta', text: `${asset.name} · ${formatBytes(asset.size)}` });
    info.appendChild(meta);

    li.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const downloadLink = createElement('a', {
      className: 'button secondary',
      text: 'Download',
      href: asset.url,
      download: true,
      rel: 'noopener noreferrer',
    });
    actions.appendChild(downloadLink);

    if (asset.signatureUrl) {
      const sigLink = createElement('a', {
        className: 'button secondary',
        text: 'Signature',
        href: asset.signatureUrl,
        download: true,
        rel: 'noopener noreferrer',
      });
      actions.appendChild(sigLink);
    }

    li.appendChild(actions);
    list.appendChild(li);
  }

  return list;
}

async function init(): Promise<void> {
  const primary = document.getElementById('primary-download');
  const toggle = document.getElementById('toggle-all');
  const existingList = document.getElementById('download-list');

  if (!primary || !toggle || !existingList) {
    console.error('Download page DOM elements missing');
    return;
  }

  try {
    const manifest = await loadManifest();
    const platform = detectPlatform();
    const arch = detectArch();
    const bestAsset = findBestAsset(manifest.assets, platform, arch);

    primary.innerHTML = '';
    primary.appendChild(createPrimaryCard(manifest, platform, bestAsset));

    const allList = createAllDownloadsList(manifest.assets);
    existingList.replaceWith(allList);

    let expanded = false;
    toggle.addEventListener('click', () => {
      expanded = !expanded;
      toggle.setAttribute('aria-expanded', String(expanded));
      allList.classList.toggle('hidden', !expanded);
      toggle.textContent = expanded ? 'Hide all downloads' : 'Show all downloads';
    });
  } catch (error) {
    primary.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card error-card';

    const heading = createElement('h2', { text: "Couldn't load release data" });
    card.appendChild(heading);

    const meta = createElement('p', { className: 'meta', text: error instanceof Error ? error.message : 'Unknown error' });
    card.appendChild(meta);

    const link = createElement('a', {
      className: 'button secondary',
      text: 'View releases on GitHub',
      href: 'https://github.com/covenant-gov/pacto-app/releases',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    card.appendChild(link);

    primary.appendChild(card);
    toggle.disabled = true;
    console.error('Failed to load release manifest:', error);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    void init();
  }
}

export { detectPlatform, platformName, detectArch, loadManifest, formatBytes, findBestAsset };
export type { Platform, ReleaseAsset, ReleaseManifest };
