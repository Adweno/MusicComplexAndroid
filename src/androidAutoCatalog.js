import { trackIdentity, shuffleTracks } from './playbackLogic';

export const ROOT_PLAYLISTS = 'root:playlists';
export const ROOT_ARTISTS = 'root:artists';
export const ROOT_ALBUMS = 'root:albums';
export const ROOT_SONGS = 'root:songs';
const TRACK_PARENT_SEPARATOR = '|parent=';

function keyFor(item = {}) {
  return String(item.ratingKey || item.key || item.guid || item.title || '');
}

function titleFor(item = {}, fallback = 'Untitled') {
  return String(item.title || item.titleSort || fallback);
}

function trackArtist(track = {}) {
  return track.grandparentTitle || track.parentTitle || 'Unknown artist';
}

function trackAlbum(track = {}) {
  return track.parentTitle || 'Unknown album';
}

function trackAlbumKey(track = {}) {
  return String(track.parentRatingKey || track.parentKey || trackAlbum(track));
}

function trackArtistKey(track = {}) {
  return String(track.grandparentRatingKey || track.grandparentKey || trackArtist(track));
}

function artistCatalogKeyForTrack(track = {}, artists = []) {
  const artistTitle = trackArtist(track);
  const artist = artists.find((candidate) => titleFor(candidate, 'Artist') === artistTitle);
  return keyFor(artist) || trackArtistKey(track);
}

function uniqueBy(items, keyFn) {
  const seen = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (key && !seen.has(key)) seen.set(key, item);
  });
  return [...seen.values()];
}

export function autoMediaId(type, id) {
  return `${type}:${encodeURIComponent(String(id || ''))}`;
}

export function parseAutoMediaId(mediaId = '') {
  const [type, ...rest] = String(mediaId).split(':');
  if (!type || !rest.length) return { type: '', id: '' };
  return { type, id: decodeURIComponent(rest.join(':')) };
}

export function buildAndroidAutoCatalog({
  artists = [],
  playlists = [],
  albums = [],
  tracks = [],
  queue = [],
  currentTrack = null,
  playlistTracksById = {},
} = {}) {
  const playlistEntries = Object.entries(playlistTracksById || {});
  const playlistTracks = playlistEntries.flatMap(([, playlistTrackList]) => playlistTrackList || []);
  const allTracks = uniqueBy([...tracks, ...queue, ...playlistTracks].filter(Boolean), trackIdentity);
  const albumItemsById = new Map();
  [
    ...albums,
    ...allTracks.map((track) => ({
      ratingKey: track.parentRatingKey || track.parentKey || trackAlbum(track),
      key: track.parentKey,
      title: trackAlbum(track),
      parentTitle: trackArtist(track),
      parentRatingKey: track.grandparentRatingKey || track.grandparentKey || trackArtist(track),
      thumb: track.parentThumb || track.thumb,
    })),
  ].forEach((album) => {
    const identity = keyFor(album) || `${album.parentTitle}:${album.title}`;
    if (!identity) return;
    const existing = albumItemsById.get(identity);
    albumItemsById.set(identity, existing ? { ...album, ...existing, parentRatingKey: existing.parentRatingKey || album.parentRatingKey } : album);
  });
  const albumItems = [...albumItemsById.values()];

  return {
    current: currentTrack ? autoTrackPayload(currentTrack) : null,
    roots: [
      { id: ROOT_ARTISTS, title: 'Artists', subtitle: `${artists.length} artists`, browsable: true, playable: false },
      { id: ROOT_PLAYLISTS, title: 'Playlists', subtitle: `${playlists.length} playlists`, browsable: true, playable: false },
    ],
    playlists: playlists.map((playlist) => ({
      id: autoMediaId('playlist', keyFor(playlist)),
      title: titleFor(playlist, 'Playlist'),
      subtitle: playlist.leafCount ? `${playlist.leafCount} tracks` : 'Playlist',
      artwork: playlist.composite || playlist.thumb || '',
      key: playlist.key || (playlist.ratingKey ? `/playlists/${playlist.ratingKey}/items` : ''),
      leafCount: Number(playlist.leafCount || 0),
      playable: false,
      browsable: true,
    })),
    artists: artists.map((artist) => ({
      id: autoMediaId('artist', keyFor(artist)),
      title: titleFor(artist, 'Artist'),
      subtitle: 'Artist',
      artwork: artist.thumb || '',
      key: artist.key || (artist.ratingKey ? `/library/metadata/${artist.ratingKey}/children` : ''),
      playable: false,
      browsable: true,
    })),
    albums: albumItems.map((album) => ({
      id: autoMediaId('album', keyFor(album) || `${album.parentTitle}:${album.title}`),
      title: titleFor(album, 'Album'),
      subtitle: album.parentTitle || 'Album',
      artwork: album.thumb || '',
      key: album.key || (album.ratingKey ? `/library/metadata/${album.ratingKey}/children` : ''),
      parentId: autoMediaId('artist', album.parentRatingKey || album.parentKey || album.parentTitle || 'Unknown artist'),
      playable: false,
      browsable: true,
    })),
    songs: [
      ...allTracks.map((track) => autoTrackPayload(track, { parentId: autoMediaId('artist', artistCatalogKeyForTrack(track, artists)) })),
      ...allTracks
        .filter((track) => artistCatalogKeyForTrack(track, artists) !== trackArtist(track))
        .map((track) => autoTrackPayload(track, { parentId: autoMediaId('artist', trackArtist(track)) })),
      ...allTracks.map((track) => autoTrackPayload(track, { parentId: autoMediaId('album', trackAlbumKey(track)) })),
      ...playlistEntries.flatMap(([playlistId, playlistTrackList]) => (
        (playlistTrackList || []).map((track) => autoTrackPayload(track, { parentId: autoMediaId('playlist', playlistId) }))
      )),
    ],
  };
}

