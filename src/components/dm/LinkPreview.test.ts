// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { convertFileSrc } from '@tauri-apps/api/core';
import LinkPreview from './LinkPreview.svelte';
import { torRoutingEnabled } from '../../stores/tor';
import type { PreviewMetadata } from '../../stores/dm';

vi.mock('@tauri-apps/api/core');

const mockedConvertFileSrc = vi.mocked(convertFileSrc);

const baseMetadata: PreviewMetadata = {
  domain: 'example.com',
  og_title: 'Example',
  og_url: 'https://example.com',
};

afterEach(() => {
  torRoutingEnabled.set(false);
  vi.unstubAllGlobals();
  mockedConvertFileSrc.mockReset();
});

describe('LinkPreview', () => {
  it('renders og_image when it is an http(s) URL', () => {
    const { container } = render(LinkPreview, {
      props: { metadata: { ...baseMetadata, og_image: 'https://example.com/x.png' } },
    });
    const img = container.querySelector('img.link-preview-image');
    expect(img?.getAttribute('src')).toBe('https://example.com/x.png');
  });

  it('suppresses og_image with a javascript: scheme', () => {
    const { container } = render(LinkPreview, {
      props: { metadata: { ...baseMetadata, og_image: 'javascript:alert(1)' } },
    });
    expect(container.querySelector('img.link-preview-image')).toBeNull();
  });

  it('suppresses og_image with a file: scheme', () => {
    const { container } = render(LinkPreview, {
      props: { metadata: { ...baseMetadata, og_image: 'file:///etc/passwd' } },
    });
    expect(container.querySelector('img.link-preview-image')).toBeNull();
  });

  it('renders favicon when it is an http(s) URL', () => {
    const { container } = render(LinkPreview, {
      props: { metadata: { ...baseMetadata, favicon: 'https://example.com/favicon.ico' } },
    });
    const img = container.querySelector('img.link-preview-favicon');
    expect(img?.getAttribute('src')).toBe('https://example.com/favicon.ico');
  });

  it('suppresses favicon with a non-http(s) scheme', () => {
    const { container } = render(LinkPreview, {
      props: { metadata: { ...baseMetadata, favicon: 'javascript:alert(1)' } },
    });
    expect(container.querySelector('img.link-preview-favicon')).toBeNull();
  });

  it('resolves a fresh preview after a broken image on the previous one, once metadata points at a new URL', async () => {
    const metadata: PreviewMetadata = { ...baseMetadata, og_image: 'https://example.com/x.png' };
    const { container, rerender } = render(LinkPreview, { props: { metadata } });

    const img = container.querySelector('img.link-preview-image') as HTMLImageElement;
    await fireEvent.error(img);
    expect(container.querySelector('img.link-preview-image')).toBeNull();

    // A distinct metadata object (a new preview, e.g. a different URL) resolves fresh and shows its own image.
    await rerender({ metadata: { ...baseMetadata, og_image: 'https://example.com/y.png' } });
    const nextImg = container.querySelector('img.link-preview-image') as HTMLImageElement;
    expect(nextImg?.getAttribute('src')).toBe('https://example.com/y.png');
  });

  it('suppresses og_image and favicon while Tor routing is enabled and neither has been cached yet', () => {
    torRoutingEnabled.set(true);
    const { container } = render(LinkPreview, {
      props: {
        metadata: {
          ...baseMetadata,
          og_image: 'https://example.com/x.png',
          favicon: 'https://example.com/favicon.ico',
        },
      },
    });
    expect(container.querySelector('img.link-preview-image')).toBeNull();
    expect(container.querySelector('img.link-preview-favicon')).toBeNull();
  });

  it('renders the cached og_image/favicon paths via convertFileSrc while Tor routing is enabled', () => {
    torRoutingEnabled.set(true);
    vi.stubGlobal('window', { __TAURI__: {} });
    mockedConvertFileSrc.mockImplementation((path: string) => `asset://${path}`);
    const { container } = render(LinkPreview, {
      props: {
        metadata: {
          ...baseMetadata,
          og_image: 'https://example.com/x.png',
          og_image_cached: '/cache/link_preview_images/abc.png',
          favicon: 'https://example.com/favicon.ico',
          favicon_cached: '/cache/link_preview_images/def.ico',
        },
      },
    });
    expect(container.querySelector('img.link-preview-image')?.getAttribute('src')).toBe(
      'asset:///cache/link_preview_images/abc.png'
    );
    expect(container.querySelector('img.link-preview-favicon')?.getAttribute('src')).toBe(
      'asset:///cache/link_preview_images/def.ico'
    );
  });
});
