import { describe, expect, it } from 'vitest';
import {
  normalizeServerUrl,
  plexImageUrl,
  trackStreamUrl,
  withPlexToken,
} from './plex';

describe('Plex URL helpers', () => {
  it('normalizes server urls before appending paths', () => {
    expect(normalizeServerUrl('http://192.168.1.10:32400///')).toBe('http://192.168.1.10:32400');
  });

  it('adds Plex tokens with the correct query separator', () => {
    expect(withPlexToken('http://plex.local/library', 'a b&c')).toBe('http://plex.local/library?X-Plex-Token=a%20b%26c');
    expect(withPlexToken('http://plex.local/library?type=10', 'token')).toBe('http://plex.local/library?type=10&X-Plex-Token=token');
  });

  it('returns absolute artwork urls unchanged', () => {
    expect(plexImageUrl('http://plex.local', 'token', 'https://images.example/cover.jpg'))
      .toBe('https://images.example/cover.jpg');
  });

  it('builds cached square Plex thumbnail transcode urls for relative artwork paths', () => {
    const url = plexImageUrl('http://plex.local///', 'tok en', '/library/metadata/123/thumb/456', {
      width: 260,
      height: 260,
    });

    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe('http://plex.local/photo/:/transcode');
    expect(parsed.searchParams.get('width')).toBe('260');
    expect(parsed.searchParams.get('height')).toBe('260');
    expect(parsed.searchParams.get('minSize')).toBe('1');
    expect(parsed.searchParams.get('upscale')).toBe('1');
    expect(parsed.searchParams.get('url')).toBe('/library/metadata/123/thumb/456');
    expect(parsed.searchParams.get('X-Plex-Token')).toBe('tok en');
  });

  it('builds track stream urls from Plex media parts', () => {
    const track = { Media: [{ Part: [{ key: '/library/parts/99/file.mp3' }] }] };

    expect(trackStreamUrl('http://plex.local/', 'token', track))
      .toBe('http://plex.local/library/parts/99/file.mp3?X-Plex-Token=token');
  });
});
