import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Airplay,
  Album,
  Cast,
  ChevronDown,
  ChevronLeft,
  Disc3,
  ListMusic,
  ListPlus,
  Loader2,
  Pause,
  Plus,
  Play,
  Radio,
  RefreshCcw,
  Repeat,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Star,
  Volume2,
  Wifi,
  X,
} from 'lucide-react';
import {
  createPlexClient,
  durationLabel,
  plexImageUrl,
  trackMimeType,
  trackStreamUrl,
  yearFrom,
} from './plex';
import {
  attachPlayableUrlsToCatalog,
  buildAndroidAutoCatalog,
  chooseAutoPlaybackTarget,
} from './androidAutoCatalog';
import {
  buildPlaybackQueue,
  buildSelectedCollectionQueue,
  inferCastFinished,
  moveQueueItemState,
  nextQueueStep,
  removeQueueItemState,
  shuffleTracks,
  toggleShuffleState,
  trackIdentity,
} from './playbackLogic';
import { installMobileBridge } from './mobileBridge';
import logoMark from './music-complex-logo.png';
import './styles.css';

installMobileBridge();

const STORAGE_KEY = 'moonbounce.settings';
const ALBUM_CACHE_LIMIT = 30;
const TRACK_ROW_HEIGHT = 45;
const TRACK_ROW_OVERSCAN = 8;

function readSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function logEvent(event, payload = {}) {
  window.moonbounce?.log?.write(event, payload).catch(() => {});
}

function artClass(seed = '') {
  const value = [...String(seed)].reduce((total, char) => total + char.charCodeAt(0), 0);
  return `art art-${(value % 6) + 1}`;
}

