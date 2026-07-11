type Platform = 'macos' | 'windows' | 'linux' | 'ios' | 'other';

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

const taglineWords = [
  'Private.',
  'Decentralized.',
  'Open-Source.',
  'Free.',
  'No KYC.',
  'No Metadata.',
  'No Data Leaks.',
  'No Ads.',
];

const osIcons: Record<string, string> = {
  Windows:
    '<svg xmlns="http://www.w3.org/2000/svg" height="88" width="88" viewBox="0 0 88 88"><path d="M0 12.402l35.687-4.86.016 34.423-35.67.203zm35.67 33.529l.028 34.453L.028 75.48.026 45.7zm4.326-39.025L87.314 0v41.527l-47.318.376zm47.329 39.349l-.011 41.34-47.318-6.678-.066-34.739z"/></svg>',
  macOS:
    '<svg height="800px" width="800px" version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22.773 22.773"><g><path d="M15.769,0c0.053,0,0.106,0,0.162,0c0.13,1.606-0.483,2.806-1.228,3.675c-0.731,0.863-1.732,1.7-3.351,1.573c-0.108-1.583,0.506-2.694,1.25-3.561C13.292,0.879,14.557,0.16,15.769,0z"/><path d="M20.67,16.716c0,0.016,0,0.03,0,0.045c-0.455,1.378-1.104,2.559-1.896,3.655c-0.723,0.995-1.609,2.334-3.191,2.334c-1.367,0-2.275-0.879-3.676-0.903c-1.482-0.024-2.297,0.735-3.652,0.926c-0.155,0-0.31,0-0.462,0c-0.995-0.144-1.798-0.932-2.383-1.642c-1.725-2.098-3.058-4.808-3.306-8.276c0-0.34,0-0.679,0-1.019c0.105-2.482,1.311-4.5,2.914-5.478c0.846-0.52,2.009-0.963,3.304-0.765c0.555,0.086,1.122,0.276,1.619,0.464c0.471,0.181,1.06,0.502,1.618,0.485c0.378-0.011,0.754-0.208,1.135-0.347c1.116-0.403,2.21-0.865,3.652-0.648c1.733,0.262,2.963,1.032,3.723,2.22c-1.466,0.933-2.625,2.339-2.427,4.74C17.818,14.688,19.086,15.964,20.67,16.716z"/></g></svg>',
  Linux:
    '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 800 800"><path d="M143.3729,749.0272c41.2542,4.9268,87.6064,31.6514,126.3972,36.3696,38.9994,4.9243,51.0679-26.5583,51.0679-26.5583,0,0,43.8864-9.8113,90.025-10.9412,46.1834-1.2938,89.9009,9.6052,89.9009,9.6052,0,0,8.4778,19.4165,24.3035,27.8943,15.8257,8.6417,49.8983,9.8113,71.736-13.1959,21.8799-23.1736,80.256-52.3642,113.0348-70.611,32.9874-18.2891,26.9333-46.1809,6.223-54.6587-20.7102-8.4753-37.6633-21.8377-36.3696-47.4771,1.1274-25.4284-18.2891-42.3815-18.2891-42.3815,0,0,16.9953-55.9525,1.1696-102.3022-15.8257-46.1387-68.021-120.3405-108.1478-176.1266-40.1267-55.9525-6.0566-120.5491-42.5901-203.1021C475.2959-7.1355,380.5527-2.2484,329.4847,32.9913c-51.0679,35.2422-35.411,122.6-49.0632,180.0879-12.6266,52.4874-55.3279,79.1176-86.7133,114.9958-32.0112,36.4946-51.8174,91.6835-42.8425,155.1978,3.3455,23.3186,14.8365,54.4335,35.9775,88.7015C188.3014,590.5306,225.0191,639.0531,252.7438,672.8981,279.3791,705.437,284.2617,719.4266,300.0874,728.5622zM343.2987,247.1836c-7.4491,12.7578-17.5867,24.3035-30.7629,33.1876-10.2484,7.0421-22.0995,12.1627-34.9605,14.649-1.0052,8.2273-1.4208,16.7469-1.4208,25.5552,0,74.0299,42.0112,132.0099,97.6158,132.0099,55.2448,0,97.6158-57.98,97.6158-132.0099,0-8.8083-0.4156-17.3279-1.4208-25.5552-12.861-2.4863-24.7122-7.6069-34.9605-14.649-13.1763-8.8841-23.3138-20.4298-30.7629-33.1876-12.6791,4.8725-26.4748,7.5433-40.9121,7.5433S355.9778,252.0561,343.2987,247.1836z"/></svg>',
};