export function autoTrackPayload(track, extra = {}) {
  const trackId = extra.parentId
    ? `${trackIdentity(track)}${TRACK_PARENT_SEPARATOR}${extra.parentId}`
    : trackIdentity(track);
  return {
    id: autoMediaId('track', trackId),
    sourceId: trackIdentity(track),
    title: titleFor(track, 'Track'),
    subtitle: trackArtist(track),
    album: trackAlbum(track),
    artwork: track.thumb || track.parentThumb || track.grandparentThumb || '',
    duration: track.duration || 0,
    playable: true,
    browsable: false,
    ...extra,
  };
}

export function attachPlayableUrlsToCatalog(catalog, tracks = [], playableUrl, artworkUrl = null) {
  if (!catalog || !Array.isArray(catalog.songs) || typeof playableUrl !== 'function') return catalog;
  const tracksById = new Map(tracks.filter(Boolean).map((track) => [trackIdentity(track), track]));
  const resolveArtwork = (artwork) => (
    typeof artworkUrl === 'function' && artwork
      ? artworkUrl(artwork)
      : artwork
  );
  const resolveRows = (rows = []) => rows.map((row) => ({
    ...row,
    artwork: resolveArtwork(row.artwork || ''),
  }));
  return {
    ...catalog,
    current: catalog.current
      ? { ...catalog.current, artwork: resolveArtwork(catalog.current.artwork || '') }
      : catalog.current,
    playlists: resolveRows(catalog.playlists),
    artists: resolveRows(catalog.artists),
    albums: resolveRows(catalog.albums),
    songs: catalog.songs.map((song) => {
      const sourceTrack = tracksById.get(song.sourceId);
      return {
        ...song,
        artwork: resolveArtwork(song.artwork || ''),
        ...(sourceTrack ? { url: playableUrl(sourceTrack) } : {}),
      };
    }),
  };
}

function parseTrackTarget(identity = '') {
  const [trackId, parentId = ''] = String(identity).split(TRACK_PARENT_SEPARATOR);
  return { trackId, parentId };
}

function playlistTracksFor({ identity, playlistTracksById = {} }) {
  return playlistTracksById[identity] || playlistTracksById[String(identity)] || [];
}

