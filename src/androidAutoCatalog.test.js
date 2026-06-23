import { describe, expect, it } from 'vitest';
import {
  attachPlayableUrlsToCatalog,
  autoMediaId,
  buildAndroidAutoCatalog,
  chooseAutoPlaybackTarget,
  parseAutoMediaId,
} from './androidAutoCatalog';

const artists = [
  { ratingKey: 'artist-a', title: 'The Signals' },
  { ratingKey: 'artist-b', title: 'Night Relay' },
];

const playlists = [
  { ratingKey: 'playlist-1', title: 'Road Mix', leafCount: 2 },
];

const albums = [
  { ratingKey: 'album-1', title: 'Static Bloom', parentTitle: 'The Signals', parentRatingKey: 'artist-a' },
];

const tracks = [
  {
    ratingKey: 'track-1',
    title: 'First Light',
    grandparentTitle: 'The Signals',
    parentTitle: 'Static Bloom',
    parentRatingKey: 'album-1',
    duration: 180000,
  },
  {
    ratingKey: 'track-2',
    title: 'Exit Ramp',
    grandparentTitle: 'The Signals',
    parentTitle: 'Static Bloom',
    parentRatingKey: 'album-1',
    duration: 210000,
  },
  {
    ratingKey: 'track-3',
    title: 'After Hours',
    grandparentTitle: 'Night Relay',
    parentTitle: 'Late Map',
    parentRatingKey: 'album-2',
    duration: 190000,
  },
];