function detectPlatform(): { platform: Platform; arch: string | null; buttonText: string; filePattern: RegExp | null } {
  const ua = (navigator.userAgent || '').toLowerCase();
  const platform = (navigator.platform || '').toLowerCase();

  function detectArch(): string | null {
    if (ua.includes('aarch64') || ua.includes('arm64') || platform.includes('aarch64') || platform.includes('arm64')) {
      return 'aarch64';
    }
    if (ua.includes('x86_64') || ua.includes('x64') || ua.includes('amd64') || platform.includes('x86_64')) {
      return 'x86_64';
    }
    return null;
  }

  if (platform.includes('mac')) {
    const arch = detectArch();
    const archLabel = arch === 'aarch64' ? ' (Apple Silicon)' : arch === 'x86_64' ? ' (Intel)' : '';
    return { platform: 'macos', arch, buttonText: `Download for macOS${archLabel}`, filePattern: /\.dmg$/i };
  }
  if (platform.includes('win')) {
    const arch = detectArch();
    return { platform: 'windows', arch, buttonText: 'Download for Windows', filePattern: /\.(exe|msi)$/i };
  }
  if (
    platform.includes('iphone') ||
    platform.includes('ipad') ||
    platform.includes('ipod') ||
    (ua.includes('mac') && 'ontouchend' in document)
  ) {
    return { platform: 'ios', arch: null, buttonText: 'Coming Soon', filePattern: null };
  }
  if (platform.includes('linux') || platform.includes('x11')) {
    const arch = detectArch();
    const archLabel = arch === 'aarch64' ? ' (ARM64)' : arch === 'x86_64' ? ' (x64)' : '';
    return { platform: 'linux', arch, buttonText: `Download for Linux${archLabel}`, filePattern: /\.(AppImage|deb|rpm|tar\.gz|tgz)$/i };
  }
  return { platform: 'other', arch: null, buttonText: 'Download Pacto', filePattern: null };
}

