type Platform = 'macos' | 'windows' | 'linux' | 'android' | 'ios' | 'other';

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
  Android:
    '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path fill="#8A5CFF" d="M31.69,24.5h0c-.01-.07-.02-.13-.03-.19-.07-.4-.15-.79-.24-1.17-.17-.67-.37-1.33-.62-1.97-.21-.54-.45-1.07-.71-1.58-.34-.65-.73-1.28-1.15-1.88-.52-.73-1.1-1.42-1.74-2.05-.27-.27-.54-.52-.83-.77-.62-.53-1.28-1.02-1.97-1.45,0-.01.01-.02.02-.03.32-.55.64-1.1.96-1.65.31-.54.62-1.07.93-1.61.22-.39.45-.77.67-1.16.05-.09.09-.19.13-.28.09-.27.09-.55.02-.82-.02-.07-.04-.13-.07-.19-.03-.06-.06-.12-.09-.18-.12-.2-.29-.37-.5-.5-.19-.11-.4-.18-.62-.2-.09,0-.18,0-.27,0-.08,0-.15.02-.22.04-.26.07-.51.21-.7.42-.07.08-.13.16-.18.25-.22.39-.45.77-.67,1.16l-.93,1.61c-.32.55-.64,1.1-.96,1.65-.03.06-.07.12-.1.18-.05-.02-.1-.04-.14-.06-1.76-.67-3.66-1.04-5.65-1.04-.05,0-.11,0-.16,0-1.77.03-3.51.41-5.19,1.1-.03.01-.07.03-.1.04-.32-.55-.64-1.1-.96-1.65l-.93-1.61c-.22-.39-.45-.77-.67-1.16-.05-.09-.1-.18-.16-.27-.18-.21-.43-.35-.7-.42-.07-.02-.14-.04-.22-.04-.09,0-.18,0-.27,0-.22.02-.43.09-.62.2-.21.13-.38.3-.5.5-.03.06-.06.12-.09.18-.03.06-.05.12-.07.19-.07.27-.07.55.02.82.04.09.08.19.13.28.22.39.45.77.67,1.16.31.54.62,1.07.93,1.61.32.55.64,1.1.96,1.65.01.01.02.02.02.03-.69.43-1.35.92-1.97,1.45-.29.25-.56.5-.83.77-.64.63-1.22,1.32-1.74,2.05-.42.6-.81,1.23-1.15,1.88-.26.51-.5,1.04-.71,1.58-.25.64-.45,1.3-.62,1.97-.09.38-.17.77-.24,1.17-.01.06-.02.12-.03.19h0c-.12.68-.18,1.37-.18,2.07v4.43c0,1.1.89,1.99,1.99,1.99s1.99-.89,1.99-1.99v-4.43c0-.47.04-.93.12-1.38.03-.18.07-.36.11-.54.08-.35.17-.69.28-1.02.04-.12.08-.23.13-.35.35-.91.82-1.76,1.39-2.53.23-.31.47-.61.73-.89.5-.55,1.06-1.05,1.67-1.49.33-.24.68-.47,1.04-.68,1.09-.63,2.27-1.11,3.51-1.41.43-.11.87-.19,1.31-.25.87-.12,1.77-.18,2.69-.18h.08c.92,0,1.82.06,2.69.18.44.06.88.14,1.31.25,1.24.3,2.42.78,3.51,1.41.36.21.71.44,1.04.68.61.44,1.17.94,1.67,1.49.26.28.5.58.73.89.57.77,1.04,1.62,1.39,2.53.05.12.09.23.13.35.11.33.2.67.28,1.02.04.18.08.36.11.54.08.45.12.91.12,1.38v4.43c0,1.1.89,1.99,1.99,1.99s1.99-.89,1.99-1.99v-4.43C31.87,25.87,31.81,25.18,31.69,24.5zM8.55,6.27c-.05-.26-.03-.53.06-.78.09-.25.25-.47.46-.64.42-.34.98-.46,1.51-.32.52.14.95.51,1.17,1,.22.49.24,1.05.05,1.55-.19.5-.57.9-1.05,1.11-.48.21-1.02.21-1.51,0-.49-.21-.87-.61-1.05-1.11C8.58,6.8,8.55,6.53,8.55,6.27zM24.94,7.69c-.19.5-.57.9-1.05,1.11-.48.21-1.02.21-1.51,0-.49-.21-.87-.61-1.05-1.11-.19-.5-.17-1.06.05-1.55.22-.49.65-.86,1.17-1,.52-.14,1.08-.02,1.51.32.21.17.37.39.46.64.09.25.11.52.06.78C25.11,6.53,25.08,6.8,24.94,7.69zM18.63,3.88c-.74-2.18-2.55-3.64-4.63-3.64s-3.89,1.46-4.63,3.64c-.14.41.08.86.49,1 .41.14.86-.08,1-.49.49-1.44,1.66-2.39,3.14-2.39s2.65.95,3.14,2.39c.14.41.59.63,1,.49.41-.14.63-.59.49-1H18.63z"/></svg>',
};