describe('Android Auto catalog', () => {
  it('builds browsable roots and nested library items from the phone app state', () => {
    const catalog = buildAndroidAutoCatalog({
      artists,
      playlists,
      albums,
      tracks,
      playlistTracksById: {
        'playlist-1': [tracks[1], tracks[2]],
      },
    });

    expect(catalog.roots.map((item) => item.title)).toEqual(['Artists', 'Playlists']);
    expect(catalog.playlists[0]).toMatchObject({ title: 'Road Mix', playable: false, browsable: true });
    expect(catalog.playlists[0]).toMatchObject({ leafCount: 2, key: '/playlists/playlist-1/items' });
    expect(catalog.artists[0]).toMatchObject({ title: 'The Signals', playable: false, browsable: true });
    expect(catalog.albums.find((album) => album.title === 'Static Bloom')).toMatchObject({
      browsable: true,
      parentId: autoMediaId('artist', 'artist-a'),
    });
    expect(catalog.songs.filter((song) => song.parentId === autoMediaId('artist', 'artist-a'))).toHaveLength(2);
    expect(catalog.songs.filter((song) => song.parentId === autoMediaId('playlist', 'playlist-1'))).toHaveLength(2);
    expect(catalog.songs.find((song) => song.title === 'First Light')).toMatchObject({
      sourceId: 'track-1',
      duration: 180000,
    });
  });

  it('round-trips media ids with special characters', () => {
    const mediaId = autoMediaId('playlist', 'Fresh & Weird/Good');

    expect(parseAutoMediaId(mediaId)).toEqual({
      type: 'playlist',
      id: 'Fresh & Weird/Good',
    });
  });

  it('resolves a selected track to a playback target from its visible parent list', () => {
    const catalog = buildAndroidAutoCatalog({ artists, playlists, albums, tracks });
    const albumSong = catalog.songs.find((song) => (
      song.title === 'Exit Ramp'
      && song.parentId === autoMediaId('album', 'album-1')
    ));
    const target = chooseAutoPlaybackTarget({
      mediaId: albumSong.id,
      tracks,
      artists,
      playlists,
      albums,
    });

    expect(target.kind).toBe('track');
    expect(target.track.title).toBe('Exit Ramp');
    expect(target.tracks.map((track) => track.title)).toEqual(['First Light', 'Exit Ramp']);
  });

  it('resolves an artist to that artist queue when tracks are available', () => {
    const target = chooseAutoPlaybackTarget({
      mediaId: autoMediaId('artist', 'artist-a'),
      tracks,
      artists,
      playlists,
      albums,
    });

    expect(target.kind).toBe('artist');
    expect(target.tracks.map((track) => track.title)).toEqual(['First Light', 'Exit Ramp']);
  });

  it('resolves prefetched playlist tracks to a playback target', () => {
    const target = chooseAutoPlaybackTarget({
      mediaId: autoMediaId('playlist', 'playlist-1'),
      tracks,
      artists,
      playlists,
      albums,
      playlistTracksById: {
        'playlist-1': [tracks[1], tracks[2]],
      },
    });

    expect(target.kind).toBe('playlist');
    expect(target.tracks.map((track) => track.title)).toEqual(['Exit Ramp', 'After Hours']);
  });

  it('marks playlists as needing async phone-side load when tracks are not prefetched', () => {
    const target = chooseAutoPlaybackTarget({
      mediaId: autoMediaId('playlist', 'playlist-1'),
      tracks,
      artists,
      playlists,
      albums,
    });

    expect(target).toMatchObject({
      kind: 'playlist',
      needsLoad: true,
      item: { title: 'Road Mix' },
    });
  });

  it('shuffles the visible song list for an album parent', () => {
    const target = chooseAutoPlaybackTarget({
      mediaId: autoMediaId('shuffle', autoMediaId('album', 'album-1')),
      tracks,
      artists,
      playlists,
      albums,
      random: () => 0,
    });

    expect(target.kind).toBe('shuffle');
    expect(target.tracks.map((track) => track.title).sort()).toEqual(['Exit Ramp', 'First Light']);
  });

  it('shuffles all songs for an artist parent', () => {
    const target = chooseAutoPlaybackTarget({
      mediaId: autoMediaId('shuffle', autoMediaId('artist', 'artist-a')),
      tracks,
      artists,
      playlists,
      albums,
      random: () => 0,
    });

    expect(target.kind).toBe('shuffle');
    expect(target.tracks.map((track) => track.title).sort()).toEqual(['Exit Ramp', 'First Light']);
  });

  it('attaches playable urls to catalog song rows by source id', () => {
    const catalog = buildAndroidAutoCatalog({ artists, playlists, albums, tracks });
    const withUrls = attachPlayableUrlsToCatalog(catalog, tracks, (track) => `/stream/${track.ratingKey}`);

    expect(withUrls).not.toBe(catalog);
    expect(withUrls.songs.find((song) => song.sourceId === 'track-2')).toMatchObject({
      title: 'Exit Ramp',
      url: '/stream/track-2',
    });
  });

  it('resolves relative artwork before sending catalog rows to Android Auto', () => {
    const catalog = {
      playlists: [{ id: 'playlist:1', title: 'Road Mix', artwork: '/playlist/thumb' }],
      artists: [{ id: 'artist:1', title: 'The Signals', artwork: '/artist/thumb' }],
      albums: [{ id: 'album:1', title: 'Static Bloom', artwork: '/album/thumb' }],
      songs: [{ id: 'track:1', sourceId: 'track-1', title: 'First Light', artwork: '/track/thumb' }],
    };

    const withUrls = attachPlayableUrlsToCatalog(
      catalog,
      tracks,
      (track) => `/stream/${track.ratingKey}`,
      (path) => `https://plex.local/photo?url=${encodeURIComponent(path)}`,
    );

    expect(withUrls.playlists[0].artwork).toBe('https://plex.local/photo?url=%2Fplaylist%2Fthumb');
    expect(withUrls.artists[0].artwork).toBe('https://plex.local/photo?url=%2Fartist%2Fthumb');
    expect(withUrls.albums[0].artwork).toBe('https://plex.local/photo?url=%2Falbum%2Fthumb');
    expect(withUrls.songs[0]).toMatchObject({
      artwork: 'https://plex.local/photo?url=%2Ftrack%2Fthumb',
      url: '/stream/track-1',
    });
  });

  it('leaves catalog rows alone when a source track is missing', () => {
    const catalog = {
      songs: [{ id: 'track:missing', sourceId: 'missing', title: 'Ghost Track' }],
    };

    expect(attachPlayableUrlsToCatalog(catalog, tracks, (track) => `/stream/${track.ratingKey}`).songs[0])
      .toMatchObject(catalog.songs[0]);
    expect(attachPlayableUrlsToCatalog(catalog, tracks, (track) => `/stream/${track.ratingKey}`).songs[0].url)
      .toBeUndefined();
  });
});
