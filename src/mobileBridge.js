import { Capacitor, registerPlugin } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

const NativeCast = registerPlugin('MusicComplexCast');
const NativeAuto = registerPlugin('MusicComplexAuto');
const NativePlayer = registerPlugin('MusicComplexPlayer');

const PLEX_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'X-Plex-Product': 'Music Complex',
  'X-Plex-Client-Identifier': 'music-complex-mobile',
  'X-Plex-Platform': 'Android',
  'X-Plex-Device': 'Mobile',
  'X-Plex-Version': '1.0.0',
};

function decodeXmlValue(value = '') {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function parseXmlAttributes(tag = '') {
  const attributes = {};
  const pattern = /([A-Za-z0-9_:-]+)="([^"]*)"/g;
  let match = pattern.exec(tag);
  while (match) {
    attributes[match[1]] = decodeXmlValue(match[2]);
    match = pattern.exec(tag);
  }
  return attributes;
}

function parsePlexResourcesXml(xml = '') {
  const resources = [];
  const resourcePattern = /<Device\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Device>)/gi;
  let match = resourcePattern.exec(xml);
  while (match) {
    const resource = parseXmlAttributes(match[1]);
    const body = match[2] || '';
    resource.Connection = [];
    const connectionPattern = /<Connection\b([^>]*?)\/?>/gi;
    let connectionMatch = connectionPattern.exec(body);
    while (connectionMatch) {
      resource.Connection.push(parseXmlAttributes(connectionMatch[1]));
      connectionMatch = connectionPattern.exec(body);
    }
    resources.push(resource);
    match = resourcePattern.exec(xml);
  }
  return resources;
}

function parsePlexServersXml(xml = '') {
  const servers = [];
  const serverPattern = /<Server\b([^>]*?)\/?>/gi;
  let match = serverPattern.exec(xml);
  while (match) {
    servers.push(parseXmlAttributes(match[1]));
    match = serverPattern.exec(xml);
  }
  return servers;
}