async function loadManifest(): Promise<ReleaseManifest> {
  const base = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';
  const response = await fetch(`${base}/pacto-release.json`);
  if (!response.ok) {
    throw new Error(`Failed to load release manifest: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as ReleaseManifest;
}

function getReleasesPageUrl(): string {
  return 'https://github.com/covenant-gov/pacto-app/releases';
}

function getBestAsset(assets: ReleaseAsset[], filePattern: RegExp | null, arch: string | null): ReleaseAsset | null {
  if (!filePattern) return null;
  const matches = assets.filter((a) => filePattern.test(a.name));
  if (arch && matches.some((a) => a.arch === arch)) {
    return matches.find((a) => a.arch === arch) || null;
  }
  return matches[0] || null;
}

function setDownloadButton(manifest: ReleaseManifest, platform: Platform, arch: string | null, buttonText: string, filePattern: RegExp | null) {
  const btn = document.getElementById('downloadBtn');
  const text = document.getElementById('downloadText');
  if (!btn || !text) return;

  text.textContent = buttonText;

  if (platform === 'ios') {
    (btn as HTMLAnchorElement).href = '#';
    btn.style.cursor = 'default';
    btn.style.pointerEvents = 'none';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      return false;
    });
    return;
  }

  const iconKey = platform === 'macos' ? 'macOS' : platform === 'windows' ? 'Windows' : 'Linux';
  const svgHtml = osIcons[iconKey] || osIcons.Linux;
  if (platform !== 'other') {
    const icon = document.createElement('div');
    icon.className = 'os-icon';
    icon.innerHTML = svgHtml;
    btn.insertBefore(icon, text);
  }

  const best = getBestAsset(manifest.assets, filePattern, arch);
  if (best) {
    (btn as HTMLAnchorElement).href = best.url;
  } else {
    (btn as HTMLAnchorElement).href = manifest.releaseUrl || getReleasesPageUrl();
  }
}

function simplifyFilename(name: string): { platform: string; variant: string | null } {
  const arch = name.includes('aarch64') || name.includes('arm64')
    ? 'ARM64'
    : name.includes('x86_64') || name.includes('x64') || name.includes('amd64')
      ? 'x64'
      : name.includes('i686') || name.includes('i386') || name.includes('x86')
        ? 'x86'
        : null;

  if (name.includes('.exe')) return { platform: 'Windows', variant: arch ? `${arch} Installer` : 'Installer' };
  if (name.includes('.msi')) return { platform: 'Windows', variant: arch ? `${arch} MSI` : 'MSI' };
  if (name.includes('.dmg')) return { platform: 'macOS', variant: arch };
  if (name.includes('.AppImage')) return { platform: 'Linux', variant: arch ? `AppImage ${arch}` : 'AppImage' };
  if (name.includes('.deb')) return { platform: 'Linux', variant: arch ? `Debian ${arch}` : 'Debian' };
  if (name.includes('.rpm')) return { platform: 'Linux', variant: arch ? `RPM ${arch}` : 'RPM' };
  if (name.includes('.tar.gz') || name.includes('.tgz')) return { platform: 'Linux', variant: arch ? `Archive ${arch}` : 'Archive' };
  return { platform: name, variant: null };
}

function getDisplayPlatform(name: string): string {
  if (name.includes('.exe') || name.includes('.msi')) return 'Windows';
  if (name.includes('.dmg')) return 'macOS';
  return 'Linux';
}

function createOSIconElement(platformName: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'os-icon';
  const key = platformName === 'Mac Silicon' || platformName === 'Mac Intel' ? 'macOS' : platformName;
  el.innerHTML = osIcons[key] || osIcons.Linux;
  return el;
}

function sortAssets(assets: ReleaseAsset[], detected: Platform): ReleaseAsset[] {
  const copy = [...assets];
  copy.sort((a, b) => {
    const score = (name: string) => {
      const isWindows = name.includes('.exe') || name.includes('.msi');
      const isMac = name.includes('.dmg');
      const isLinux = !isWindows && !isMac;

      if (detected === 'windows' && isWindows) return name.includes('.exe') ? 1 : 2;
      if ((detected === 'macos' && isMac) || (detected === 'linux' && isLinux)) return 1;

      return name.includes('.exe') ? 10
        : name.includes('.msi') ? 11
        : name.includes('.dmg') ? 20
        : 40;
    };
    const sa = score(a.name);
    const sb = score(b.name);
    return sa !== sb ? sa - sb : a.name.localeCompare(b.name);
  });
  return copy;
}

function populateAllDownloads(manifest: ReleaseManifest, detected: Platform) {
  const list = document.getElementById('downloadsList');
  if (!list) return;

  const assets = manifest.assets.filter(
    (a) => !(a.name.endsWith('.sig') || a.name.endsWith('.txt') || a.name.endsWith('.json'))
  );

  if (assets.length === 0) {
    const empty = document.createElement('p');
    empty.style.color = '#9ea2c1';
    empty.style.textAlign = 'center';
    empty.textContent = 'No downloads available';
    list.appendChild(empty);
    return;
  }

  for (const asset of sortAssets(assets, detected)) {
    const item = document.createElement('div');
    item.className = 'download-item';

    const nameEl = document.createElement('div');
    nameEl.className = 'download-name';

    const icon = createOSIconElement(getDisplayPlatform(asset.name));
    const nameText = document.createElement('div');
    nameText.className = 'download-name-text';

    const { platform, variant } = simplifyFilename(asset.name);
    const platformSpan = document.createElement('span');
    platformSpan.className = 'download-name-platform';
    platformSpan.textContent = platform;
    nameText.appendChild(platformSpan);

    if (variant) {
      const variantSpan = document.createElement('span');
      variantSpan.className = 'download-name-variant';
      variantSpan.textContent = variant;
      nameText.appendChild(variantSpan);
    }

    nameEl.appendChild(icon);
    nameEl.appendChild(nameText);

    const links = document.createElement('div');
    links.className = 'download-links';

    const downloadLink = document.createElement('a');
    downloadLink.href = asset.url;
    downloadLink.className = 'download-link';
    downloadLink.textContent = 'Download';
    downloadLink.target = '_blank';
    downloadLink.rel = 'noopener noreferrer';
    links.appendChild(downloadLink);

    if (asset.signatureUrl) {
      const sigLink = document.createElement('a');
      sigLink.href = asset.signatureUrl;
      sigLink.className = 'download-link sig';
      sigLink.textContent = '.sig';
      sigLink.target = '_blank';
      sigLink.rel = 'noopener noreferrer';
      links.appendChild(sigLink);
    }

    item.appendChild(nameEl);
    item.appendChild(links);
    list.appendChild(item);
  }
}

// Tagline animation
function createCharSpans(word: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const char of word.split('')) {
    const span = document.createElement('span');
    span.className = 'tagline-char';
    span.textContent = char;
    frag.appendChild(span);
  }
  return frag;
}

async function fadeOutChars(): Promise<void> {
  const dynamicEl = document.getElementById('taglineDynamic');
  if (!dynamicEl) return;
  const chars = dynamicEl.querySelectorAll('.tagline-char');
  for (let i = chars.length - 1; i >= 0; i--) {
    chars[i].classList.add('fade-out');
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function fadeInChars(word: string): Promise<void> {
  const dynamicEl = document.getElementById('taglineDynamic');
  if (!dynamicEl) return;
  dynamicEl.innerHTML = '';
  const spans = createCharSpans(word);
  dynamicEl.appendChild(spans);
  const chars = dynamicEl.querySelectorAll('.tagline-char');
  for (let i = 0; i < chars.length; i++) {
    chars[i].classList.add('fade-in');
    (chars[i] as HTMLElement).style.animationDelay = `${0.08 * i}s`;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
}

async function rotateTagline(): Promise<void> {
  let currentIndex = 0;
  const dynamicEl = document.getElementById('taglineDynamic');
  if (!dynamicEl) return;

  await fadeInChars(taglineWords[0]);

  let isAnimating = false;
  setInterval(async () => {
    if (isAnimating) return;
    isAnimating = true;
    await fadeOutChars();
    currentIndex = (currentIndex + 1) % taglineWords.length;
    await fadeInChars(taglineWords[currentIndex]);
    isAnimating = false;
  }, 3000);
}

async function init(): Promise<void> {
  const toggleBtn = document.getElementById('toggleDownloads');
  const downloadsList = document.getElementById('downloadsList');
  const platformNote = document.getElementById('platformNote');
  const downloadBtn = document.getElementById('downloadBtn');

  void rotateTagline();

  if (!toggleBtn || !downloadsList) return;

  try {
    const manifest = await loadManifest();
    const { platform, arch, buttonText, filePattern } = detectPlatform();

    setDownloadButton(manifest, platform, arch, buttonText, filePattern);

    if (platformNote) {
      platformNote.textContent = 'Available for Windows, macOS & Linux';
    }

    let isOpen = false;
    toggleBtn.addEventListener('click', () => {
      isOpen = !isOpen;
      downloadsList.classList.toggle('open', isOpen);
      toggleBtn.textContent = isOpen ? 'Hide all downloads' : 'Show All Downloads';
      if (isOpen && downloadsList.children.length === 0) {
        populateAllDownloads(manifest, platform);
      }
    });
  } catch (error) {
    console.error('Failed to load release manifest:', error);
    if (downloadBtn) {
      (downloadBtn as HTMLAnchorElement).href = getReleasesPageUrl();
    }
    if (platformNote) {
      platformNote.textContent = 'Release data unavailable. View all releases on GitHub.';
    }
    toggleBtn.disabled = true;
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    void init();
  }
}

export { detectPlatform, loadManifest, simplifyFilename, getDisplayPlatform };