function tracksForParent(parentId, { tracks = [], playlistTracksById = {}, artists = [] }) {
  if (parentId === ROOT_SONGS) return tracks.filter(Boolean);

  const parsedParent = parseAutoMediaId(parentId);
  if (parsedParent.type === 'album') {
    return tracks.filter((track) => (
      trackAlbumKey(track) === parsedParent.id
      || trackAlbum(track) === parsedParent.id
    ));
  }

  if (parsedParent.type === 'artist') {
    const artist = artists.find((candidate) => keyFor(candidate) === parsedParent.id || titleFor(candidate) === parsedParent.id);
    const artistTitle = artist?.title || parsedParent.id;
    return tracks.filter((track) => (
      artistCatalogKeyForTrack(track, artists) === parsedParent.id
      || trackArtistKey(track) === parsedParent.id
      || trackArtist(track) === artistTitle
    ));
  }

  if (parsedParent.type === 'playlist') {
    return playlistTracksFor({ identity: parsedParent.id, playlistTracksById }).filter(Boolean);
  }

  return [];
}

export function chooseAutoPlaybackTarget({
  mediaId,
  tracks = [],
  artists = [],
  playlists = [],
  albums = [],
  playlistTracksById = {},
  shuffled = false,
  random = Math.random,
}) {
  const parsed = parseAutoMediaId(mediaId);
  const allTracks = tracks.filter(Boolean);
  const identity = parsed.id;

  if (parsed.type === 'shuffle') {
    const visibleTracks = tracksForParent(identity, { tracks: allTracks, playlistTracksById, artists });
    if (!visibleTracks.length) {
      const parent = parseAutoMediaId(identity);
      if (parent.type === 'playlist') {
        const playlist = playlists.find((candidate) => keyFor(candidate) === parent.id || titleFor(candidate) === parent.id);
        return playlist ? { kind: 'playlist', item: playlist, needsLoad: true, shuffled: true } : null;
      }
      return null;
    }
    const nextTracks = shuffleTracks(visibleTracks, random);
    return {
      kind: 'shuffle',
      tracks: nextTracks,
      track: nextTracks[0],
    };
  }

  if (parsed.type === 'track') {
    const { trackId, parentId } = parseTrackTarget(identity);
    const visibleTracks = parentId
      ? tracksForParent(parentId, { tracks: allTracks, playlistTracksById, artists })
      : allTracks;
    const queueTracks = visibleTracks.length ? visibleTracks : allTracks;
    const track = queueTracks.find((candidate) => trackIdentity(candidate) === trackId)
      || allTracks.find((candidate) => trackIdentity(candidate) === trackId);
    return track ? { kind: 'track', tracks: queueTracks, track } : null;
  }

  if (parsed.type === 'artist') {
    const artist = artists.find((candidate) => keyFor(candidate) === identity || titleFor(candidate) === identity);
    const artistTitle = artist?.title || identity;
    const artistTracks = allTracks.filter((track) => trackArtist(track) === artistTitle);
    if (!artistTracks.length) return { kind: 'artist', item: artist || { title: artistTitle }, needsLoad: true };
    const nextTracks = shuffled ? shuffleTracks(artistTracks, random) : artistTracks;
    return {
      kind: 'artist',
      item: artist || { title: artistTitle },
      tracks: nextTracks,
      track: nextTracks[0],
    };
  }

  if (parsed.type === 'album') {
    const album = albums.find((candidate) => keyFor(candidate) === identity || titleFor(candidate) === identity);
    const albumTitle = album?.title || identity;
    const albumTracks = allTracks.filter((track) => trackAlbum(track) === albumTitle || track.parentRatingKey === identity || track.parentKey === identity);
    if (!albumTracks.length) return { kind: 'album', item: album || { title: albumTitle }, needsLoad: true };
    const nextTracks = shuffled ? shuffleTracks(albumTracks, random) : albumTracks;
    return {
      kind: 'album',
      item: album || { title: albumTitle },
      tracks: nextTracks,
      track: nextTracks[0],
    };
  }

  if (parsed.type === 'playlist') {
    const playlist = playlists.find((candidate) => keyFor(candidate) === identity || titleFor(candidate) === identity);
    const nextTracks = playlistTracksFor({ identity, playlistTracksById });
    if (playlist && nextTracks.length) {
      const playableTracks = shuffled ? shuffleTracks(nextTracks, random) : nextTracks;
      return { kind: 'playlist', item: playlist, tracks: playableTracks, track: playableTracks[0] };
    }
    return playlist ? { kind: 'playlist', item: playlist, needsLoad: true } : null;
  }

  return null;
}