function detectPlatform(): { platform: Platform; buttonText: string; filePattern: RegExp | null } {
  const ua = (navigator.userAgent || '').toLowerCase();
  const platform = (navigator.platform || '').toLowerCase();

  if (platform.includes('mac')) {
    return { platform: 'macos', buttonText: 'Download for macOS', filePattern: /\.dmg$/i };
  }
  if (platform.includes('win')) {
    return { platform: 'windows', buttonText: 'Download for Windows', filePattern: /\.(exe|msi)$/i };
  }
  if (ua.includes('android') || platform.includes('android')) {
    return { platform: 'android', buttonText: 'Download for Android', filePattern: /\.apk$/i };
  }
  if (
    platform.includes('iphone') ||
    platform.includes('ipad') ||
    platform.includes('ipod') ||
    (ua.includes('mac') && 'ontouchend' in document)
  ) {
    return { platform: 'ios', buttonText: 'Coming Soon', filePattern: null };
  }
  if (platform.includes('linux') || platform.includes('x11')) {
    return { platform: 'linux', buttonText: 'Download for Linux', filePattern: /\.(AppImage|deb|rpm|tar\.gz|tgz)$/i };
  }
  return { platform: 'other', buttonText: 'Download Pacto', filePattern: null };
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

function getBestAsset(assets: ReleaseAsset[], filePattern: RegExp | null): ReleaseAsset | null {
  if (!filePattern) return null;
  return assets.find((a) => filePattern.test(a.name)) || null;
}

function setDownloadButton(manifest: ReleaseManifest, platform: Platform, buttonText: string, filePattern: RegExp | null) {
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

  const iconKey = platform === 'macos' ? 'macOS' : platform === 'windows' ? 'Windows' : platform === 'android' ? 'Android' : 'Linux';
  const svgHtml = osIcons[iconKey] || osIcons.Linux;
  if (platform !== 'other') {
    const icon = document.createElement('div');
    icon.className = 'os-icon';
    icon.innerHTML = svgHtml;
    btn.insertBefore(icon, text);
  }

  const best = getBestAsset(manifest.assets, filePattern);
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
  if (name.includes('.apk')) return { platform: 'Android', variant: arch };
  if (name.includes('.dmg')) return { platform: 'macOS', variant: arch };
  if (name.includes('.AppImage')) return { platform: 'Linux', variant: arch ? `AppImage ${arch}` : 'AppImage' };
  if (name.includes('.deb')) return { platform: 'Linux', variant: arch ? `Debian ${arch}` : 'Debian' };
  if (name.includes('.rpm')) return { platform: 'Linux', variant: arch ? `RPM ${arch}` : 'RPM' };
  if (name.includes('.tar.gz') || name.includes('.tgz')) return { platform: 'Linux', variant: arch ? `Archive ${arch}` : 'Archive' };
  return { platform: name, variant: null };
}

function getDisplayPlatform(name: string): string {
  if (name.includes('.exe') || name.includes('.msi')) return 'Windows';
  if (name.includes('.apk')) return 'Android';
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
      const isAndroid = name.includes('.apk');
      const isLinux = !isWindows && !isMac && !isAndroid;

      if (detected === 'windows' && isWindows) return name.includes('.exe') ? 1 : 2;
      if ((detected === 'macos' && isMac) || (detected === 'android' && isAndroid) || (detected === 'linux' && isLinux)) return 1;

      return name.includes('.exe') ? 10
        : name.includes('.msi') ? 11
        : name.includes('.dmg') ? 20
        : name.includes('.apk') ? 30
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
    const { platform, buttonText, filePattern } = detectPlatform();

    setDownloadButton(manifest, platform, buttonText, filePattern);

    if (platformNote) {
      platformNote.textContent = 'Available for Windows, macOS, Linux & Android';
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
