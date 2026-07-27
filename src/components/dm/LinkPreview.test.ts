// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import LinkPreview from './LinkPreview.svelte';
import type { PreviewMetadata } from '../../stores/dm';

const baseMetadata: PreviewMetadata = {
  domain: 'example.com',
  og_title: 'Example',
  og_url: 'https://example.com',
};

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
});