function App() {
  const initialSettings = useMemo(() => readSettings(), []);
  const [settings, setSettings] = useState(initialSettings);
  const audioRef = useRef(null);
  const plex = useMemo(() => (
    settings.serverUrl && settings.token
      ? createPlexClient({ serverUrl: settings.serverUrl, token: settings.token })
      : null
  ), [settings.serverUrl, settings.token]);

  const [serverUrl, setServerUrl] = useState(initialSettings.serverUrl || '');
  const [token, setToken] = useState(initialSettings.token || '');
  const [plexAccountToken, setPlexAccountToken] = useState(initialSettings.plexAccountToken || '');
  const [plexServers, setPlexServers] = useState([]);
  const [selectedPlexServerId, setSelectedPlexServerId] = useState(initialSettings.plexServerId || '');
  const [connectingPlexServerId, setConnectingPlexServerId] = useState('');
  const [plexLoginCode, setPlexLoginCode] = useState('');
  const [plexLoginPending, setPlexLoginPending] = useState(false);
  const [libraries, setLibraries] = useState([]);
  const [libraryKey, setLibraryKey] = useState(initialSettings.libraryKey || '');
  const [artists, setArtists] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [autoLibraryAlbums, setAutoLibraryAlbums] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [autoLibraryTracks, setAutoLibraryTracks] = useState([]);
  const [autoPlaylistTracksById, setAutoPlaylistTracksById] = useState({});
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [browseMode, setBrowseMode] = useState('artists');
  const [selectedArtist, setSelectedArtist] = useState(null);
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState(initialSettings.theme || 'dark');
  const [matchVolume, setMatchVolume] = useState(Boolean(initialSettings.matchVolume));
  const [status, setStatus] = useState(initialSettings.serverUrl ? 'Ready to tune Plex.' : 'Connect Plex to load music.');
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [volume, setVolume] = useState(0.8);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [castDevices, setCastDevices] = useState([]);
  const [castSupported, setCastSupported] = useState(true);
  const [castStatus, setCastStatus] = useState('Scanning');
  const [castOpen, setCastOpen] = useState(false);
  const [castScanning, setCastScanning] = useState(false);
  const [selectedCastDevice, setSelectedCastDevice] = useState(null);
  const [castPlaying, setCastPlaying] = useState(false);
  const [castLoadedTrackId, setCastLoadedTrackId] = useState('');
  const [castVolumeOverlay, setCastVolumeOverlay] = useState(null);
  const [serverConnectNotice, setServerConnectNotice] = useState('');
  const [queueOpen, setQueueOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playlistPickerTrack, setPlaylistPickerTrack] = useState(null);
  const [addingToPlaylist, setAddingToPlaylist] = useState('');
  const [draggedQueueIndex, setDraggedQueueIndex] = useState(null);
  const [trackScrollTop, setTrackScrollTop] = useState(0);
  const [trackViewportHeight, setTrackViewportHeight] = useState(0);
  const [mobilePanel, setMobilePanel] = useState('list');
  const albumCacheRef = useRef(new Map());
  const albumPrefetchRef = useRef(new Set());
  const artistTrackCacheRef = useRef(new Map());
  const artistTrackLoadRef = useRef('');
  const orderedQueueRef = useRef([]);
  const castAutoAdvanceRef = useRef(false);
  const castStatusPollingRef = useRef(false);
  const castHealthPollingRef = useRef(false);
  const castStatusFailureRef = useRef(0);
  const castLastStatusRef = useRef(null);
  const castVolumeTimerRef = useRef(null);
  const castVolumeOverlayTimerRef = useRef(null);
  const systemVolumeTimerRef = useRef(null);
  const autoTransportRef = useRef(null);
  const autoLastMediaCommandRef = useRef({ mediaId: '', time: 0 });
  const trackListRef = useRef(null);
  const mobileTouchStartRef = useRef(null);
  const queueRef = useRef([]);
  const currentIndexRef = useRef(-1);
  const repeatRef = useRef('off');
  const progressRef = useRef(0);
  const selectedCastDeviceRef = useRef(null);
  const localAdvanceLockRef = useRef(false);
  const audioLevelingRef = useRef(null);
  const currentTrack = currentIndex >= 0 ? queue[currentIndex] : null;
  const connected = Boolean(settings.serverUrl && settings.token && plex);
  const effectiveLibraryKey = libraryKey || settings.libraryKey || '';
  const selectedTrackIsCurrent = selectedTrack && currentTrack && trackIdentity(selectedTrack) === trackIdentity(currentTrack);
  const pendingSelectedTrack = selectedTrack && !selectedTrackIsCurrent ? selectedTrack : null;
  queueRef.current = queue;
  currentIndexRef.current = currentIndex;
  repeatRef.current = repeat;
  progressRef.current = progress;
  selectedCastDeviceRef.current = selectedCastDevice;

  useEffect(() => {
    if (settings.libraryKey && settings.libraryKey !== libraryKey) {
      setLibraryKey(settings.libraryKey);
    }
  }, [settings.libraryKey, libraryKey]);

  function cacheKeyForArtist(artist) {
    return artist?.ratingKey || artist?.key || artist?.title || '';
  }

  function cacheKeyForPlaylist(playlist) {
    return String(playlist?.ratingKey || playlist?.key || playlist?.guid || playlist?.title || '');
  }

  function rememberArtistAlbums(artist, nextAlbums) {
    const key = cacheKeyForArtist(artist);
    if (!key) return;
    const cache = albumCacheRef.current;
    if (cache.has(key)) cache.delete(key);
    cache.set(key, nextAlbums);
    while (cache.size > ALBUM_CACHE_LIMIT) {
      cache.delete(cache.keys().next().value);
    }
  }

  function resetAlbumCache() {
    albumCacheRef.current.clear();
    albumPrefetchRef.current.clear();
    artistTrackCacheRef.current.clear();
    artistTrackLoadRef.current = '';
  }

  function updateTheme(nextTheme) {
    const nextSettings = { ...settings, theme: nextTheme };
    setTheme(nextTheme);
    setSettings(nextSettings);
    writeSettings(nextSettings);
  }

  function updateMatchVolume(enabled) {
    const nextSettings = { ...settings, matchVolume: enabled };
    setMatchVolume(enabled);
    setSettings(nextSettings);
    writeSettings(nextSettings);
    setAudioLevelingEnabled(enabled);
    window.moonbounce?.nativePlayer?.matchVolume?.(enabled).catch(() => {});
  }

  function ensureAudioLeveling() {
    const audio = audioRef.current;
    if (!audio || audioLevelingRef.current || !window.AudioContext) return audioLevelingRef.current;
    const context = new window.AudioContext();
    const source = context.createMediaElementSource(audio);
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.08;
    compressor.release.value = 0.6;
    const makeup = context.createGain();
    makeup.gain.value = 1.25;
    source.connect(compressor);
    compressor.connect(makeup);
    makeup.connect(context.destination);
    audioLevelingRef.current = { context, source, compressor, makeup, enabled: true };
    return audioLevelingRef.current;
  }

  function setAudioLevelingEnabled(enabled) {
    const graph = enabled ? ensureAudioLeveling() : audioLevelingRef.current;
    if (!graph || graph.enabled === enabled) return;
    graph.source.disconnect();
    graph.compressor.disconnect();
    graph.makeup.disconnect();
    if (enabled) {
      graph.source.connect(graph.compressor);
      graph.compressor.connect(graph.makeup);
      graph.makeup.connect(graph.context.destination);
    } else {
      graph.source.connect(graph.context.destination);
    }
    graph.enabled = enabled;
  }

  function logTrackPayload(track, extra = {}) {
    return {
      title: track?.title || '',
      artist: track?.grandparentTitle || track?.parentTitle || '',
      album: track?.parentTitle || '',
      ratingKey: track?.ratingKey || '',
      key: track?.key || '',
      ...extra,
    };
  }

  function localPlaybackPosition() {
    const audioTime = audioRef.current?.currentTime;
    if (Number.isFinite(audioTime) && audioTime > 0) return audioTime;
    return Number.isFinite(progressRef.current) ? progressRef.current : 0;
  }

  function nativePlayerAvailable() {
    return Boolean(window.moonbounce?.nativePlayer?.supported);
  }

  function nativeTrackPayload(track) {
    return {
      url: playableUrl(track),
      title: track?.title || '',
      artist: track?.grandparentTitle || track?.parentTitle || '',
      album: track?.parentTitle || '',
      coverUrl: coverUrl(track),
      duration: Number(track?.duration || 0),
      matchVolume,
    };
  }

  async function stopNativePlayback() {
    if (!nativePlayerAvailable()) return;
    try {
      await window.moonbounce.nativePlayer.stop();
    } catch (error) {
      logEvent('native:stop:error', { message: error.message });
    }
  }

  function clearLoadedLibraryState() {
    audioRef.current?.pause();
    stopNativePlayback();
    setIsPlaying(false);
    setCastPlaying(false);
    setCastLoadedTrackId('');
    setLibraries([]);
    setArtists([]);
    setPlaylists([]);
    resetAlbumCache();
    setAlbums([]);
    setAutoLibraryAlbums([]);
    setTracks([]);
    setAutoLibraryTracks([]);
    setAutoPlaylistTracksById({});
    setQueue([]);
    orderedQueueRef.current = [];
    setCurrentIndex(-1);
    setSelectedArtist(null);
    setSelectedAlbum(null);
    setSelectedPlaylist(null);
    setSelectedTrack(null);
    setProgress(0);
    setDuration(0);
  }

  function replaceQueue(nextQueue, nextIndex = -1) {
    audioRef.current?.pause();
    stopNativePlayback();
    orderedQueueRef.current = nextQueue;
    setQueue(nextQueue);
    setCurrentIndex(nextIndex);
    setShuffle(false);
    setIsPlaying(false);
    setCastPlaying(false);
    setCastLoadedTrackId('');
    setProgress(0);
    setDuration(0);
  }

  function rememberArtistTracks(artist, nextTracks) {
    const key = cacheKeyForArtist(artist);
    if (!key) return;
    const cache = artistTrackCacheRef.current;
    if (cache.has(key)) cache.delete(key);
    cache.set(key, nextTracks);
    while (cache.size > ALBUM_CACHE_LIMIT) {
      cache.delete(cache.keys().next().value);
    }
  }

  function hasSelectedCollection() {
    return Boolean(selectedPlaylist || selectedAlbum || selectedArtist);
  }

  function queueSelectedCollection({ shuffled = shuffle } = {}) {
    if (!tracks.length || !hasSelectedCollection()) return false;
    const nextState = buildSelectedCollectionQueue(tracks, { shuffled });
    orderedQueueRef.current = nextState.orderedQueue;
    setQueue(nextState.queue);
    setCurrentIndex(nextState.currentIndex);
    setSelectedTrack(null);
    setShuffle(nextState.shuffle);
    setStatus(`${heroSelection?.title || 'Selection'} queued.`);
    return true;
  }

  function toggleShuffle() {
    if (!queue.length && hasSelectedCollection()) {
      queueSelectedCollection({ shuffled: !shuffle });
      return;
    }

    if (!queue.length) return;
    const nextState = toggleShuffleState({
      queue,
      currentIndex,
      currentTrack,
      shuffle,
      orderedQueue: orderedQueueRef.current,
    });
    orderedQueueRef.current = nextState.orderedQueue;
    setQueue(nextState.queue);
    setCurrentIndex(nextState.currentIndex);
    setShuffle(nextState.shuffle);
  }

  function cycleRepeat() {
    if (!queue.length && hasSelectedCollection()) {
      queueSelectedCollection();
    }
    setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off');
  }

  function showMobileList(nextMode = browseMode) {
    setBrowseMode(nextMode);
    setMobilePanel('list');
  }

  function goBackMobilePanel() {
    if (mobilePanel === 'tracks') {
      setMobilePanel(browseMode === 'playlists' ? 'list' : 'albums');
      return;
    }
    if (mobilePanel === 'albums') {
      setMobilePanel('list');
    }
  }

  function handleMobileTouchStart(event) {
    const touch = event.touches?.[0];
    if (!touch) return;
    mobileTouchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  }

  function handleMobileTouchEnd(event) {
    const start = mobileTouchStartRef.current;
    const touch = event.changedTouches?.[0];
    mobileTouchStartRef.current = null;
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (deltaX > 70 && Math.abs(deltaY) < 55) {
      goBackMobilePanel();
    }
  }

  useEffect(() => {
    if (!window.moonbounce?.cast) {
      setCastSupported(false);
      setCastStatus('Desktop bridge unavailable');
      return undefined;
    }

    let alive = true;
    window.moonbounce.cast.list().then((result) => {
      if (!alive) return;
      setCastSupported(result.supported);
      setCastDevices(result.devices || []);
      setCastStatus(result.supported ? 'Scanning' : 'Casting unavailable');
    }).catch((error) => setCastStatus(error.message));

    const unsubscribe = window.moonbounce.cast.onDevices((devices) => {
      setCastDevices(devices || []);
      setCastStatus(devices?.length ? 'Devices nearby' : 'Scanning');
    });
    const unsubscribeVolume = window.moonbounce.cast.onVolume?.((event) => {
      const nextVolume = Math.max(0, Math.min(1, Number(event?.volume ?? 0)));
      const activeDevice = selectedCastDeviceRef.current;
      const deviceName = event?.device || activeDevice?.friendlyName || activeDevice?.name || 'Cast device';
      setVolume(nextVolume);
      setCastVolumeOverlay({
        device: deviceName,
        volume: nextVolume,
      });
      if (castVolumeOverlayTimerRef.current) window.clearTimeout(castVolumeOverlayTimerRef.current);
      castVolumeOverlayTimerRef.current = window.setTimeout(() => {
        setCastVolumeOverlay(null);
      }, 1400);
    });

    return () => {
      alive = false;
      unsubscribe?.();
      unsubscribeVolume?.();
      if (castVolumeOverlayTimerRef.current) window.clearTimeout(castVolumeOverlayTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!window.moonbounce?.systemVolume) return;
    window.moonbounce.systemVolume.get()
      .then((result) => {
        if (typeof result?.volume === 'number') setVolume(Math.max(0, Math.min(1, result.volume / 100)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (settingsOpen && plexAccountToken && !plexServers.length) {
      loadPlexServers(plexAccountToken);
    }
  }, [settingsOpen, plexAccountToken]);

  useEffect(() => {
    const discoveryToken = plexAccountToken || settings.plexAccountToken || settings.token;
    if (discoveryToken && !settings.plexServerUrls?.length && !plexServers.length) {
      loadPlexServers(discoveryToken);
    }
  }, [plexAccountToken, settings.plexAccountToken, settings.plexServerUrls, settings.token, plexServers.length]);

  useEffect(() => {
    const selectedServer = plexServers.find((server) => server.id === settings.plexServerId)
      || plexServers.find((server) => plexResourceUrls(server).includes(settings.serverUrl));
    if (!selectedServer) return;
    const nextServerUrls = [
      ...(selectedServer.connections || [])
        .filter((connection) => !connection.local && !connection.relay && connection.uri)
        .map((connection) => connection.uri),
      ...plexResourceUrls(selectedServer),
    ].filter((url, index, values) => url && values.indexOf(url) === index);
    if (!nextServerUrls.length) return;
    const currentServerUrls = settings.plexServerUrls || [];
    if (JSON.stringify(nextServerUrls) === JSON.stringify(currentServerUrls)) return;
    const nextSettings = { ...settings, plexServerUrls: nextServerUrls };
    writeSettings(nextSettings);
    setSettings(nextSettings);
  }, [plexServers, settings]);

  useEffect(() => {
    if (!plex || !settings.libraryKey) return;
    let alive = true;
    setLoading(true);
    setAutoLibraryAlbums([]);
    setAutoLibraryTracks([]);
    setAutoPlaylistTracksById({});
    Promise.all([
      plex.libraries(),
      plex.artists(settings.libraryKey),
      plex.playlists(),
    ]).then(([sections, nextArtists, nextPlaylists]) => {
      if (!alive) return;
      setLibraries(sections);
      setLibraryKey(settings.libraryKey);
      setArtists(nextArtists);
      setPlaylists(nextPlaylists);
      resetAlbumCache();
      setAlbums([]);
      setTracks([]);
      setQueue([]);
      orderedQueueRef.current = [];
      setStatus('Plex library restored.');
    }).catch((error) => {
      if (alive) setStatus(error.message);
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [plex, settings.libraryKey]);

  useEffect(() => {
    if (!plex || !settings.libraryKey) return undefined;
    let alive = true;
    plex.albums(settings.libraryKey)
      .then((nextAlbums) => {
        if (alive) setAutoLibraryAlbums(nextAlbums);
      })
      .catch((error) => {
        if (alive) logEvent('auto:catalog-album-load:error', { message: error.message });
      });
    return () => {
      alive = false;
    };
  }, [plex, settings.libraryKey]);

  useEffect(() => {
    if (!plex || !settings.libraryKey) return undefined;
    let alive = true;
    plex.tracks(settings.libraryKey)
      .then((nextTracks) => {
        if (alive) setAutoLibraryTracks(nextTracks);
      })
      .catch((error) => {
        if (alive) logEvent('auto:catalog-track-load:error', { message: error.message });
      });
    return () => {
      alive = false;
    };
  }, [plex, settings.libraryKey]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    audio.volume = 1;
    const onTime = () => {
      const currentTime = audio.currentTime || 0;
      const audioDuration = audio.duration || 0;
      setProgress(currentTime);
      if (
        audioDuration > 0
        && Number.isFinite(audioDuration)
        && !audio.paused
        && audioDuration - currentTime <= 0.35
        && queueRef.current.length > currentIndexRef.current + 1
        && !localAdvanceLockRef.current
      ) {
        logEvent('audio:near-end-advance', logTrackPayload(queueRef.current[currentIndexRef.current], {
          currentTime,
          duration: audioDuration,
          currentIndex: currentIndexRef.current,
          queueLength: queueRef.current.length,
        }));
        advanceLocalQueueFromEnd();
      }
    };
    const onDuration = () => setDuration(audio.duration || 0);
    const onPlay = () => {
      setIsPlaying(true);
      logEvent('audio:play-event', logTrackPayload(queueRef.current[currentIndexRef.current], {
        currentTime: audio.currentTime || 0,
      }));
    };
    const onPause = () => {
      setIsPlaying(false);
      logEvent('audio:pause-event', logTrackPayload(queueRef.current[currentIndexRef.current], {
        currentTime: audio.currentTime || 0,
        ended: audio.ended,
        readyState: audio.readyState,
      }));
    };
    const onEnded = () => logEvent('audio:ended-event', logTrackPayload(queueRef.current[currentIndexRef.current], {
      currentTime: audio.currentTime || 0,
      duration: audio.duration || 0,
      currentIndex: currentIndexRef.current,
      queueLength: queueRef.current.length,
      paused: audio.paused,
      readyState: audio.readyState,
    }));
    const onError = () => logEvent('audio:error', logTrackPayload(queueRef.current[currentIndexRef.current], {
      code: audio.error?.code,
      message: audio.error?.message,
      currentIndex: currentIndexRef.current,
      queueLength: queueRef.current.length,
    }));
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, []);

  useEffect(() => {
    if (!window.moonbounce?.nativePlayer?.onEvent) return undefined;
    return window.moonbounce.nativePlayer.onEvent((event = {}) => {
      logEvent('native:event', event);
      applyNativePlayerState(event);
    });
  }, []);

  function applyNativePlayerState(statusResult = {}) {
    if (typeof statusResult.index === 'number' && statusResult.index >= 0) {
      setCurrentIndex(statusResult.index);
    }
    if (typeof statusResult.position === 'number') setProgress(statusResult.position);
    if (typeof statusResult.duration === 'number' && Number.isFinite(statusResult.duration)) {
      setDuration(statusResult.duration);
    }
    if (statusResult.event === 'playing' || statusResult.event === 'preparing' || statusResult.playing === true || statusResult.preparing === true) {
      setIsPlaying(true);
      setCastPlaying(false);
      return;
    }
    if (statusResult.event === 'paused' || statusResult.event === 'stopped' || (statusResult.playing === false && statusResult.preparing === false)) {
      setIsPlaying(false);
      return;
    }
    if (statusResult.event === 'queueFinished') {
      setIsPlaying(false);
      setCastPlaying(false);
      setStatus('Queue finished.');
      return;
    }
    if (statusResult.event === 'error') {
      setIsPlaying(false);
      setStatus(statusResult.message || 'Native playback failed.');
    }
  }

  async function syncNativePlayerState(reason = 'manual') {
    if (!nativePlayerAvailable() || selectedCastDeviceRef.current) return;
    try {
      const statusResult = await window.moonbounce.nativePlayer.status();
      logEvent('native:status:sync', { reason, ...statusResult });
      applyNativePlayerState(statusResult);
    } catch (error) {
      logEvent('native:status:sync:error', { reason, message: error.message });
    }
  }

  useEffect(() => {
    if (!nativePlayerAvailable() || selectedCastDevice || !isPlaying) return undefined;
    const timer = window.setInterval(async () => {
      syncNativePlayerState('poll');
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isPlaying, selectedCastDevice]);

  useEffect(() => {
    if (!nativePlayerAvailable()) return undefined;
    const syncOnResume = () => {
      if (!document.hidden) syncNativePlayerState('resume');
    };
    document.addEventListener('visibilitychange', syncOnResume);
    window.addEventListener('focus', syncOnResume);
    return () => {
      document.removeEventListener('visibilitychange', syncOnResume);
      window.removeEventListener('focus', syncOnResume);
    };
  }, []);

  useEffect(() => {
    if (!selectedCastDevice || !window.moonbounce?.cast) return undefined;
    const syncCastOnResume = () => {
      if (!document.hidden) pollCastStatus({ advanceQueue: false, fallbackOnFailure: false });
    };
    document.addEventListener('visibilitychange', syncCastOnResume);
    window.addEventListener('focus', syncCastOnResume);
    return () => {
      document.removeEventListener('visibilitychange', syncCastOnResume);
      window.removeEventListener('focus', syncCastOnResume);
    };
  }, [selectedCastDevice, currentTrack, castPlaying]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
      }
      if (event.code === 'ArrowRight') nextTrack();
      if (event.code === 'ArrowLeft') previousTrack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => {
    const element = trackListRef.current;
    if (!element) return undefined;

    const updateViewport = () => setTrackViewportHeight(element.clientHeight || 0);
    updateViewport();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewport);
      return () => window.removeEventListener('resize', updateViewport);
    }

    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setTrackScrollTop(0);
    trackListRef.current?.scrollTo({ top: 0 });
  }, [selectedArtist?.ratingKey, selectedAlbum?.ratingKey, selectedPlaylist?.ratingKey]);

  async function connectToPlex(event) {
    event.preventDefault();
    setLoading(true);
    setServerConnectNotice('');
    setStatus('Dialing in Plex...');
    clearLoadedLibraryState();
    try {
      const client = createPlexClient({ serverUrl, token });
      const sections = await client.libraries();
      if (!sections.length) throw new Error('No music library found on this server.');
      const nextLibraryKey = sections.some((section) => section.key === settings.libraryKey)
        ? settings.libraryKey
        : sections[0].key;
      const nextSettings = { ...settings, serverUrl, token, libraryKey: nextLibraryKey, theme };
      writeSettings(nextSettings);
      setSettings(nextSettings);
      setLibraries(sections);
      setLibraryKey(nextLibraryKey);
      const [nextArtists, nextPlaylists] = await Promise.all([
        client.artists(nextLibraryKey),
        client.playlists(),
      ]);
      setArtists(nextArtists);
      setPlaylists(nextPlaylists);
      resetAlbumCache();
      setAlbums([]);
      setTracks([]);
      setSelectedTrack(null);
      setStatus(`${sections[0].title} is live.`);
      setSettingsOpen(false);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadPlexServers(accountToken = plexAccountToken) {
    if (!accountToken || !window.moonbounce?.plexAuth) return [];
    setLoading(true);
    try {
      const result = await window.moonbounce.plexAuth.resources(accountToken);
      const resources = result.resources || [];
      const diagnostics = result.diagnostics;
      setPlexServers(resources);
      if (resources.length && settings.plexServerId && resources.some((resource) => resource.id === settings.plexServerId)) {
        setSelectedPlexServerId(settings.plexServerId);
      } else if (!resources.some((resource) => resource.id === selectedPlexServerId)) {
        setSelectedPlexServerId('');
      }
      setStatus(resources.length
        ? `${resources.length} Plex server${resources.length === 1 ? '' : 's'} found.`
        : `No Plex servers found${diagnostics ? ` (${diagnostics.devices} account devices checked).` : '.'}`);
      return resources;
    } catch (error) {
      setStatus(error.message);
      return [];
    } finally {
      setLoading(false);
    }
  }

  function plexResourceUrls(resource) {
    const urls = [];
    const addUrl = (url) => {
      const cleanUrl = String(url || '').trim().replace(/\/+$/, '');
      if (cleanUrl && !urls.includes(cleanUrl)) urls.push(cleanUrl);
    };

    (resource.connections || [])
      .filter((connection) => connection.local && !connection.relay && connection.protocol === 'http')
      .forEach((connection) => addUrl(connection.uri));
    (resource.connections || [])
      .filter((connection) => connection.address && connection.port && connection.local && !connection.relay)
      .forEach((connection) => addUrl(`http://${connection.address}:${connection.port}`));
    addUrl(resource.uri);
    (resource.connections || []).forEach((connection) => addUrl(connection.uri));

    return urls;
  }

  async function connectPlexResource(resource, accountToken = plexAccountToken, options = {}) {
    const { closeSettingsOnSuccess = true, showSuccessNotice = false } = options;
    if (!resource) {
      setStatus('No Plex server selected.');
      setServerConnectNotice('No Plex server selected.');
      return false;
    }
    if (!resource.accessToken) {
      const message = `${resource.name || 'Selected server'} did not include an access token. Sign in again and try once more.`;
      setStatus(message);
      setServerConnectNotice(message);
      return false;
    }

    setLoading(true);
    setConnectingPlexServerId(resource.id || resource.name || '');
    setServerConnectNotice(`Connecting to ${resource.name}...`);
    setStatus(`Connecting to ${resource.name}...`);
    clearLoadedLibraryState();
    try {
      const candidates = plexResourceUrls(resource);
      const attempts = [];
      let serverUrlToUse = '';
      let client = null;
      let sections = [];
      let serverInfo = null;

      for (const candidateUrl of candidates) {
        try {
          setStatus(`Trying ${candidateUrl}...`);
          setServerConnectNotice(`Trying ${resource.name}...`);
          const candidateClient = createPlexClient({
            serverUrl: candidateUrl,
            token: resource.accessToken,
            timeoutMs: 6000,
          });
          const candidateInfo = await candidateClient.serverInfo();
          const expectedServerId = resource.id ? String(resource.id) : '';
          const actualServerId = candidateInfo?.machineIdentifier ? String(candidateInfo.machineIdentifier) : '';
          if (expectedServerId && actualServerId && expectedServerId !== actualServerId) {
            throw new Error(`reached ${candidateInfo.friendlyName || candidateInfo.machineIdentifier || 'a different server'}`);
          }
          const candidateSections = await candidateClient.libraries();
          serverUrlToUse = candidateUrl;
          client = candidateClient;
          sections = candidateSections;
          serverInfo = candidateInfo;
          break;
        } catch (error) {
          attempts.push(`${candidateUrl} (${error.message})`);
        }
      }

      if (!client) {
        logEvent('plex:resource-connect:attempts-failed', {
          server: resource.name,
          attempts,
        });
        throw new Error(`Could not reach ${resource.name}.`);
      }
      if (!sections.length) throw new Error('No music library found on this server.');
      const nextLibraryKey = sections[0].key;
      const normalizedAccountToken = accountToken || plexAccountToken || settings.plexAccountToken || '';
      const nextSettings = {
        ...settings,
        serverUrl: serverUrlToUse,
        plexServerUrls: candidates,
        token: resource.accessToken,
        libraryKey: nextLibraryKey,
        plexAccountToken: normalizedAccountToken,
        plexServerId: resource.id,
        theme,
      };
      writeSettings(nextSettings);
      setSettings(nextSettings);
      setPlexAccountToken(normalizedAccountToken);
      setServerUrl(serverUrlToUse);
      setToken(resource.accessToken);
      setSelectedPlexServerId(resource.id);
      setLibraryKey(nextLibraryKey);
      setLibraries(sections);
      const [nextArtists, nextPlaylists] = await Promise.all([
        client.artists(nextLibraryKey),
        client.playlists(),
      ]);
      setArtists(nextArtists);
      setPlaylists(nextPlaylists);
      resetAlbumCache();
      setAlbums([]);
      setTracks([]);
      setQueue([]);
      orderedQueueRef.current = [];
      setSelectedArtist(null);
      setSelectedAlbum(null);
      setSelectedPlaylist(null);
      setSelectedTrack(null);
      setStatus(`${resource.name} is live.`);
      if (showSuccessNotice || settingsOpen) {
        setServerConnectNotice(`Connected to ${serverInfo?.friendlyName || resource.name}. ${sections.length} music ${sections.length === 1 ? 'library' : 'libraries'} found.`);
      }
      if (closeSettingsOnSuccess) {
        setSettingsOpen(false);
      }
      return true;
    } catch (error) {
      setStatus(error.message);
      setServerConnectNotice(error.message);
      return false;
    } finally {
      setConnectingPlexServerId('');
      setLoading(false);
    }
  }

  async function signInWithPlex() {
    if (!window.moonbounce?.plexAuth) {
      setStatus('Plex login bridge unavailable.');
      return;
    }

    setPlexLoginPending(true);
    setPlexLoginCode('');
    setStatus('Opening Plex sign in...');
    try {
      const pin = await window.moonbounce.plexAuth.createPin();
      setPlexLoginCode(pin.code);

      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const result = await window.moonbounce.plexAuth.pollPin(pin.id);
        if (result.token) {
          setPlexAccountToken(result.token);
          const resources = await loadPlexServers(result.token);
          const nextSettings = { ...settings, plexAccountToken: result.token, theme };
          setSettings(nextSettings);
          writeSettings(nextSettings);
          if (!resources.length) {
            setStatus('Signed in, but no servers were found.');
            return;
          }
          const resource = resources.find((server) => server.id === selectedPlexServerId)
            || resources.find((server) => server.id === settings.plexServerId)
            || resources[0];
          if (resources.length === 1 || settings.plexServerId) {
            await connectPlexResource(resource, result.token);
          } else {
            setSelectedPlexServerId('');
            setStatus('Choose a Plex server to load its libraries.');
          }
          return;
        }
      }
      setStatus('Plex sign in timed out.');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setPlexLoginPending(false);
      setPlexLoginCode('');
    }
  }

  async function selectPlexServer(serverId) {
    if (!serverId) return;
    setSelectedPlexServerId(serverId);
    const resource = plexServers.find((server) => server.id === serverId) || plexServers[0];
    await connectPlexResource(resource, plexAccountToken || settings.plexAccountToken, {
      closeSettingsOnSuccess: false,
      showSuccessNotice: true,
    });
  }

  async function findPlexServers() {
    const resources = await loadPlexServers(plexAccountToken);
    if (resources.length === 1) {
      await connectPlexResource(resources[0]);
    }
  }

  async function refreshLibrary(nextLibraryKey = effectiveLibraryKey) {
    if (!plex || !nextLibraryKey) return;
    setLoading(true);
    try {
      const nextSettings = { ...settings, libraryKey: nextLibraryKey, theme };
      writeSettings(nextSettings);
      setSettings(nextSettings);
      const [nextArtists, nextPlaylists] = await Promise.all([
        plex.artists(nextLibraryKey),
        plex.playlists(),
      ]);
      setSelectedArtist(null);
      setSelectedAlbum(null);
      setSelectedPlaylist(null);
      setSelectedTrack(null);
      setArtists(nextArtists);
      setPlaylists(nextPlaylists);
      resetAlbumCache();
      setAlbums([]);
      setTracks([]);
      setStatus('Library refreshed.');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function chooseArtist(artist) {
    setBrowseMode('artists');
    setMobilePanel('albums');
    setSelectedArtist(artist);
    setSelectedAlbum(null);
    setSelectedPlaylist(null);
    setSelectedTrack(null);
    setTracks([]);
    if (!plex) {
      setAlbums([]);
      setTracks([]);
      setStatus('Connect Plex to load music.');
      return;
    }
    const cachedAlbums = albumCacheRef.current.get(cacheKeyForArtist(artist));
    if (cachedAlbums) {
      setAlbums(cachedAlbums);
      prefetchNearbyArtists(artist);
      await loadArtistTrackQueue(artist, cachedAlbums);
      return;
    }
    setLoading(true);
    try {
      const nextAlbums = await plex.albums(libraryKey, artist);
      rememberArtistAlbums(artist, nextAlbums);
      setAlbums(nextAlbums);
      prefetchNearbyArtists(artist);
      await loadArtistTrackQueue(artist, nextAlbums);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function navigateToTrackArtist(track = currentTrack) {
    const artistName = track?.grandparentTitle || track?.parentTitle || '';
    if (!artistName) return;

    const artistKey = track.grandparentKey || (track.grandparentRatingKey ? `/library/metadata/${track.grandparentRatingKey}` : '');
    const artist = artists.find((candidate) => (
      (track.grandparentRatingKey && String(candidate.ratingKey) === String(track.grandparentRatingKey))
      || (artistKey && candidate.key === artistKey)
      || candidate.title?.toLowerCase() === artistName.toLowerCase()
    ));

    setQuery('');
    setBrowseMode('artists');

    if (artist) {
      await chooseArtist(artist);
      return;
    }

    if (artistKey || track.grandparentRatingKey) {
      await chooseArtist({
        title: artistName,
        key: artistKey,
        ratingKey: track.grandparentRatingKey,
      });
      return;
    }

    setQuery(artistName);
    setStatus(`Filtered artists for ${artistName}.`);
  }

  async function loadArtistTrackQueue(artist, artistAlbums) {
    const artistKey = cacheKeyForArtist(artist);
    const cachedTracks = artistTrackCacheRef.current.get(artistKey);
    if (cachedTracks) {
      setTracks(cachedTracks);
      setStatus(`${artist.title} loaded.`);
      return;
    }

    artistTrackLoadRef.current = artistKey;
    setStatus(`Loading ${artist.title} tracks...`);
    try {
      const albumTrackGroups = [];
      for (let index = 0; index < artistAlbums.length; index += 4) {
        if (artistTrackLoadRef.current !== artistKey) return;
        const chunk = artistAlbums.slice(index, index + 4);
        const chunkTrackGroups = await Promise.all(
          chunk.map((albumItem) => plex.tracks(libraryKey, albumItem).catch(() => [])),
        );
        albumTrackGroups.push(...chunkTrackGroups);
      }
      const nextTracks = albumTrackGroups.flat();
      rememberArtistTracks(artist, nextTracks);
      setTracks(nextTracks);
      setStatus(nextTracks.length ? `${artist.title} loaded.` : `${artist.title} has no playable tracks.`);
    } catch (error) {
      if (artistTrackLoadRef.current === artistKey) setStatus(error.message);
    }
  }

  function prefetchNearbyArtists(artist) {
    if (!plex || !artists.length) return;
    const selectedIndex = artists.findIndex((candidate) => cacheKeyForArtist(candidate) === cacheKeyForArtist(artist));
    if (selectedIndex < 0) return;
    const nearby = [artists[selectedIndex + 1], artists[selectedIndex - 1]].filter(Boolean);

    nearby.forEach((nearbyArtist) => {
      const key = cacheKeyForArtist(nearbyArtist);
      if (!key || albumCacheRef.current.has(key) || albumPrefetchRef.current.has(key)) return;
      albumPrefetchRef.current.add(key);
      plex.albums(libraryKey, nearbyArtist)
        .then((nextAlbums) => rememberArtistAlbums(nearbyArtist, nextAlbums))
        .catch(() => {})
        .finally(() => albumPrefetchRef.current.delete(key));
    });
  }

  async function chooseAlbum(album) {
    setMobilePanel('tracks');
    setSelectedAlbum(album);
    setSelectedPlaylist(null);
    setSelectedTrack(null);
    if (!plex) {
      setTracks([]);
      setStatus('Connect Plex to load music.');
      return;
    }
    setLoading(true);
    try {
      const nextTracks = await plex.tracks(libraryKey, album);
      setTracks(nextTracks);
      setStatus(`${album.title} loaded.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function runSearch(event) {
    event.preventDefault();
    if (browseMode === 'playlists') {
      setStatus(query.trim() ? 'Filtering playlists.' : 'Playlist mode.');
      return;
    }
    if (!plex || !query.trim()) return;
    setSelectedTrack(null);
    setLoading(true);
    try {
      const results = await plex.search(query);
      setTracks(results);
      setStatus(`${results.length} tracks found.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function choosePlaylist(playlist) {
    setBrowseMode('playlists');
    setMobilePanel('tracks');
    setSelectedPlaylist(playlist);
    setSelectedArtist(null);
    setSelectedAlbum(null);
    setSelectedTrack(null);
    setAlbums([]);

    if (!plex) {
      setTracks([]);
      setStatus('Connect Plex to load music.');
      return;
    }

    setLoading(true);
    try {
      let nextTracks;
      try {
        nextTracks = await plex.playlistTracks(playlist);
      } catch (error) {
        const fallback = playlists.find((candidate) => (
          candidate.title === playlist.title
          && candidate.ratingKey !== playlist.ratingKey
          && Number(candidate.leafCount || 0) > 0
        ));
        if (!fallback) throw error;
        nextTracks = await plex.playlistTracks(fallback);
        setSelectedPlaylist(fallback);
      }
      setTracks(nextTracks);
      setAutoPlaylistTracksById((previous) => ({
        ...previous,
        [cacheKeyForPlaylist(playlist)]: nextTracks,
      }));
      setStatus(`${playlist.title} loaded.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  function playableUrl(track) {
    if (!connected || !track) return '';
    return trackStreamUrl(settings.serverUrl, settings.token, track);
  }

  function coverUrl(item, size = 360) {
    if (!connected || !item) return '';
    return plexImageUrl(settings.serverUrl, settings.token, item.thumb || item.composite || item.parentThumb || item.grandparentThumb, {
      width: size,
      height: size,
    });
  }

  async function playOnCastDevice(device, track = currentTrack || queue[0], index = currentIndex >= 0 ? currentIndex : 0, startTime = 0) {
    logEvent('cast:play-request', logTrackPayload(track, {
      index,
      startTime,
      device: device?.friendlyName || device?.name || '',
      queueLength: queueRef.current.length,
    }));
    if (!device) return false;
    if (!track || !connected) {
      setCastStatus('Connect Plex and queue a track');
      return false;
    }

    const url = playableUrl(track);
    if (!url) {
      setCastStatus('This track does not have a playable Plex stream');
      return false;
    }

    const identity = trackIdentity(track);

    try {
      if (identity === castLoadedTrackId && !castPlaying) {
        setCastStatus(`Resuming ${device.friendlyName || device.name}`);
        await window.moonbounce.cast.control('resume');
      } else {
        setCastStatus(`Loading on ${device.friendlyName || device.name}...`);
        await window.moonbounce.cast.play({
          id: device.id,
          host: device.host || device.name,
          startIndex: index,
          tracks: (queueRef.current.length ? queueRef.current : [track]).map((queueTrack) => ({
            title: queueTrack.title,
            subtitle: `${queueTrack.grandparentTitle || ''} - ${queueTrack.parentTitle || ''}`,
            url: playableUrl(queueTrack),
            coverUrl: coverUrl(queueTrack),
            mimeType: trackMimeType(queueTrack),
            duration: queueTrack.duration || 0,
          })).filter((queueTrack) => queueTrack.url),
          title: track.title,
          subtitle: `${track.grandparentTitle || ''} - ${track.parentTitle || ''}`,
          url,
          coverUrl: coverUrl(track),
          mimeType: trackMimeType(track),
          startTime,
        });
        setCastLoadedTrackId(identity);
      }

      audioRef.current?.pause();
      stopNativePlayback();
      setIsPlaying(false);
      setCastPlaying(true);
      setCurrentIndex(index);
      setCastStatus(`Casting to ${device.friendlyName || device.name}`);
      castStatusFailureRef.current = 0;
      castLastStatusRef.current = null;
      logEvent('cast:play-success-ui', logTrackPayload(track, {
        index,
        device: device.friendlyName || device.name,
      }));
      window.moonbounce.cast.control('volume', volume).catch((error) => {
        logEvent('cast:volume-sync:error', {
          device: device.friendlyName || device.name,
          message: error.message,
        });
        setCastStatus(`Casting, but volume sync failed. (${error.message})`);
      });
      return true;
    } catch (error) {
      logEvent('cast:play-error-ui', logTrackPayload(track, {
        index,
        device: device.friendlyName || device.name,
        message: error.message,
      }));
      setCastStatus(`Cast command failed, still connected to ${device.friendlyName || device.name}. (${error.message})`);
      return false;
    }
  }

  async function playOnCast(track = currentTrack || queue[0], index = currentIndex >= 0 ? currentIndex : 0, startTime = 0) {
    return playOnCastDevice(selectedCastDevice, track, index, startTime);
  }

  function playLocalTrack(track, index, startTime = 0) {
    if (!track) return;
    logEvent('local:play:start', logTrackPayload(track, {
      index,
      startTime,
      queueLength: queueRef.current.length,
      audioSrc: audioRef.current?.src || '',
    }));
    setCurrentIndex(index);
    const url = playableUrl(track);
    if (!url) {
      setIsPlaying(false);
      logEvent('local:play:no-url', logTrackPayload(track, { index }));
      setStatus('Connect Plex to play real audio.');
      return;
    }

    if (nativePlayerAvailable()) {
      const activeQueue = queueRef.current.length ? queueRef.current : [track];
      const nativeIndex = Math.max(0, Math.min(index, activeQueue.length - 1));
      playNativeQueue(activeQueue, nativeIndex, startTime);
      return;
    }

    window.setTimeout(() => {
      const audio = audioRef.current;
      if (!audio) return;
      setAudioLevelingEnabled(matchVolume);
      if (audio.src !== url) audio.src = url;
      const seekWhenReady = () => {
        if (startTime > 0 && Number.isFinite(startTime)) {
          audio.currentTime = startTime;
          setProgress(startTime);
        }
      };
      audio.load();
      if (audio.readyState >= 1) {
        seekWhenReady();
      } else {
        audio.addEventListener('loadedmetadata', seekWhenReady, { once: true });
      }
      audio.play()
        .then(() => {
          logEvent('local:play:success', logTrackPayload(track, {
            index,
            readyState: audio.readyState,
            duration: audio.duration || 0,
          }));
          setIsPlaying(true);
        })
        .catch((error) => {
          setIsPlaying(false);
          logEvent('local:play:error', logTrackPayload(track, {
            index,
            message: error.message,
            readyState: audio.readyState,
          }));
          setStatus(error.message);
        });
    }, 30);
  }

  function playLocalTrackAt(index) {
    playLocalTrack(queue[index], index);
  }

  async function playNativeQueue(nextQueue, startIndex = 0, startTime = 0) {
    const playableTracks = nextQueue.filter((track) => playableUrl(track));
    if (!playableTracks.length) {
      setIsPlaying(false);
      setStatus('Connect Plex to play real audio.');
      return;
    }
    const safeIndex = Math.max(0, Math.min(startIndex, playableTracks.length - 1));
    try {
      audioRef.current?.pause();
      await window.moonbounce.nativePlayer.play({
        tracks: playableTracks.map(nativeTrackPayload),
        startIndex: safeIndex,
        startTime,
        volume,
        matchVolume,
      });
      setCurrentIndex(safeIndex);
      setSelectedTrack(playableTracks[safeIndex]);
      setIsPlaying(true);
      setCastPlaying(false);
      setProgress(startTime || 0);
      setDuration(playableTracks[safeIndex]?.duration ? playableTracks[safeIndex].duration / 1000 : 0);
    } catch (error) {
      setIsPlaying(false);
      setStatus(error.message);
      logEvent('native:play:error', { message: error.message });
    }
  }

  function playQueue(nextQueue, startTrack) {
    const {
      startIndex,
      sourceQueue,
      orderedPlaybackQueue,
      playbackQueue,
    } = buildPlaybackQueue(nextQueue, startTrack, { shuffled: shuffle });

    logEvent('queue:play', logTrackPayload(startTrack, {
      sourceQueueLength: sourceQueue.length,
      playbackQueueLength: playbackQueue.length,
      startIndex,
      shuffle,
      selectedCastDevice: selectedCastDevice?.friendlyName || selectedCastDevice?.name || '',
    }));
    setSelectedTrack(startTrack);
    audioRef.current?.pause();
    orderedQueueRef.current = orderedPlaybackQueue;
    setQueue(playbackQueue);
    setCurrentIndex(0);
    setShuffle(shuffle);
    setIsPlaying(false);
    setCastPlaying(false);
    setCastLoadedTrackId('');
    setProgress(0);
    setDuration(0);
    setTimeout(() => {
      if (selectedCastDevice) {
        playOnCast(startTrack, 0);
        return;
      }
      if (nativePlayerAvailable()) {
        playNativeQueue(playbackQueue, 0);
        return;
      }
      playLocalTrack(startTrack, 0);
    }, 30);
  }

  function playSelectedCollection() {
    if (!tracks.length) return false;
    const startTrack = shuffle
      ? tracks[Math.floor(Math.random() * tracks.length)]
      : tracks[0];
    playQueue(tracks, startTrack);
    return true;
  }

  async function togglePlayback({ preferSelection = false } = {}) {
    if (preferSelection && pendingSelectedTrack) {
      playQueue(tracks.length ? tracks : queue, pendingSelectedTrack);
      return;
    }

    if (preferSelection && (selectedPlaylist || selectedAlbum || selectedArtist) && playSelectedCollection()) {
      return;
    }

    if (!currentTrack && selectedTrack) {
      playQueue(tracks.length ? tracks : queue, selectedTrack);
      return;
    }

    if (!currentTrack && !queue.length && tracks.length) {
      playQueue(tracks, tracks[0]);
      return;
    }

    if (selectedCastDevice) {
      if (castPlaying) {
        try {
          await window.moonbounce.cast.control('pause');
          setCastPlaying(false);
          setCastStatus(`Paused on ${selectedCastDevice.friendlyName || selectedCastDevice.name}`);
        } catch (error) {
          setCastStatus(error.message);
        }
        return;
      }

      const track = currentTrack || queue[0];
      const index = currentTrack ? currentIndex : 0;
      await playOnCast(track, index);
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    if (!currentTrack && queue.length) {
      playLocalTrackAt(0);
      return;
    }
    if (!currentTrack) return;
    if (!playableUrl(currentTrack)) {
      setStatus('Connect Plex to play real audio.');
      return;
    }
    if (nativePlayerAvailable()) {
      try {
        if (isPlaying) {
          await window.moonbounce.nativePlayer.pause();
          setIsPlaying(false);
        } else {
          await window.moonbounce.nativePlayer.resume();
          setIsPlaying(true);
        }
      } catch (error) {
        setStatus(error.message);
      }
      return;
    }
    if (audio.paused) {
      audio.play().then(() => setIsPlaying(true)).catch((error) => setStatus(error.message));
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }

  async function nextTrack(fromEnded = false, forcePlay = false, playbackTarget = 'auto') {
    logEvent('queue:next:request', {
      fromEnded,
      forcePlay,
      playbackTarget,
      currentIndex,
      queueLength: queue.length,
      repeat,
      castPlaying,
      selectedCastDevice: selectedCastDevice?.friendlyName || selectedCastDevice?.name || '',
      currentTrack: logTrackPayload(currentTrack),
    });
    if (!queue.length) return;
    const step = nextQueueStep({ queue, currentIndex, repeat, fromEnded });
    if (step.type === 'repeat-one') {
      if (selectedCastDevice && playbackTarget !== 'local') {
        await playOnCast(currentTrack, currentIndex);
      } else if (nativePlayerAvailable()) {
        await window.moonbounce.nativePlayer.seek(0);
        await window.moonbounce.nativePlayer.resume();
        setIsPlaying(true);
      } else {
        audioRef.current.currentTime = 0;
        audioRef.current.play().then(() => setIsPlaying(true)).catch((error) => setStatus(error.message));
      }
      return;
    }
    const nextIndex = step.nextIndex;
    logEvent('queue:next:computed', {
      currentIndex,
      nextIndex,
      queueLength: queue.length,
      nextTrack: logTrackPayload(queue[nextIndex]),
    });
    if (step.type === 'repeat-all') {
      setCurrentIndex(0);
      if (selectedCastDevice && playbackTarget !== 'local' && (castPlaying || forcePlay)) await playOnCast(queue[0], 0);
      if ((playbackTarget === 'local' || !selectedCastDevice) && (forcePlay || fromEnded || isPlaying || audioRef.current?.paused === false)) playLocalTrackAt(0);
      return;
    }
    if (step.type === 'finished') {
      setIsPlaying(false);
      setCastPlaying(false);
      setStatus('Queue finished.');
      return;
    }
    if (selectedCastDevice && playbackTarget !== 'local') {
      setCurrentIndex(nextIndex);
      if (castPlaying || forcePlay) await playOnCast(queue[nextIndex], nextIndex);
      return;
    }
    if (forcePlay || fromEnded || isPlaying || audioRef.current?.paused === false) {
      playLocalTrackAt(nextIndex);
      return;
    }
    setCurrentIndex(nextIndex);
  }

  function handleLocalEnded() {
    advanceLocalQueueFromEnd();
  }

  function advanceLocalQueueFromEnd() {
    if (localAdvanceLockRef.current) {
      logEvent('local:auto-advance:locked', {
        currentIndex: currentIndexRef.current,
        queueLength: queueRef.current.length,
      });
      return;
    }
    localAdvanceLockRef.current = true;

    const nextQueue = queueRef.current;
    const nextCurrentIndex = currentIndexRef.current;
    const nextRepeat = repeatRef.current;

    const releaseLock = () => {
      window.setTimeout(() => {
        localAdvanceLockRef.current = false;
      }, 700);
    };

    if (!nextQueue.length || nextCurrentIndex < 0) {
      logEvent('local:auto-advance:no-queue', {
        currentIndex: nextCurrentIndex,
        queueLength: nextQueue.length,
      });
      releaseLock();
      return;
    }

    if (nextRepeat === 'one') {
      logEvent('local:auto-advance:repeat-one', logTrackPayload(nextQueue[nextCurrentIndex], {
        currentIndex: nextCurrentIndex,
        queueLength: nextQueue.length,
      }));
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.play()
          .then(() => setIsPlaying(true))
          .catch((error) => {
            setIsPlaying(false);
            setStatus(error.message);
          })
          .finally(releaseLock);
        return;
      }
      releaseLock();
      return;
    }

    const nextIndex = nextCurrentIndex + 1;
    if (nextIndex < nextQueue.length) {
      logEvent('local:auto-advance:next', logTrackPayload(nextQueue[nextIndex], {
        previousIndex: nextCurrentIndex,
        nextIndex,
        queueLength: nextQueue.length,
      }));
      playLocalTrack(nextQueue[nextIndex], nextIndex);
      releaseLock();
      return;
    }

    if (nextRepeat === 'all') {
      logEvent('local:auto-advance:repeat-all', logTrackPayload(nextQueue[0], {
        previousIndex: nextCurrentIndex,
        queueLength: nextQueue.length,
      }));
      playLocalTrack(nextQueue[0], 0);
      releaseLock();
      return;
    }

    logEvent('local:auto-advance:queue-finished', {
      previousIndex: nextCurrentIndex,
      queueLength: nextQueue.length,
    });
    setIsPlaying(false);
    setCastPlaying(false);
    setStatus('Queue finished.');
    releaseLock();
  }

  async function previousTrack(forcePlay = false) {
    if (!queue.length) return;
    if (currentIndex < 0) return;
    if (!selectedCastDevice && audioRef.current?.currentTime > 4) {
      audioRef.current.currentTime = 0;
      return;
    }
    const previousIndex = Math.max(0, currentIndex - 1);
    setCurrentIndex(previousIndex);
    if (selectedCastDevice && (castPlaying || forcePlay)) {
      await playOnCast(queue[previousIndex], previousIndex);
      return;
    }
    if (!selectedCastDevice && (forcePlay || isPlaying || audioRef.current?.paused === false)) {
      playLocalTrackAt(previousIndex);
    }
  }

  async function seek(value) {
    const next = Number(value);
    setProgress(next);
    if (selectedCastDevice) {
      try {
        await window.moonbounce.cast.control('seek', next);
      } catch (error) {
        setCastStatus(error.message);
      }
      return;
    }
    if (nativePlayerAvailable()) {
      try {
        await window.moonbounce.nativePlayer.seek(next);
      } catch (error) {
        setStatus(error.message);
      }
      return;
    }
    if (audioRef.current) audioRef.current.currentTime = next;
  }

  function changeVolume(value) {
    const next = Number(value);
    setVolume(next);
    if (audioRef.current) audioRef.current.volume = 1;
    if (nativePlayerAvailable()) {
      window.moonbounce.nativePlayer.volume(next).catch((error) => {
        logEvent('native:volume:error', { message: error.message });
      });
    }

    if (selectedCastDevice && window.moonbounce?.cast) {
      if (castVolumeTimerRef.current) window.clearTimeout(castVolumeTimerRef.current);
      castVolumeTimerRef.current = window.setTimeout(async () => {
        try {
          await window.moonbounce.cast.control('volume', next);
        } catch (error) {
          setCastStatus(error.message);
        }
      }, 120);
      return;
    }

    if (!window.moonbounce?.systemVolume) return;
    if (systemVolumeTimerRef.current) window.clearTimeout(systemVolumeTimerRef.current);
    systemVolumeTimerRef.current = window.setTimeout(async () => {
      try {
        await window.moonbounce.systemVolume.set(next);
      } catch (error) {
        setStatus(error.message);
      }
    }, 120);
  }

  function jumpToQueueItem(index) {
    const track = queue[index];
    if (!track) return;
    setQueueOpen(false);
    setSelectedTrack(track);
    setCurrentIndex(index);
    setTimeout(() => {
      if (selectedCastDevice) {
        playOnCast(track, index);
        return;
      }

      if (playableUrl(track)) {
        if (nativePlayerAvailable()) {
          playNativeQueue(queue, index);
          return;
        }
        audioRef.current?.load();
        audioRef.current?.play()
          .then(() => setIsPlaying(true))
          .catch((error) => {
            setIsPlaying(false);
            setStatus(error.message);
          });
      } else {
        setIsPlaying(false);
        setStatus('Connect Plex to play real audio.');
      }
    }, 30);
  }

  function addTrackToQueue(track) {
    if (!track) return;
    const nextQueue = [...queue, track];
    const orderedBase = orderedQueueRef.current.length ? orderedQueueRef.current : queue;
    orderedQueueRef.current = [...orderedBase, track];
    setQueue(nextQueue);
    setStatus(`Added ${track.title} to queue.`);
  }

  function removeFromQueue(index) {
    const nextState = removeQueueItemState({
      queue,
      currentIndex,
      orderedQueue: orderedQueueRef.current,
    }, index);

    if (nextState.blocked) {
      setStatus('The current song is already playing.');
      return;
    }

    orderedQueueRef.current = nextState.orderedQueue;
    setQueue(nextState.queue);
    setCurrentIndex(nextState.currentIndex);
    setStatus(`Removed ${nextState.removedTrack?.title || 'track'} from queue.`);
  }

  function moveQueueItem(fromIndex, toIndex) {
    const nextState = moveQueueItemState({ queue, currentIndex }, fromIndex, toIndex);
    if (nextState.blocked) return;

    setQueue(nextState.queue);
    setCurrentIndex(nextState.currentIndex);
    orderedQueueRef.current = nextState.queue;
    setStatus(`Moved ${nextState.movedTrack.title}.`);
  }

  function dropQueueItem(targetIndex) {
    if (draggedQueueIndex === null) return;
    moveQueueItem(draggedQueueIndex, targetIndex);
    setDraggedQueueIndex(null);
  }

  function clearUpcomingQueue() {
    if (!queue.length) return;
    if (currentIndex < 0) {
      setQueue([]);
      orderedQueueRef.current = [];
      setStatus('Queue cleared.');
      return;
    }

    const nextQueue = queue.slice(0, currentIndex + 1);
    const currentIdentities = new Set(nextQueue.map((track) => trackIdentity(track)));
    orderedQueueRef.current = orderedQueueRef.current.filter((track) => currentIdentities.has(trackIdentity(track)));
    setQueue(nextQueue);
    setStatus('Upcoming queue cleared.');
  }

  async function addTrackToPlaylist(playlist) {
    if (!playlistPickerTrack) return;
    if (!plex) {
      setStatus('Connect Plex to add tracks to playlists.');
      setPlaylistPickerTrack(null);
      return;
    }

    const playlistName = playlist.title;
    setAddingToPlaylist(playlist.ratingKey || playlist.key || playlistName);
    try {
      await plex.addTrackToPlaylist(playlist, playlistPickerTrack);
      setStatus(`Added ${playlistPickerTrack.title} to ${playlistName}.`);
      setPlaylistPickerTrack(null);
      const nextPlaylists = await plex.playlists();
      setPlaylists(nextPlaylists);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setAddingToPlaylist('');
    }
  }

  async function castToDevice(device) {
    const handoffTrack = currentTrack;
    const handoffIndex = currentIndex >= 0 ? currentIndex : 0;
    const shouldResume = Boolean(handoffTrack && (castPlaying || isPlaying || audioRef.current?.paused === false));

    try {
      setCastStatus(`Connecting to ${device.friendlyName || device.name}...`);
      await window.moonbounce.cast.connect({
        id: device.id,
        host: device.host || device.name,
      });
      const handoffTime = selectedCastDevice ? progressRef.current : localPlaybackPosition();
      logEvent('cast:handoff-to-device', logTrackPayload(handoffTrack, {
        handoffTime,
        wasCasting: Boolean(selectedCastDevice),
        wasLocalPlaying: Boolean(audioRef.current && audioRef.current.paused === false),
        device: device.friendlyName || device.name,
      }));
      audioRef.current?.pause();
      stopNativePlayback();
      setIsPlaying(false);
      setCastPlaying(false);
      setSelectedCastDevice(device);
      castStatusFailureRef.current = 0;
      setCastStatus(`Connected to ${device.friendlyName || device.name}`);
      setCastOpen(false);
      if (shouldResume) {
        await playOnCastDevice(device, handoffTrack, handoffIndex, handoffTime);
      }
    } catch (error) {
      setSelectedCastDevice(null);
      setCastPlaying(false);
      setCastStatus(error.message);
    }
  }

  async function castToThisDevice() {
    const handoffTrack = currentTrack;
    const handoffIndex = currentIndex >= 0 ? currentIndex : 0;
    const handoffTime = selectedCastDevice ? progress : (audioRef.current?.currentTime || progress || 0);
    const shouldResume = Boolean(selectedCastDevice && castPlaying && handoffTrack);

    try {
      if (window.moonbounce?.cast?.disconnect) {
        await window.moonbounce.cast.disconnect();
      } else if (selectedCastDevice) {
        await window.moonbounce.cast.control('stop');
      }
    } catch (error) {
      setCastStatus(error.message);
    }

    setSelectedCastDevice(null);
    setCastPlaying(false);
    setCastLoadedTrackId('');
    castStatusFailureRef.current = 0;
    castLastStatusRef.current = null;
    setCastStatus('Playing on this device');
    setCastOpen(false);
    if (shouldResume) {
      playLocalTrack(handoffTrack, handoffIndex, handoffTime);
    }
  }

  function fallbackToThisDevice(message = 'Cast connection lost. Switched to this device.') {
    setSelectedCastDevice(null);
    setCastPlaying(false);
    setCastLoadedTrackId('');
    setCastStatus(message);
    castStatusFailureRef.current = 0;
    castLastStatusRef.current = null;
    castStatusPollingRef.current = false;
    castHealthPollingRef.current = false;
  }

  async function toggleCastMenu() {
    const nextOpen = !castOpen;
    setCastOpen(nextOpen);
    if (nextOpen && window.moonbounce?.cast) {
      try {
        const result = await window.moonbounce.cast.list();
        setCastSupported(result.supported);
        setCastDevices(result.devices || []);
        setCastStatus(result.supported ? (result.devices?.length ? 'Choose a device' : 'Scanning') : 'Casting unavailable');
      } catch (error) {
        setCastStatus(error.message);
      }
    }
  }

  async function rescanCastDevices() {
    if (!window.moonbounce?.cast) {
      setCastSupported(false);
      setCastStatus('Desktop bridge unavailable');
      return;
    }

    setCastScanning(true);
    setCastStatus('Scanning');
    setSelectedCastDevice(null);
    setCastPlaying(false);
    setCastLoadedTrackId('');
    try {
      const result = await window.moonbounce.cast.rescan();
      setCastSupported(result.supported);
      setCastDevices(result.devices || []);
      setCastStatus(result.supported ? 'Scanning for devices' : 'Casting unavailable');
    } catch (error) {
      if (error.message?.includes('No handler registered')) {
        const result = await window.moonbounce.cast.list();
        setCastSupported(result.supported);
        setCastDevices(result.devices || []);
        setCastStatus('Restart Music Complex to enable full rescan');
      } else {
        setCastStatus(error.message);
      }
    } finally {
      window.setTimeout(() => setCastScanning(false), 1200);
    }
  }

  const visibleAlbums = albums;
  const filteredArtists = artists.filter((artist) => artist.title.toLowerCase().includes(query.toLowerCase()));
  const filteredPlaylists = playlists
    .filter((playlist) => playlist.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(b.leafCount || 0) - Number(a.leafCount || 0));
  const virtualTracks = useMemo(() => {
    if (!tracks.length) {
      return { rows: [], topOffset: 0, totalHeight: 0 };
    }

    const viewportHeight = trackViewportHeight || 520;
    const startIndex = Math.max(0, Math.floor(trackScrollTop / TRACK_ROW_HEIGHT) - TRACK_ROW_OVERSCAN);
    const visibleCount = Math.ceil(viewportHeight / TRACK_ROW_HEIGHT) + TRACK_ROW_OVERSCAN * 2;
    const endIndex = Math.min(tracks.length, startIndex + visibleCount);
    const rows = tracks.slice(startIndex, endIndex).map((track, offset) => ({
      track,
      index: startIndex + offset,
    }));

    return {
      rows,
      topOffset: startIndex * TRACK_ROW_HEIGHT,
      totalHeight: tracks.length * TRACK_ROW_HEIGHT,
    };
  }, [tracks, trackScrollTop, trackViewportHeight]);
  const audioSource = currentTrack ? playableUrl(currentTrack) : '';
  const selectedCollection = selectedPlaylist || selectedAlbum || selectedArtist;
  const heroSelection = useMemo(() => {
    if (pendingSelectedTrack) {
      return {
        item: pendingSelectedTrack,
        seed: pendingSelectedTrack.title,
        kicker: 'Track selected',
        title: pendingSelectedTrack.title,
        subtitle: `${pendingSelectedTrack.grandparentTitle || 'Unknown artist'} - ${pendingSelectedTrack.parentTitle || 'Unknown album'}`,
      };
    }

    if (selectedAlbum) {
      const artistName = selectedAlbum.parentTitle || selectedArtist?.title || 'Selected artist';
      const albumYear = yearFrom(selectedAlbum);
      return {
        item: selectedAlbum,
        seed: selectedAlbum.title,
        kicker: 'Album selected',
        title: selectedAlbum.title,
        subtitle: albumYear ? `${artistName} - ${albumYear}` : artistName,
      };
    }

    if (selectedPlaylist) {
      const trackCount = Number(selectedPlaylist.leafCount || tracks.length || 0);
      return {
        item: selectedPlaylist,
        seed: selectedPlaylist.title,
        kicker: 'Playlist selected',
        title: selectedPlaylist.title,
        subtitle: trackCount ? `${trackCount} tracks loaded` : 'Playlist ready',
      };
    }

    if (selectedArtist) {
      const albumCount = visibleAlbums.length;
      const trackCount = tracks.length;
      const parts = [
        albumCount ? `${albumCount} albums` : 'Artist selected',
        trackCount ? `${trackCount} tracks loaded` : '',
      ].filter(Boolean);
      return {
        item: selectedArtist,
        seed: selectedArtist.title,
        kicker: 'Artist selected',
        title: selectedArtist.title,
        subtitle: parts.join(' - '),
      };
    }

    if (currentTrack) {
      return {
        item: currentTrack,
        seed: currentTrack.title,
        kicker: 'Now bouncing',
        title: currentTrack.title,
        subtitle: `${currentTrack.grandparentTitle || 'Unknown artist'} - ${currentTrack.parentTitle || 'Unknown album'}`,
      };
    }

    return {
      item: null,
      seed: 'Music Complex',
      kicker: 'Now bouncing',
      title: 'Pick a track',
      subtitle: connected ? 'Choose music from your library' : 'Connect Plex to load music',
    };
  }, [currentTrack, pendingSelectedTrack, selectedAlbum, selectedArtist, selectedPlaylist, tracks.length, visibleAlbums.length]);
  const heroArt = coverUrl(heroSelection.item, 520);
  useEffect(() => {
    const priorityUrls = [
      currentTrack ? coverUrl(currentTrack, 520) : '',
      heroArt,
      currentTrack ? coverUrl(currentTrack, 96) : '',
    ].filter(Boolean);
    const warmUrls = visibleAlbums
      .slice(0, 12)
      .map((album) => coverUrl(album, 260))
      .filter(Boolean);

    const preload = (urls) => urls.forEach((url) => {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
    });

    preload(priorityUrls);
    const idleCallback = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 250));
    const cancelIdleCallback = window.cancelIdleCallback || window.clearTimeout;
    const idleId = idleCallback(() => preload(warmUrls));
    return () => cancelIdleCallback(idleId);
  }, [currentTrack, heroArt, visibleAlbums]);
  const heroPlayButtonShowsPause = !pendingSelectedTrack && !selectedCollection && (isPlaying || castPlaying);
  const transportPlayButtonShowsPause = isPlaying || castPlaying;
  const autoCatalogTracks = useMemo(() => {
    const byId = new Map();
    [...autoLibraryTracks, ...tracks].filter(Boolean).forEach((track) => {
      byId.set(trackIdentity(track), track);
    });
    return [...byId.values()];
  }, [autoLibraryTracks, tracks]);

  async function playAutoMediaId(mediaId) {
    if (!plex) {
      setStatus('Connect Plex on your phone before using Android Auto.');
      return;
    }
    const now = Date.now();
    const lastMediaCommand = autoLastMediaCommandRef.current;
    if (lastMediaCommand.mediaId === mediaId && now - lastMediaCommand.time < 1200) {
      logEvent('auto:play-media-id:dedupe', { mediaId });
      return;
    }
    autoLastMediaCommandRef.current = { mediaId, time: now };
    logEvent('auto:play-media-id', { mediaId });
    const target = chooseAutoPlaybackTarget({
      mediaId,
      tracks: autoCatalogTracks,
      artists,
      playlists,
      albums,
      playlistTracksById: autoPlaylistTracksById,
      shuffled: shuffle,
    });
    if (!target) {
      setStatus('That Android Auto item is no longer available.');
      return;
    }

    if ((target.kind === 'track' || target.kind === 'shuffle') && target.track) {
      playQueue(target.tracks, target.track);
      return;
    }

    if (target.kind === 'playlist' && target.item) {
      const nextTracks = target.tracks?.length ? target.tracks : await plex.playlistTracks(target.item);
      if (!nextTracks.length) {
        setStatus(`${target.item.title} has no playable tracks.`);
        return;
      }
      setAutoPlaylistTracksById((previous) => ({
        ...previous,
        [cacheKeyForPlaylist(target.item)]: nextTracks,
      }));
      setBrowseMode('playlists');
      setSelectedPlaylist(target.item);
      setSelectedArtist(null);
      setSelectedAlbum(null);
      setSelectedTrack(null);
      setTracks(nextTracks);
      playQueue(nextTracks, target.shuffled || shuffle ? nextTracks[Math.floor(Math.random() * nextTracks.length)] : nextTracks[0]);
      return;
    }

    if (target.kind === 'artist' && target.item) {
      const artistAlbums = await plex.albums(libraryKey, target.item);
      const albumTrackGroups = await Promise.all(artistAlbums.map((albumItem) => plex.tracks(libraryKey, albumItem).catch(() => [])));
      const nextTracks = albumTrackGroups.flat();
      if (!nextTracks.length) {
        setStatus(`${target.item.title} has no playable tracks.`);
        return;
      }
      setBrowseMode('artists');
      setSelectedArtist(target.item);
      setSelectedAlbum(null);
      setSelectedPlaylist(null);
      setSelectedTrack(null);
      setAlbums(artistAlbums);
      setTracks(nextTracks);
      playQueue(nextTracks, shuffle ? nextTracks[Math.floor(Math.random() * nextTracks.length)] : nextTracks[0]);
      return;
    }

    if (target.kind === 'album' && target.item) {
      const nextTracks = target.tracks?.length ? target.tracks : await plex.tracks(libraryKey, target.item);
      if (!nextTracks.length) {
        setStatus(`${target.item.title} has no playable tracks.`);
        return;
      }
      setSelectedAlbum(target.item);
      setSelectedPlaylist(null);
      setSelectedTrack(null);
      setTracks(nextTracks);
      playQueue(nextTracks, shuffle ? nextTracks[Math.floor(Math.random() * nextTracks.length)] : nextTracks[0]);
    }
  }

  autoTransportRef.current = async (event = {}) => {
    const action = event.action || '';
    if (action === 'play') {
      const localAudioPaused = audioRef.current?.paused !== false;
      if ((!isPlaying && !castPlaying) || (!castPlaying && localAudioPaused)) await togglePlayback();
      return;
    }
    if (action === 'pause') {
      if (isPlaying || castPlaying) await togglePlayback();
      return;
    }
    if (action === 'next') {
      await nextTrack(false, true);
      return;
    }
    if (action === 'previous') {
      await previousTrack(true);
      return;
    }
    if (action === 'seek') {
      await seek(event.position || 0);
      return;
    }
    if (action === 'playMediaId' && event.mediaId) {
      await playAutoMediaId(event.mediaId);
      return;
    }
    if (action === 'search' && event.query && plex) {
      const results = await plex.search(event.query);
      if (results.length) playQueue(results, results[0]);
    }
  };

  useEffect(() => {
    if (!window.moonbounce?.auto?.onTransport) return undefined;
    return window.moonbounce.auto.onTransport((event) => {
      autoTransportRef.current?.(event);
    });
  }, []);

  useEffect(() => {
    if (!window.moonbounce?.auto?.update) return;
    window.moonbounce.auto.update({
      title: currentTrack?.title || 'Nothing loaded',
      artist: currentTrack?.grandparentTitle || currentTrack?.parentTitle || 'Music Complex',
      album: currentTrack?.parentTitle || '',
      coverUrl: currentTrack ? coverUrl(currentTrack) : '',
      duration: duration || (currentTrack?.duration ? currentTrack.duration / 1000 : 0),
      position: progress || 0,
      playing: Boolean(isPlaying || castPlaying),
    }).catch(() => {});
  }, [currentTrack, progress, duration, isPlaying, castPlaying, connected, settings.serverUrl, settings.token]);

  useEffect(() => {
    if (!window.moonbounce?.auto?.catalog) return;
    // Persist artists and their album index so head units can browse instantly. Songs and
    // playlist pages remain dynamic to keep the bootstrap catalog compact.
    const catalog = buildAndroidAutoCatalog({
      artists,
      playlists,
      albums: autoLibraryAlbums,
    });
    const selectedAutoServer = plexServers.find((server) => server.id === settings.plexServerId)
      || plexServers.find((server) => plexResourceUrls(server).includes(settings.serverUrl));
    const autoServerUrls = selectedAutoServer
      ? [
        ...(selectedAutoServer.connections || [])
          .filter((connection) => !connection.local && !connection.relay && connection.uri)
          .map((connection) => connection.uri),
        ...plexResourceUrls(selectedAutoServer),
      ].filter((url, index, values) => url && values.indexOf(url) === index)
      : (settings.plexServerUrls || [settings.serverUrl]);
    window.moonbounce.auto.catalog({
      ...attachPlayableUrlsToCatalog(catalog, [], playableUrl, (path) => coverUrl({ thumb: path })),
      plex: {
        serverUrl: settings.serverUrl,
        serverUrls: autoServerUrls,
        serverId: settings.plexServerId,
        token: settings.token,
        matchVolume,
      },
    }).catch(() => {});
  }, [artists, playlists, autoLibraryAlbums, plexServers, settings.serverUrl, settings.plexServerId, settings.plexServerUrls, settings.token, matchVolume]);

  async function pollCastStatus({ alive = true, advanceQueue = false, fallbackOnFailure = false } = {}) {
      if (castStatusPollingRef.current) {
        logEvent('cast:poll:skipped-active', {
          advanceQueue,
          fallbackOnFailure,
          currentIndex,
          queueLength: queue.length,
        });
        return;
      }
      castStatusPollingRef.current = true;
      try {
        logEvent('cast:poll:start', {
          advanceQueue,
          fallbackOnFailure,
          currentIndex,
          queueLength: queue.length,
          castPlaying,
          currentTrack: logTrackPayload(currentTrack),
        });
        const status = await window.moonbounce.cast.status();
        if (!alive) return;
        castStatusFailureRef.current = 0;
        const now = Date.now();
        const hasLiveStatus = Boolean(status.playerState || status.duration || status.currentTime);
        const fallbackDuration = currentTrack?.duration ? currentTrack.duration / 1000 : 0;
        const statusDuration = status.duration || fallbackDuration;
        const previousStatus = castLastStatusRef.current;
        const previousRemaining = previousStatus
          ? Math.max(0, previousStatus.duration - previousStatus.currentTime)
          : Infinity;
        const secondsSincePrevious = previousStatus
          ? (now - previousStatus.timestamp) / 1000
          : 0;
        const inferredFinished = inferCastFinished({
          advanceQueue,
          status,
          previousStatus,
          now,
          fallbackDuration,
        });

        if (hasLiveStatus) {
          castLastStatusRef.current = {
            currentTime: status.currentTime || 0,
            duration: statusDuration,
            playerState: status.playerState || '',
            timestamp: now,
          };
        }

        logEvent('cast:poll:success', {
          playerState: status.playerState,
          currentTime: status.currentTime || 0,
          duration: statusDuration,
          statusIndex: status.index,
          hasLiveStatus,
          inferredFinished,
          previousRemaining,
          secondsSincePrevious,
          currentIndex,
          queueLength: queue.length,
        });
        if (inferredFinished) {
          if (castAutoAdvanceRef.current) {
            logEvent('cast:auto-advance:locked', {
              currentIndex: currentIndexRef.current,
              queueLength: queueRef.current.length,
            });
            return;
          }

          castAutoAdvanceRef.current = true;
          castLastStatusRef.current = null;
          logEvent('cast:auto-advance:next', logTrackPayload(queueRef.current[currentIndexRef.current], {
            currentIndex: currentIndexRef.current,
            queueLength: queueRef.current.length,
          }));
          try {
            await nextTrack(true, true, 'cast');
          } finally {
            window.setTimeout(() => {
              castAutoAdvanceRef.current = false;
            }, 1500);
          }
          return;
        }
        if (typeof status.index === 'number' && status.index >= 0) setCurrentIndex(status.index);
        setProgress(status.currentTime || 0);
        setDuration(statusDuration);
        if (status.playerState === 'PLAYING' || status.playerState === 'BUFFERING') setCastPlaying(true);
        if (status.playerState === 'PAUSED') setCastPlaying(false);
        if (status.playerState === 'IDLE') {
          setCastPlaying(false);
        }
      } catch (error) {
        if (!alive) return;
        castStatusFailureRef.current += 1;
        logEvent('cast:status:error', {
          message: error.message,
          failures: castStatusFailureRef.current,
          castPlaying,
          currentIndex,
          queueLength: queue.length,
          currentTrack: logTrackPayload(currentTrack),
        });
        setCastStatus(`Casting, reconnecting controls... (${castStatusFailureRef.current}/5)`);
        if (fallbackOnFailure && castStatusFailureRef.current >= 5) {
          fallbackToThisDevice(`Cast controls were lost. Switched to this device. (${error.message})`);
        }
      } finally {
        castStatusPollingRef.current = false;
      }
  }

  useEffect(() => {
    if (!selectedCastDevice || !castPlaying || !window.moonbounce?.cast) return undefined;

    logEvent('cast:poll-effect:start', {
      device: selectedCastDevice.friendlyName || selectedCastDevice.name,
      currentIndex,
      queueLength: queue.length,
      currentTrack: logTrackPayload(currentTrack),
    });
    let alive = true;
    const poll = async () => {
      await pollCastStatus({ alive, advanceQueue: true, fallbackOnFailure: false });
    };

    poll();
    const interval = window.setInterval(poll, 1000);
    return () => {
      alive = false;
      logEvent('cast:poll-effect:stop', {
        device: selectedCastDevice.friendlyName || selectedCastDevice.name,
        currentIndex,
        queueLength: queue.length,
      });
      castStatusPollingRef.current = false;
      window.clearInterval(interval);
    };
  }, [selectedCastDevice, castPlaying, currentTrack]);

  useEffect(() => {
    if (!selectedCastDevice || castPlaying || !window.moonbounce?.cast) return undefined;

    let alive = true;
    const checkHealth = async () => {
      if (castHealthPollingRef.current) return;
      castHealthPollingRef.current = true;
      try {
        await pollCastStatus({ alive, advanceQueue: false, fallbackOnFailure: true });
      } finally {
        castHealthPollingRef.current = false;
      }
    };

    checkHealth();
    const interval = window.setInterval(checkHealth, 15000);
    return () => {
      alive = false;
      castHealthPollingRef.current = false;
      window.clearInterval(interval);
    };
  }, [selectedCastDevice, castPlaying]);

  return (
    <main className="app-shell" data-theme={theme}>
      <audio ref={audioRef} src={audioSource} onEnded={handleLocalEnded} />

      <section className="main-stage">
        <header className="topbar">
          <form className="search" onSubmit={runSearch}>
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={browseMode === 'playlists' ? 'Search playlists' : 'Search tracks or filter artists'}
            />
            {query && (
              <button type="button" title="Clear search" onClick={() => setQuery('')}>
                <X size={16} />
              </button>
            )}
          </form>
          <div className="topbar-actions">
            <button className="icon-button settings-trigger" title="Settings" onClick={() => setSettingsOpen(true)}>
              <Settings size={19} />
            </button>
          </div>
        </header>

        <section className="now-row">
          <div className={heroArt ? 'album-hero' : 'album-hero logo-hero'}>
            {heroArt ? <img src={heroArt} alt="" loading="eager" decoding="async" /> : <img src={logoMark} alt="" loading="eager" decoding="async" />}
          </div>
          <div className="now-copy">
            <span className="kicker"><Radio size={15} /> {heroSelection.kicker}</span>
            <h2>{heroSelection.title}</h2>
            <p>{heroSelection.subtitle}</p>
            <div className="quick-actions">
              <button className="primary" onClick={() => togglePlayback({ preferSelection: true })}>
                {heroPlayButtonShowsPause ? <Pause size={18} /> : <Play size={18} />}
                {heroPlayButtonShowsPause ? 'Pause' : 'Play'}
              </button>
              <button className={shuffle ? 'toggle active' : 'toggle'} onClick={toggleShuffle} title="Shuffle queue">
                <Shuffle size={18} />
              </button>
              <button
                className={repeat !== 'off' ? 'toggle active' : 'toggle'}
                onClick={cycleRepeat}
                title={`Repeat ${repeat}`}
              >
                <Repeat size={18} />
              </button>
            </div>
          </div>
        </section>

        <section
          className={browseMode === 'playlists' ? 'browser-grid playlist-mode' : 'browser-grid'}
          data-mobile-panel={mobilePanel}
          onTouchStart={handleMobileTouchStart}
          onTouchEnd={handleMobileTouchEnd}
        >
          <Panel
            title={browseMode === 'playlists' ? 'Playlists' : 'Artists'}
            icon={browseMode === 'playlists' ? <ListMusic size={17} /> : <Star size={17} />}
            className={mobilePanel === 'list' ? 'mobile-panel list-panel active' : 'mobile-panel list-panel'}
          >
            <div className="mode-tabs">
              <button className={browseMode === 'artists' ? 'active' : ''} onClick={() => showMobileList('artists')}>Artists</button>
              <button className={browseMode === 'playlists' ? 'active' : ''} onClick={() => showMobileList('playlists')}>Playlists</button>
            </div>
            <div className="scroll-list">
              {browseMode === 'artists' && !filteredArtists.length && (
                <span className="empty list-empty">{connected ? 'No artists found.' : 'Connect Plex to load artists.'}</span>
              )}
              {browseMode === 'artists' && filteredArtists.map((artist) => (
                  <button
                    key={artist.ratingKey || artist.key}
                    className={selectedArtist?.ratingKey === artist.ratingKey ? 'row active' : 'row'}
                    onClick={() => chooseArtist(artist)}
                  >
                    <span>{artist.title}</span>
                  </button>
                ))}
              {browseMode === 'playlists' && filteredPlaylists.map((playlist) => (
                  <button
                    key={playlist.ratingKey || playlist.key}
                    className={selectedPlaylist?.ratingKey === playlist.ratingKey ? 'row active' : 'row'}
                    onClick={() => choosePlaylist(playlist)}
                  >
                    <span>{playlist.title}</span>
                    <small>{playlist.leafCount || 0} tracks</small>
                  </button>
                ))}
              {browseMode === 'playlists' && !filteredPlaylists.length && (
                <span className="empty list-empty">No playlists found.</span>
              )}
            </div>
          </Panel>

          {browseMode === 'artists' && (
            <Panel
              title="Albums"
              icon={<Album size={17} />}
              className={mobilePanel === 'albums' ? 'mobile-panel albums-panel active' : 'mobile-panel albums-panel'}
              onBack={goBackMobilePanel}
            >
              <div className="album-grid">
                {!visibleAlbums.length && (
                  <div className="empty-state">Select an artist to load albums.</div>
                )}
                {visibleAlbums.slice(0, 40).map((album) => (
                  <button
                    key={album.ratingKey || album.key}
                    className={selectedAlbum?.ratingKey === album.ratingKey ? 'album-card active' : 'album-card'}
                    onClick={() => chooseAlbum(album)}
                  >
                    {coverUrl(album, 260) ? <img src={coverUrl(album, 260)} alt="" loading="lazy" decoding="async" /> : <div className={artClass(album.title)}><Disc3 size={34} /></div>}
                    <strong>{album.title}</strong>
                    <span>{album.parentTitle || selectedArtist?.title || yearFrom(album)} {yearFrom(album) ? `· ${yearFrom(album)}` : ''}</span>
                  </button>
                ))}
              </div>
            </Panel>
          )}

          <Panel
            title="Tracks"
            icon={<ListMusic size={17} />}
            className={mobilePanel === 'tracks' ? 'mobile-panel tracks-panel active' : 'mobile-panel tracks-panel'}
            onBack={goBackMobilePanel}
          >
            <div
              className="track-list virtualized"
              ref={trackListRef}
              onScroll={(event) => setTrackScrollTop(event.currentTarget.scrollTop)}
            >
              {!tracks.length && (
                <div className="empty-state">{browseMode === 'playlists' ? 'Select a playlist to load songs.' : 'Select an album to load songs.'}</div>
              )}
              {!!tracks.length && (
                <div className="track-spacer" style={{ height: virtualTracks.totalHeight }}>
                  <div className="track-window" style={{ transform: `translateY(${virtualTracks.topOffset}px)` }}>
                    {virtualTracks.rows.map(({ track, index }) => (
                      <div
                        key={track.ratingKey || track.key || `${track.title}-${index}`}
                        className={[
                          'track-row',
                          currentTrack && trackIdentity(currentTrack) === trackIdentity(track) ? 'active' : '',
                          selectedTrack && trackIdentity(selectedTrack) === trackIdentity(track) ? 'selected' : '',
                        ].filter(Boolean).join(' ')}
                      >
                        <button
                          className="track-play-target"
                          onClick={() => setSelectedTrack(track)}
                          onDoubleClick={() => playQueue(tracks, track)}
                        >
                          <span className="track-index">{track.index || index + 1}</span>
                          <span className="track-main">
                            <strong>{track.title}</strong>
                            <small>{track.grandparentTitle || track.parentTitle || 'Unknown artist'}</small>
                          </span>
                        </button>
                        <span>{durationLabel(track.duration)}</span>
                        <span className="track-actions">
                          <button
                            className="track-action"
                            title="Add to queue"
                            onClick={() => addTrackToQueue(track)}
                          >
                            <Plus size={18} />
                          </button>
                          <button
                            className="track-action"
                            title="Add to playlist"
                            onClick={() => {
                              setPlaylistPickerTrack(track);
                              setQueueOpen(false);
                              setCastOpen(false);
                            }}
                          >
                            <ListPlus size={17} />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </section>
      </section>

      {castVolumeOverlay && selectedCastDevice && (
        <div className="cast-volume-overlay" role="status" aria-live="polite">
          <div className="cast-volume-icon">
            <Cast size={22} />
          </div>
          <strong>{castVolumeOverlay.device}</strong>
          <div className="cast-volume-meter" aria-label={`Cast volume ${Math.round(castVolumeOverlay.volume * 100)} percent`}>
            <span style={{ width: `${Math.round(castVolumeOverlay.volume * 100)}%` }} />
          </div>
        </div>
      )}

      <footer className="transport">
        <div className="mini-track">
          {currentTrack && coverUrl(currentTrack)
            ? <img className="mini-cover" src={coverUrl(currentTrack, 96)} alt="" loading="eager" decoding="async" />
            : <div className={artClass(currentTrack?.parentTitle)}><Disc3 size={25} /></div>}
          <div>
            <strong>{currentTrack?.title || 'Nothing loaded'}</strong>
            {currentTrack ? (
              <button
                className="mini-artist-button"
                type="button"
                title={`Go to ${currentTrack.grandparentTitle || currentTrack.parentTitle}`}
                onClick={() => navigateToTrackArtist(currentTrack)}
              >
                {currentTrack.grandparentTitle || currentTrack.parentTitle || 'Unknown artist'}
              </button>
            ) : (
              <span>Connect Plex to load music</span>
            )}
          </div>
        </div>
        <div className="transport-center">
          <div className="transport-buttons">
            <button className="icon-button" title="Previous" onClick={() => previousTrack(true)}><SkipBack size={20} /></button>
            <button className="play-button" title="Play/Pause" onClick={togglePlayback}>
              {transportPlayButtonShowsPause ? <Pause size={22} /> : <Play size={22} />}
            </button>
            <button className="icon-button" title="Next" onClick={() => nextTrack(false, true)}><SkipForward size={20} /></button>
          </div>
          <div className="timeline">
            <span>{durationLabel(progress * 1000)}</span>
            <input type="range" min="0" max={duration || 1} value={Math.min(progress, duration || 1)} onChange={(event) => seek(event.target.value)} />
            <span>{durationLabel((duration || currentTrack?.duration / 1000 || 0) * 1000)}</span>
          </div>
        </div>
        <div className="right-controls">
          <div className="queue-menu">
            <button
              className={queueOpen ? 'icon-button queue-trigger active' : 'icon-button queue-trigger'}
              title="Show queue"
              onClick={() => {
                setQueueOpen(!queueOpen);
                setCastOpen(false);
              }}
            >
              <ListMusic size={19} />
            </button>
            {queueOpen && (
              <div className="queue-popover">
                <div className="queue-popover-head">
                  <div>
                    <strong>Queue</strong>
                    <span>{queue.length ? (currentIndex >= 0 ? `${Math.max(queue.length - currentIndex - 1, 0)} up next` : `${queue.length} ready`) : 'Empty'}</span>
                  </div>
                  <button className="queue-clear" onClick={clearUpcomingQueue} disabled={!queue.length || (currentIndex >= queue.length - 1 && currentIndex >= 0)}>
                    Clear
                  </button>
                </div>
                <div className="queue-list">
                  {queue.map((track, index) => (
                    <div
                      key={track.ratingKey || track.key || `${track.title}-${index}`}
                      className={[
                        'queue-item',
                        index === currentIndex ? 'active' : '',
                        draggedQueueIndex === index ? 'dragging' : '',
                      ].filter(Boolean).join(' ')}
                      onDragOver={(event) => {
                        if (draggedQueueIndex === null || index === currentIndex) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        dropQueueItem(index);
                      }}
                      onDragEnd={() => setDraggedQueueIndex(null)}
                    >
                      <button
                        className="queue-play-target"
                        draggable={index !== currentIndex}
                        onDragStart={(event) => {
                          if (index === currentIndex) {
                            event.preventDefault();
                            return;
                          }
                          setDraggedQueueIndex(index);
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', String(index));
                        }}
                        onClick={() => jumpToQueueItem(index)}
                      >
                        <span className="queue-position">{index === currentIndex ? 'Now' : index < currentIndex ? 'Played' : currentIndex < 0 ? index + 1 : index - currentIndex}</span>
                        <span className="queue-copy">
                          <strong>{track.title}</strong>
                          <small>{track.grandparentTitle || track.parentTitle || 'Unknown artist'}</small>
                        </span>
                      </button>
                      <span>{durationLabel(track.duration)}</span>
                      {index !== currentIndex ? (
                        <span className="queue-actions">
                          <button className="queue-action remove" title="Remove from queue" onClick={() => removeFromQueue(index)}>
                            <X size={15} />
                          </button>
                        </span>
                      ) : (
                        <span className="queue-now-dot" aria-hidden="true" />
                      )}
                    </div>
                  ))}
                  {!queue.length && <span className="empty">No tracks queued.</span>}
                </div>
              </div>
            )}
          </div>
          <div className="cast-menu">
            <button
              className={castOpen || selectedCastDevice ? 'icon-button cast-trigger active' : 'icon-button cast-trigger'}
              title={selectedCastDevice ? `Cast: ${selectedCastDevice.friendlyName || selectedCastDevice.name}` : 'Cast to device'}
              onClick={() => {
                setQueueOpen(false);
                toggleCastMenu();
              }}
            >
              <Cast size={19} />
            </button>
            {castOpen && (
              <div className="cast-popover">
                <div className="cast-popover-head">
                  <strong>Cast</strong>
                  <div className="cast-head-actions">
                    <button className="icon-button tiny" title="Rescan for cast devices" onClick={rescanCastDevices} disabled={castScanning}>
                      <RefreshCcw className={castScanning ? 'spin' : ''} size={15} />
                    </button>
                    <button className="icon-button tiny" title="Close cast menu" onClick={() => setCastOpen(false)}>
                      <X size={15} />
                    </button>
                  </div>
                </div>
                <p>{castSupported ? castStatus : 'Chromecast support is not available in this build yet.'}</p>
                <div className="device-list">
                  <button
                    className={!selectedCastDevice ? 'active' : ''}
                    onClick={castToThisDevice}
                  >
                    <Volume2 size={16} />
                    This Device
                  </button>
                  {castDevices.map((device) => (
                    <button
                      key={device.id || device.host || device.name}
                      className={selectedCastDevice?.id === device.id ? 'active' : ''}
                      onClick={() => castToDevice(device)}
                    >
                      <Airplay size={16} />
                      {device.friendlyName || device.name}
                    </button>
                  ))}
                  {!castDevices.length && <span className="empty">No devices discovered yet.</span>}
                </div>
              </div>
            )}
          </div>
          <div className="volume">
            <Volume2 size={19} />
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(event) => changeVolume(event.target.value)}
            />
          </div>
        </div>
      </footer>

      {settingsOpen && (
        <div className="modal-layer" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="settings-head">
              <div>
                <span className="kicker"><Settings size={15} /> Settings</span>
                <h2 id="settings-title">Settings</h2>
              </div>
              <button className="icon-button" title="Close settings" onClick={() => setSettingsOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <section className="settings-section">
              <span className="settings-label">Theme</span>
              <div className="theme-toggle" role="group" aria-label="Theme">
                <button className={theme === 'dark' ? 'active' : ''} onClick={() => updateTheme('dark')}>Dark</button>
                <button className={theme === 'light' ? 'active' : ''} onClick={() => updateTheme('light')}>Light</button>
              </div>
            </section>

            <section className="settings-section setting-row">
              <div>
                <span className="settings-label">Match Volume</span>
                <small>Keep quieter and louder songs closer in level.</small>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={matchVolume}
                  onChange={(event) => updateMatchVolume(event.target.checked)}
                />
                <span />
              </label>
            </section>

            <section className="settings-section">
              <span className="settings-label">Plex account</span>
              <button className="primary plex-login-button" type="button" onClick={signInWithPlex} disabled={loading || plexLoginPending}>
                {plexLoginPending ? <Loader2 className="spin" size={17} /> : <Wifi size={17} />}
                {plexLoginPending ? `Waiting for Plex${plexLoginCode ? ` (${plexLoginCode})` : ''}` : plexAccountToken ? 'Sign in again' : 'Sign in with Plex'}
              </button>
              {plexAccountToken && !plexServers.length && (
                <button className="secondary" type="button" onClick={findPlexServers} disabled={loading || plexLoginPending}>
                  {loading ? <Loader2 className="spin" size={17} /> : <RefreshCcw size={17} />}
                  Find servers
                </button>
              )}
              {plexServers.length > 0 && (
                <div className="plex-server-picker">
                  <div className="select-wrap">
                    <select
                      value={selectedPlexServerId}
                      onChange={(event) => selectPlexServer(event.target.value)}
                      disabled={loading}
                    >
                      <option value="" disabled>Choose a server</option>
                      {plexServers.map((server) => (
                        <option key={server.id} value={server.id}>
                          {connectingPlexServerId === server.id ? `Loading ${server.name}...` : server.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={16} />
                  </div>
                </div>
              )}
            </section>

            <form className="connect manual-plex-connect" onSubmit={connectToPlex}>
              <label>
                Plex server
                <input
                  value={serverUrl}
                  onChange={(event) => setServerUrl(event.target.value)}
                  placeholder="http://192.168.1.10:32400"
                />
              </label>
              <label>
                Token
                <input
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="X-Plex-Token"
                  type="password"
                />
              </label>
              <button className="primary" type="submit" disabled={loading || !serverUrl || !token}>
                {loading ? <Loader2 className="spin" size={17} /> : <Wifi size={17} />}
                Connect
              </button>
            </form>

            <div className="library-tools settings-library-tools">
              <div className="select-wrap">
                <select
                  value={effectiveLibraryKey}
                  onChange={(event) => {
                    setLibraryKey(event.target.value);
                    refreshLibrary(event.target.value);
                  }}
                  disabled={loading || !libraries.length}
                >
                  {!libraries.length && (
                    <option value={effectiveLibraryKey}>
                      {loading ? 'Loading libraries...' : connected && effectiveLibraryKey ? 'Current library' : 'No library selected'}
                    </option>
                  )}
                  {libraries.map((library) => (
                    <option key={library.key} value={library.key}>{library.title}</option>
                  ))}
                </select>
                <ChevronDown size={16} />
              </div>
              <button className="icon-button" title="Refresh library" onClick={() => refreshLibrary()} disabled={!connected}>
                <RefreshCcw size={18} />
              </button>
            </div>
          </section>
        </div>
      )}

      {playlistPickerTrack && (
        <div className="modal-layer" role="presentation" onMouseDown={() => setPlaylistPickerTrack(null)}>
          <section className="playlist-modal" role="dialog" aria-modal="true" aria-labelledby="playlist-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="settings-head">
              <div>
                <span className="kicker"><ListPlus size={15} /> Add to playlist</span>
                <h2 id="playlist-title">{playlistPickerTrack.title}</h2>
              </div>
              <button className="icon-button" title="Close playlist picker" onClick={() => setPlaylistPickerTrack(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="playlist-picker-list">
              {playlists.map((playlist) => {
                const playlistId = playlist.ratingKey || playlist.key || playlist.title;
                const isAdding = addingToPlaylist === playlistId;
                return (
                  <button key={playlistId} onClick={() => addTrackToPlaylist(playlist)} disabled={Boolean(addingToPlaylist)}>
                    <span>
                      <strong>{playlist.title}</strong>
                      <small>{playlist.leafCount || 0} tracks</small>
                    </span>
                    {isAdding ? <Loader2 className="spin" size={17} /> : <ListPlus size={17} />}
                  </button>
                );
              })}
              {!playlists.length && (
                <div className="empty-state">No audio playlists found.</div>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function Panel({
  title,
  icon,
  children,
  className = '',
  onBack,
}) {
  return (
    <section className={['panel', className].filter(Boolean).join(' ')}>
      <div className="panel-head">
        {onBack && (
          <button className="panel-back" type="button" title="Back" onClick={onBack}>
            <ChevronLeft size={18} />
          </button>
        )}
        {icon}
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
