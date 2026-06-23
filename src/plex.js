const PLEX_HEADERS = {
  Accept: 'application/json',
  'X-Plex-Product': 'Music Complex',
  'X-Plex-Client-Identifier': 'music-complex-mobile',
  'X-Plex-Platform': 'Android',
};

export function normalizeServerUrl(url) {
  return url.trim().replace(/\/+$/, '');
}

export function withPlexToken(url, token) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}X-Plex-Token=${encodeURIComponent(token)}`;
}

export function plexImageUrl(serverUrl, token, path, { width = 360, height = 360 } = {}) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  const base = normalizeServerUrl(serverUrl);
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    minSize: '1',
    upscale: '1',
    url: path,
    'X-Plex-Token': token,
  });
  return `${base}/photo/:/transcode?${params.toString()}`;
}

export function trackStreamUrl(serverUrl, token, track) {
  const part = track?.Media?.[0]?.Part?.[0];
  const key = part?.key || track?.key;
  if (!key) return '';
  return withPlexToken(`${normalizeServerUrl(serverUrl)}${key}`, token);
}

export function trackMimeType(track) {
  const part = track?.Media?.[0]?.Part?.[0];
  const container = part?.container || track?.Media?.[0]?.container || 'mpeg';
  if (container === 'flac') return 'audio/flac';
  if (container === 'm4a' || container === 'mp4') return 'audio/mp4';
  if (container === 'ogg') return 'audio/ogg';
  if (container === 'wav') return 'audio/wav';
  return 'audio/mpeg';
}

export function durationLabel(ms = 0) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function yearFrom(item) {
  return item?.year || item?.originallyAvailableAt?.slice(0, 4) || '';
}

function metadataKey(itemOrKey) {
  if (!itemOrKey) return '';
  if (typeof itemOrKey === 'string') return itemOrKey;
  return itemOrKey.key || (itemOrKey.ratingKey ? `/library/metadata/${itemOrKey.ratingKey}` : '');
}

function childrenPath(itemOrKey) {
  const key = metadataKey(itemOrKey);
  if (!key) return '';
  return key.endsWith('/children') ? key : `${key}/children`;
}

function playlistIdentity(playlist) {
  return String(playlist?.title || playlist?.titleSort || '')
    .trim()
    .toLowerCase();
}

function playlistScore(playlist) {
  const leafCount = Number(playlist?.leafCount || 0);
  const hasPlayableItems = leafCount > 0 ? 1000 : 0;
  const hasKey = playlist?.ratingKey || playlist?.key ? 100 : 0;
  const isSmart = playlist?.smart === true || playlist?.smart === '1' ? 0 : 10;
  return hasPlayableItems + hasKey + isSmart + leafCount;
}

function dedupePlaylists(playlists = []) {
  const byTitle = new Map();

  playlists.forEach((playlist) => {
    const identity = playlistIdentity(playlist);
    if (!identity) return;
    const existing = byTitle.get(identity);
    if (!existing || playlistScore(playlist) > playlistScore(existing)) {
      byTitle.set(identity, playlist);
    }
  });

  return [...byTitle.values()];
}

export function createPlexClient({ serverUrl, token, timeoutMs = 15000 }) {
  const base = normalizeServerUrl(serverUrl);
  let cachedServerInfo = null;

  async function request(path, options = {}) {
    const url = withPlexToken(`${base}${path}`, token);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs || timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers: PLEX_HEADERS,
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Timed out reaching Plex at ${base}`);
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Plex returned ${response.status} for ${path}`);
    }
    const text = await response.text();
    if (!text) return {};
    const data = JSON.parse(text);
    return data.MediaContainer;
  }

  async function serverInfo() {
    if (cachedServerInfo) return cachedServerInfo;
    cachedServerInfo = await request('/');
    return cachedServerInfo;
  }

  return {
    serverInfo,
    async libraries() {
      const container = await request('/library/sections');
      return (container.Directory || []).filter((section) => section.type === 'artist');
    },
    async artists(sectionKey) {
      const container = await request(`/library/sections/${sectionKey}/all?type=8&sort=titleSort`);
      return container.Metadata || [];
    },
    async playlists() {
      const container = await request('/playlists?playlistType=audio');
      return dedupePlaylists(container.Metadata || []);
    },
    async albums(sectionKey, artistKey) {
      const path = artistKey
        ? childrenPath(artistKey)
        : `/library/sections/${sectionKey}/all?type=9&sort=year:desc,titleSort`;
      const container = await request(path);
      return container.Metadata || [];
    },
    async tracks(sectionKey, albumKey) {
      const path = albumKey
        ? childrenPath(albumKey)
        : `/library/sections/${sectionKey}/all?type=10&sort=titleSort`;
      const container = await request(path);
      return container.Metadata || [];
    },
    async playlistTracks(playlist) {
      const container = await request(metadataKey(playlist));
      return container.Metadata || [];
    },
    async addTrackToPlaylist(playlist, track) {
      const playlistId = playlist?.ratingKey;
      const trackId = track?.ratingKey;
      if (!playlistId || !trackId) throw new Error('Missing playlist or track id.');

      const info = await serverInfo();
      const machineIdentifier = info.machineIdentifier;
      if (!machineIdentifier) throw new Error('Plex server did not report a machine identifier.');

      const uri = `server://${machineIdentifier}/com.plexapp.plugins.library/library/metadata/${trackId}`;
      await request(`/playlists/${playlistId}/items?uri=${encodeURIComponent(uri)}`, { method: 'PUT' });
      return { ok: true };
    },
    async search(query) {
      if (!query.trim()) return [];
      const container = await request(`/search?query=${encodeURIComponent(query.trim())}`);
      return (container.Metadata || []).filter((item) => item.type === 'track');
    },
  };
}