async function plexTvTextRequest(path, options = {}) {
  const response = await fetch(`https://plex.tv${path}`, {
    ...options,
    headers: {
      ...PLEX_HEADERS,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Plex returned ${response.status} for ${path}`);
  }

  return response.text();
}

async function plexTvJsonRequest(path, options = {}) {
  const text = await plexTvTextRequest(path, options);
  if (!text) return {};
  return JSON.parse(text);
}

function plexBoolean(value) {
  return value === true || value === '1' || value === 'true';
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function looksLikePlexServer(resource) {
  const provides = String(resource.provides || '').toLowerCase();
  const product = String(resource.product || '').toLowerCase();
  return provides.includes('server') || product.includes('plex media server');
}

function normalizeResource(resource) {
  const connections = asArray(resource.Connection || resource.connections).map((connection) => ({
    address: connection.address || '',
    port: connection.port || '',
    protocol: connection.protocol || '',
    uri: connection.uri || '',
    local: plexBoolean(connection.local),
    relay: plexBoolean(connection.relay),
  }));
  const preferred = connections.find((connection) => connection.local && !connection.relay && connection.uri)
    || connections.find((connection) => connection.uri)
    || {};

  return {
    id: resource.clientIdentifier || resource.machineIdentifier || resource.name || resource.friendlyName,
    name: resource.name || resource.friendlyName || 'Plex Server',
    product: resource.product || 'Plex Media Server',
    provides: resource.provides || 'server',
    owned: plexBoolean(resource.owned),
    accessToken: resource.accessToken || resource.token || '',
    uri: preferred.uri || resource.uri || '',
    connections,
  };
}

function uniqueResources(resources) {
  const byId = new Map();
  resources.forEach((resource) => {
    const id = resource.id || resource.name || resource.uri;
    if (!id) return;
    const existing = byId.get(id);
    if (!existing || (!existing.connections?.length && resource.connections?.length)) {
      byId.set(id, resource);
    }
  });
  return [...byId.values()];
}

function parsePlexResourceDevices(text = '') {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('<')) return parsePlexResourcesXml(trimmed);
  const parsed = JSON.parse(trimmed);
  return asArray(parsed.MediaContainer?.Device || parsed.Device || parsed.devices || parsed);
}

async function resources(token) {
  if (!token) throw new Error('Missing Plex account token.');
  const params = new URLSearchParams({
    includeHttps: '1',
    includeRelay: '1',
    'X-Plex-Token': token,
  });

  const resourcesText = await plexTvTextRequest(`/api/resources?${params.toString()}`, {
    headers: {
      Accept: 'application/json,application/xml,text/xml,*/*',
      'X-Plex-Token': token,
    },
  });
  const devices = parsePlexResourceDevices(resourcesText);
  const resourcesFromDevices = devices
    .filter((resource) => looksLikePlexServer(resource) && (resource.accessToken || resource.token))
    .map(normalizeResource)
    .filter((resource) => resource.uri);

  let fallbackServers = [];
  if (!resourcesFromDevices.length) {
    const serverXml = await plexTvTextRequest(`/pms/servers?X-Plex-Token=${encodeURIComponent(token)}`, {
      headers: {
        Accept: 'application/xml,text/xml,*/*',
        'X-Plex-Token': token,
      },
    });
    fallbackServers = parsePlexServersXml(serverXml)
      .filter((server) => server.accessToken || server.token)
      .map(normalizeResource)
      .filter((server) => server.uri);
  }

  return {
    resources: uniqueResources([...resourcesFromDevices, ...fallbackServers]),
    diagnostics: {
      devices: devices.length,
      resourceServers: resourcesFromDevices.length,
      fallbackServers: fallbackServers.length,
    },
  };
}

async function createPin() {
  const pin = await plexTvJsonRequest('/api/v2/pins?strong=true', { method: 'POST' });
  const params = new URLSearchParams({
    clientID: PLEX_HEADERS['X-Plex-Client-Identifier'],
    code: pin.code,
    'context[device][product]': PLEX_HEADERS['X-Plex-Product'],
  });
  const url = `https://app.plex.tv/auth#?${params.toString()}`;
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  return { id: pin.id, code: pin.code, url };
}

async function pollPin(id) {
  const pin = await plexTvJsonRequest(`/api/v2/pins/${id}`);
  return { token: pin.authToken || null };
}

function createCastBridge() {
  if (!Capacitor.isNativePlatform()) {
    return {
      list: async () => ({
        supported: false,
        devices: [],
      }),
      rescan: async () => ({
        supported: false,
        devices: [],
      }),
      connect: async () => {
        throw new Error('Chromecast support needs the Android Cast bridge.');
      },
      play: async () => {
        throw new Error('Chromecast support needs the Android Cast bridge.');
      },
      control: async () => {
        throw new Error('Chromecast support needs the Android Cast bridge.');
      },
      disconnect: async () => ({ ok: true }),
      status: async () => {
        throw new Error('No active cast device.');
      },
      onDevices: () => () => {},
      onVolume: () => () => {},
    };
  }

  return {
    list: () => NativeCast.list(),
    rescan: () => NativeCast.rescan(),
    connect: (payload) => NativeCast.connect(payload),
    play: (payload) => NativeCast.play(payload),
    control: (action, value) => NativeCast.control({ action, value }),
    disconnect: () => NativeCast.disconnect(),
    status: () => NativeCast.status(),
    onDevices: (callback) => {
      let listener;
      NativeCast.addListener('devices', (event) => callback(event.devices || []))
        .then((handle) => {
          listener = handle;
        });
      return () => listener?.remove();
    },
    onVolume: (callback) => {
      let listener;
      NativeCast.addListener('volume', (event) => callback(event))
        .then((handle) => {
          listener = handle;
        });
      return () => listener?.remove();
    },
  };
}

function createAutoBridge() {
  if (!Capacitor.isNativePlatform()) {
    return {
      update: async () => ({ ok: true }),
      catalog: async () => ({ ok: true }),
      onTransport: () => () => {},
    };
  }

  return {
    update: (payload) => NativeAuto.update(payload),
    catalog: (payload) => NativeAuto.catalog(payload),
    onTransport: (callback) => {
      let listener;
      NativeAuto.addListener('transport', (event) => callback(event))
        .then((handle) => {
          listener = handle;
        });
      return () => listener?.remove();
    },
  };
}

function createNativePlayerBridge() {
  if (!Capacitor.isNativePlatform()) {
    return {
      supported: false,
      play: async () => ({ ok: false }),
      pause: async () => ({ ok: false }),
      resume: async () => ({ ok: false }),
      seek: async () => ({ ok: false }),
      stop: async () => ({ ok: false }),
      status: async () => ({ supported: false }),
      volume: async () => ({ ok: false }),
      matchVolume: async () => ({ ok: false }),
      onEvent: () => () => {},
    };
  }

  return {
    supported: true,
    play: (payload) => NativePlayer.play(payload),
    pause: () => NativePlayer.pause(),
    resume: () => NativePlayer.resume(),
    seek: (position) => NativePlayer.seek({ position }),
    stop: () => NativePlayer.stop(),
    status: () => NativePlayer.status(),
    volume: (value) => NativePlayer.volume({ value }),
    matchVolume: (enabled) => NativePlayer.matchVolume({ enabled }),
    onEvent: (callback) => {
      let listener;
      NativePlayer.addListener('player', (event) => callback(event))
        .then((handle) => {
          listener = handle;
        });
      return () => listener?.remove();
    },
  };
}

export function installMobileBridge() {
  if (window.moonbounce) return;

  window.moonbounce = {
    cast: createCastBridge(),
    auto: createAutoBridge(),
    nativePlayer: createNativePlayerBridge(),
    systemVolume: {
      get: async () => ({ volume: 80 }),
      set: async (value) => ({ ok: true, volume: Math.round(Number(value) * 100) }),
    },
    plexAuth: {
      createPin,
      pollPin,
      resources,
    },
    log: {
      write: async (event, payload) => {
        if (import.meta.env.DEV) console.debug('[Music Complex]', event, payload);
        return { ok: true };
      },
      path: async () => '',
    },
  };
}
