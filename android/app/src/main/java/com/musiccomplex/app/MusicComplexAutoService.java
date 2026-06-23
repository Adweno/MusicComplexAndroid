package com.musiccomplex.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.media.audiofx.AutomaticGainControl;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.Xml;

import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.Timeline;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.LibraryResult;
import androidx.media3.session.MediaLibraryService;
import androidx.media3.session.MediaSession;

import com.getcapacitor.JSObject;
import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.SettableFuture;

import org.json.JSONArray;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.StringReader;

@UnstableApi
public class MusicComplexAutoService extends MediaLibraryService {
    private static final String TAG = "MusicComplexAuto";
    private static final String ROOT_ID = "music-complex:root";
    private static final String ROOT_ARTISTS = "root:artists";
    private static final String ROOT_PLAYLISTS = "root:playlists";
    private static final String PREFS_NAME = "music_complex_auto";
    private static final String PREF_CATALOG = "catalog";
    private static final String PREF_CONNECTION = "connection";
    private static final String SHUFFLE_PREFIX = "shuffle:";
    private static final String PAGE_PREFIX = "page:";
    private static final ExecutorService NETWORK_EXECUTOR = Executors.newFixedThreadPool(2);
    private static final ExecutorService CONNECTION_RACE_EXECUTOR = Executors.newCachedThreadPool();

    private static Context appContext;
    private static AutoCatalog catalog = new AutoCatalog();
    private static MusicComplexAutoService activeService;
    private static MediaLibrarySession activeSession;
    private static MusicComplexArtworkCache artworkCache;

    private ExoPlayer player;
    private MediaLibrarySession session;
    private MusicComplexAudioCache audioCache;
    private volatile PlexPlayQueue activePlexPlayQueue;
    private AutomaticGainControl automaticGainControl;

    @Override
    public void onCreate() {
        super.onCreate();
        appContext = getApplicationContext();
        activeService = this;
        if (catalog.isEmpty()) loadCatalogFromPrefs();
        artworkCache = new MusicComplexArtworkCache(this);

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build();
        audioCache = new MusicComplexAudioCache(this);
        player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(audioCache.dataSourceFactory()))
            .build();
        player.setAudioAttributes(audioAttributes, true);
        player.setHandleAudioBecomingNoisy(true);
        player.addListener(new Player.Listener() {
            @Override
            public void onMediaItemTransition(@Nullable MediaItem mediaItem, int reason) {
                notifyCurrentChanged();
                maybeAppendNextPlaylistPage(mediaItem);
                updateAudioPrefetchWindow();
            }

            @Override
            public void onTimelineChanged(Timeline timeline, int reason) {
                updateAudioPrefetchWindow();
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                notifyCurrentChanged();
            }

            @Override
            public void onAudioSessionIdChanged(int audioSessionId) {
                applyMatchVolume();
            }
        });
        applyMatchVolume();

        session = new MediaLibrarySession.Builder(this, player, new AutoLibraryCallback()).build();
        activeSession = session;
    }

    @Nullable
    @Override
    public MediaLibrarySession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public void onDestroy() {
        if (activeSession == session) activeSession = null;
        if (activeService == this) activeService = null;
        if (session != null) session.release();
        releaseAutomaticGainControl();
        if (player != null) player.release();
        if (audioCache != null) audioCache.release();
        if (artworkCache != null) artworkCache.release();
        artworkCache = null;
        super.onDestroy();
    }

    static void ensureSession(Context context) {
        if (context == null) return;
        appContext = context.getApplicationContext();
        if (catalog.isEmpty()) loadCatalogFromPrefs();
    }

    static void updateCatalog(JSObject payload) {
        AutoCatalog nextCatalog = AutoCatalog.fromJson(payload);
        saveConnectionToPrefs(payload);
        if (nextCatalog.isEmpty() && !catalog.isEmpty()) {
            catalog.updateConnection(nextCatalog);
            MusicComplexAutoService service = activeService;
            if (service != null) service.applyMatchVolume();
            JSObject bootstrap = catalog.bootstrapJson();
            catalog = AutoCatalog.fromJson(bootstrap);
            saveCatalogToPrefs(bootstrap);
            notifyCatalogChanged();
            return;
        }
        catalog = nextCatalog;
        MusicComplexAutoService service = activeService;
        if (service != null) service.applyMatchVolume();
        saveCatalogToPrefs(payload);
        notifyCatalogChanged();
    }

    // Phone playback and Chromecast retain their own sessions. Android Auto playback is fully
    // owned by this MediaLibraryService so the car never receives conflicting player state.
    static void updateFromJs(JSObject payload) {
    }

    static void refreshVolumeRoute() {
    }

    private static void saveCatalogToPrefs(JSObject payload) {
        if (appContext == null) return;
        appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(PREF_CATALOG, payload.toString())
            .apply();
    }

    private static void saveConnectionToPrefs(JSObject payload) {
        if (appContext == null) return;
        JSONObject plex = payload.optJSONObject("plex");
        if (plex == null) return;
        appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(PREF_CONNECTION, plex.toString())
            .apply();
    }

    private static void loadCatalogFromPrefs() {
        if (appContext == null) return;
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String rawCatalog = prefs.getString(PREF_CATALOG, "");
        if (rawCatalog.isEmpty()) return;
        try {
            catalog = AutoCatalog.fromJson(new JSObject(rawCatalog));
        } catch (Exception ignored) {
            catalog = new AutoCatalog();
        }
        String rawConnection = prefs.getString(PREF_CONNECTION, "");
        if (!rawConnection.isEmpty()) {
            try {
                JSObject payload = new JSObject();
                payload.put("plex", new JSObject(rawConnection));
                catalog.updateConnection(AutoCatalog.fromJson(payload));
            } catch (Exception error) {
                Log.w(TAG, "Could not restore Android Auto Plex connections", error);
            }
        }
    }

    private static void notifyCatalogChanged() {
        MediaLibrarySession currentSession = activeSession;
        if (currentSession == null) return;
        for (MediaSession.ControllerInfo controller : currentSession.getConnectedControllers()) {
            currentSession.notifyChildrenChanged(controller, ROOT_ID, 2, null);
            currentSession.notifyChildrenChanged(controller, ROOT_ARTISTS, catalog.artists.size(), null);
            currentSession.notifyChildrenChanged(controller, ROOT_PLAYLISTS, catalog.playlists.size(), null);
        }
    }

    private static void notifyPlaylistCatalogChanged() {
        MediaLibrarySession currentSession = activeSession;
        if (currentSession == null) return;
        for (MediaSession.ControllerInfo controller : currentSession.getConnectedControllers()) {
            currentSession.notifyChildrenChanged(controller, ROOT_ID, 2, null);
            currentSession.notifyChildrenChanged(controller, ROOT_PLAYLISTS, catalog.playlists.size(), null);
        }
    }

    private void notifyCurrentChanged() {
        if (session == null) return;
        prioritizeCurrentArtwork();
        for (MediaSession.ControllerInfo controller : session.getConnectedControllers()) {
            session.notifyChildrenChanged(controller, ROOT_ID, 2, null);
        }
    }

    private void prioritizeCurrentArtwork() {
        if (player == null || artworkCache == null) return;
        MediaItem currentItem = player.getCurrentMediaItem();
        if (currentItem == null || currentItem.mediaMetadata.artworkUri == null) return;
        String artwork = currentItem.mediaMetadata.artworkUri.toString();
        if (artwork.startsWith("http")) artworkCache.prioritize(artwork);
    }

    private void applyMatchVolume() {
        releaseAutomaticGainControl();
        if (!catalog.matchVolume || player == null || !AutomaticGainControl.isAvailable()) return;
        try {
            automaticGainControl = AutomaticGainControl.create(player.getAudioSessionId());
            if (automaticGainControl != null) automaticGainControl.setEnabled(true);
        } catch (Exception error) {
            automaticGainControl = null;
            Log.w(TAG, "Could not enable Android Auto volume matching", error);
        }
    }

    private void releaseAutomaticGainControl() {
        if (automaticGainControl == null) return;
        try {
            automaticGainControl.setEnabled(false);
            automaticGainControl.release();
        } catch (Exception ignored) {
        }
        automaticGainControl = null;
    }

    private void updateAudioPrefetchWindow() {
        if (player == null || audioCache == null) return;
        int currentIndex = player.getCurrentMediaItemIndex();
        int itemCount = player.getMediaItemCount();
        int endExclusive = MusicComplexAutoRules.audioCacheWindowEndExclusive(currentIndex, itemCount);
        if (endExclusive <= currentIndex) return;

        List<Uri> retainedUris = new ArrayList<>();
        List<Uri> prefetchUris = new ArrayList<>();
        for (int index = currentIndex; index < endExclusive; index += 1) {
            MediaItem item = player.getMediaItemAt(index);
            if (item.localConfiguration == null || item.localConfiguration.uri == null) continue;
            Uri uri = item.localConfiguration.uri;
            retainedUris.add(uri);
            if (index > currentIndex) prefetchUris.add(uri);
        }
        audioCache.updateWindow(retainedUris, prefetchUris);
    }

    private void maybeAppendNextPlaylistPage(@Nullable MediaItem mediaItem) {
        if (mediaItem == null || player == null) return;
        PlexPlayQueue plexPlayQueue = activePlexPlayQueue;
        if (plexPlayQueue != null && plexPlayQueue.owns(mediaItem.mediaId)) {
            if (player.getMediaItemCount() - player.getCurrentMediaItemIndex()
                <= MusicComplexAutoRules.LAZY_SHUFFLE_PREFETCH_THRESHOLD) {
                appendNextPlexPlayQueueWindow(plexPlayQueue);
            }
            return;
        }
        if (player.getMediaItemCount() - player.getCurrentMediaItemIndex() > 12) return;
        PageTarget currentPage = catalog.trackPages.get(mediaItem.mediaId);
        if (currentPage == null) return;
        AutoItem playlist = catalog.find(currentPage.parentId);
        int nextPageIndex = currentPage.pageIndex + 1;
        if (playlist == null || MusicComplexAutoRules.pageStart(nextPageIndex, playlist.leafCount) >= playlist.leafCount) return;
        String nextPageId = pageMediaId(currentPage.parentId, nextPageIndex);
        if (!catalog.loadingPageIds.add(nextPageId)) return;

        NETWORK_EXECUTOR.execute(() -> {
            try {
                List<AutoItem> songs = catalog.playlistPages.get(nextPageId);
                if (songs == null) {
                    songs = catalog.fetchPlaylistPage(playlist, nextPageIndex);
                    catalog.cachePlaylistPage(nextPageId, songs);
                }
                List<MediaItem> nextItems = playableMediaItems(songs);
                new Handler(Looper.getMainLooper()).post(() -> {
                    if (player != null && !nextItems.isEmpty()) player.addMediaItems(nextItems);
                });
            } catch (Exception error) {
                Log.e(TAG, "Failed to prefetch " + nextPageId, error);
            } finally {
                catalog.loadingPageIds.remove(nextPageId);
            }
        });
    }

    private void appendNextPlexPlayQueueWindow(PlexPlayQueue plexPlayQueue) {
        if (!plexPlayQueue.startLoading()) return;

        NETWORK_EXECUTOR.execute(() -> {
            try {
                List<AutoItem> songs = catalog.fetchNextPlayQueueWindow(plexPlayQueue);
                List<MediaItem> nextItems = playableMediaItems(songs);
                new Handler(Looper.getMainLooper()).post(() -> {
                    if (player != null && activePlexPlayQueue == plexPlayQueue && !nextItems.isEmpty()) {
                        player.addMediaItems(nextItems);
                    }
                });
            } catch (Exception error) {
                Log.e(TAG, "Failed to append shuffled Plex play queue", error);
            } finally {
                plexPlayQueue.finishLoading();
            }
        });
    }

    private static boolean needsRemotePlaylistPage(String parentId) {
        if (!catalog.canFetchPlaylists()) return false;
        if (parentId.startsWith(PAGE_PREFIX)) {
            return !catalog.playlistPages.containsKey(parentId);
        }
        if (!parentId.startsWith("playlist:")) return false;
        AutoItem playlist = catalog.find(parentId);
        return playlist != null
            && catalog.children(catalog.songs, parentId).isEmpty();
    }

    private static boolean needsRemoteLibraryChildren(String parentId) {
        if (!catalog.canFetchPlaylists()) return false;
        if (parentId.startsWith("artist:")) return catalog.children(catalog.albums, parentId).isEmpty();
        if (parentId.startsWith("album:")) return catalog.children(catalog.songs, parentId).isEmpty();
        return false;
    }

    private static ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> loadRemoteLibraryChildren(
        String parentId,
        @Nullable LibraryParams params
    ) {
        SettableFuture<LibraryResult<ImmutableList<MediaItem>>> future = SettableFuture.create();
        NETWORK_EXECUTOR.execute(() -> {
            try {
                List<MediaItem> items = new ArrayList<>();
                items.add(shuffleItem(parentId));
                if (parentId.startsWith("artist:")) {
                    List<AutoItem> albums = catalog.fetchArtistAlbums(parentId);
                    catalog.replaceChildren(catalog.albums, parentId, albums);
                    items.addAll(mediaItems(albums));
                } else {
                    List<AutoItem> songs = catalog.fetchAlbumSongs(parentId);
                    catalog.replaceSongsForParent(parentId, songs);
                    items.addAll(mediaItems(songs));
                }
                future.set(LibraryResult.ofItemList(ImmutableList.copyOf(items), params));
            } catch (Exception error) {
                Log.e(TAG, "Failed to load " + parentId, error);
                future.set(LibraryResult.ofError(LibraryResult.RESULT_ERROR_IO));
            }
        });
        return future;
    }

    private static ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> loadRemotePlaylistChildren(
        String parentId,
        @Nullable LibraryParams params
    ) {
        SettableFuture<LibraryResult<ImmutableList<MediaItem>>> future = SettableFuture.create();
        NETWORK_EXECUTOR.execute(() -> {
            try {
                String playlistId = parentId;
                int pageIndex = 0;
                if (parentId.startsWith(PAGE_PREFIX)) {
                    PageTarget target = PageTarget.parse(parentId);
                    if (target == null) throw new IllegalArgumentException("Invalid playlist page");
                    playlistId = target.parentId;
                    pageIndex = target.pageIndex;
                }
                AutoItem playlist = catalog.find(playlistId);
                if (playlist == null) throw new IllegalArgumentException("Playlist is unavailable");
                List<AutoItem> songs = catalog.fetchPlaylistPage(playlist, pageIndex);
                persistCatalogSnapshot();
                notifyPlaylistCatalogChanged();
                if (parentId.startsWith(PAGE_PREFIX)) {
                    catalog.cachePlaylistPage(parentId, songs);
                } else if (MusicComplexAutoRules.shouldPagePlaylist(playlist.leafCount)) {
                    catalog.cachePlaylistPage(pageMediaId(playlistId, 0), songs);
                } else {
                    catalog.replaceSongsForParent(playlistId, songs);
                }
                List<MediaItem> items = parentId.startsWith(PAGE_PREFIX)
                    ? mediaItems(songs)
                    : mediaChildrenFor(playlistId);
                future.set(LibraryResult.ofItemList(ImmutableList.copyOf(items), params));
            } catch (Exception error) {
                Log.e(TAG, "Failed to load playlist children for " + parentId, error);
                future.set(LibraryResult.ofError(LibraryResult.RESULT_ERROR_IO));
            }
        });
        return future;
    }

    private static ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> loadRemotePlaylists(
        @Nullable LibraryParams params
    ) {
        SettableFuture<LibraryResult<ImmutableList<MediaItem>>> future = SettableFuture.create();
        NETWORK_EXECUTOR.execute(() -> {
            try {
                catalog.refreshPlaylists();
                persistCatalogSnapshot();
                notifyPlaylistCatalogChanged();
                future.set(LibraryResult.ofItemList(ImmutableList.copyOf(mediaItems(catalog.playlists)), params));
            } catch (Exception error) {
                Log.w(TAG, "Could not refresh Android Auto playlists", error);
                future.set(LibraryResult.ofItemList(ImmutableList.copyOf(mediaItems(catalog.playlists)), params));
            }
        });
        return future;
    }

    private static void persistCatalogSnapshot() {
        if (appContext == null) return;
        saveCatalogToPrefs(catalog.bootstrapJson());
    }

    private static boolean isRemoteCollectionShuffle(String mediaId) {
        if (!mediaId.startsWith(SHUFFLE_PREFIX) || !catalog.canFetchPlaylists()) return false;
        String parentId = Uri.decode(mediaId.substring(SHUFFLE_PREFIX.length()));
        if (parentId.startsWith("artist:")) return catalog.songsForArtist(parentId).isEmpty();
        if (parentId.startsWith("album:")) return catalog.children(catalog.songs, parentId).isEmpty();
        if (!parentId.startsWith("playlist:")) return false;
        AutoItem playlist = catalog.find(parentId);
        if (playlist == null) return false;
        return catalog.children(catalog.songs, parentId).size() < playlist.leafCount;
    }

    private static ListenableFuture<MediaSession.MediaItemsWithStartPosition> loadRemoteCollectionShuffle(
        String mediaId,
        long startPositionMs
    ) {
        SettableFuture<MediaSession.MediaItemsWithStartPosition> future = SettableFuture.create();
        NETWORK_EXECUTOR.execute(() -> {
            try {
                String parentId = Uri.decode(mediaId.substring(SHUFFLE_PREFIX.length()));
                List<AutoItem> songs;
                if (parentId.startsWith("artist:")) {
                    clearPlexPlayQueue();
                    songs = catalog.fetchArtistSongs(parentId);
                } else if (parentId.startsWith("album:")) {
                    clearPlexPlayQueue();
                    songs = catalog.fetchAlbumSongs(parentId);
                    catalog.replaceSongsForParent(parentId, songs);
                } else {
                    AutoItem playlist = catalog.find(parentId);
                    if (playlist == null) throw new IllegalArgumentException("Playlist is unavailable");
                    if (MusicComplexAutoRules.shouldPagePlaylist(playlist.leafCount)) {
                        PlexPlayQueue plexPlayQueue = catalog.createShuffledPlayQueue(playlist);
                        songs = plexPlayQueue.initialSongs;
                        MusicComplexAutoService service = activeService;
                        if (service != null) service.activePlexPlayQueue = plexPlayQueue;
                    } else {
                        clearPlexPlayQueue();
                        songs = catalog.fetchEntirePlaylist(playlist);
                        catalog.replaceSongsForParent(parentId, songs);
                    }
                }
                if (!parentId.startsWith("playlist:")
                    || !MusicComplexAutoRules.shouldPagePlaylist(catalog.find(parentId).leafCount)) {
                    Collections.shuffle(songs);
                }
                future.set(new MediaSession.MediaItemsWithStartPosition(
                    playableMediaItems(songs),
                    0,
                    Math.max(0, startPositionMs)
                ));
            } catch (Exception error) {
                Log.e(TAG, "Failed to build shuffle queue for " + mediaId, error);
                future.set(new MediaSession.MediaItemsWithStartPosition(
                    ImmutableList.of(),
                    C.INDEX_UNSET,
                    C.TIME_UNSET
                ));
            }
        });
        return future;
    }

    private final class AutoLibraryCallback implements MediaLibrarySession.Callback {
        @Override
        public ListenableFuture<LibraryResult<MediaItem>> onGetLibraryRoot(
            MediaLibrarySession mediaLibrarySession,
            MediaSession.ControllerInfo browser,
            @Nullable LibraryParams params
        ) {
            MediaItem root = new MediaItem.Builder()
                .setMediaId(ROOT_ID)
                .setMediaMetadata(new MediaMetadata.Builder()
                    .setTitle("Music Complex")
                    .setIsBrowsable(true)
                    .setIsPlayable(false)
                    .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
                    .build())
                .build();
            return Futures.immediateFuture(LibraryResult.ofItem(root, params));
        }

        @Override
        public ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> onGetChildren(
            MediaLibrarySession mediaLibrarySession,
            MediaSession.ControllerInfo browser,
            String parentId,
            int page,
            int pageSize,
            @Nullable LibraryParams params
        ) {
            if (needsRemoteLibraryChildren(parentId)) {
                return loadRemoteLibraryChildren(parentId, params);
            }
            if (ROOT_PLAYLISTS.equals(parentId) && catalog.canFetchPlaylists()) {
                return loadRemotePlaylists(params);
            }
            if (needsRemotePlaylistPage(parentId)) {
                return loadRemotePlaylistChildren(parentId, params);
            }
            List<MediaItem> children = mediaChildrenFor(parentId);
            return Futures.immediateFuture(
                LibraryResult.ofItemList(ImmutableList.copyOf(requestedWindow(children, page, pageSize)), params)
            );
        }

        @Override
        public ListenableFuture<LibraryResult<MediaItem>> onGetItem(
            MediaLibrarySession mediaLibrarySession,
            MediaSession.ControllerInfo browser,
            String mediaId
        ) {
            if (ROOT_ID.equals(mediaId)) {
                return Futures.immediateFuture(LibraryResult.ofItem(rootItem(ROOT_ID, "Music Complex", 2), null));
            }
            if (ROOT_ARTISTS.equals(mediaId)) {
                return Futures.immediateFuture(LibraryResult.ofItem(rootItem(ROOT_ARTISTS, "Artists", catalog.artists.size()), null));
            }
            if (ROOT_PLAYLISTS.equals(mediaId)) {
                return Futures.immediateFuture(LibraryResult.ofItem(rootItem(ROOT_PLAYLISTS, "Playlists", catalog.playlists.size()), null));
            }
            if (mediaId.startsWith(SHUFFLE_PREFIX)) {
                return Futures.immediateFuture(LibraryResult.ofItem(shuffleItem(Uri.decode(mediaId.substring(SHUFFLE_PREFIX.length()))), null));
            }
            if (mediaId.startsWith(PAGE_PREFIX)) {
                PageTarget target = PageTarget.parse(mediaId);
                if (target != null) {
                    int start = (target.pageIndex * MusicComplexAutoRules.PLAYLIST_PAGE_SIZE) + 1;
                    int end = start + MusicComplexAutoRules.PLAYLIST_PAGE_SIZE - 1;
                    return Futures.immediateFuture(LibraryResult.ofItem(pageItem(target.parentId, target.pageIndex, start + " - " + end), null));
                }
            }
            AutoItem item = catalog.find(mediaId);
            if (item != null) {
                return Futures.immediateFuture(LibraryResult.ofItem(item.toMediaItem(artworkCache, false), null));
            }
            return Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE));
        }

        @Override
        public ListenableFuture<MediaSession.MediaItemsWithStartPosition> onSetMediaItems(
            MediaSession mediaSession,
            MediaSession.ControllerInfo controller,
            List<MediaItem> requestedItems,
            int requestedStartIndex,
            long startPositionMs
        ) {
            if (requestedItems.isEmpty()) {
                return Futures.immediateFuture(new MediaSession.MediaItemsWithStartPosition(
                    ImmutableList.of(),
                    C.INDEX_UNSET,
                    C.TIME_UNSET
                ));
            }

            String requestedId = requestedItems.get(0).mediaId;
            if (isRemoteCollectionShuffle(requestedId)) {
                return loadRemoteCollectionShuffle(requestedId, startPositionMs);
            }
            clearPlexPlayQueue();
            PlaybackSelection selection = playbackSelection(requestedId);
            if (selection.items.isEmpty()) {
                return Futures.immediateFuture(new MediaSession.MediaItemsWithStartPosition(
                    ImmutableList.of(),
                    C.INDEX_UNSET,
                    C.TIME_UNSET
                ));
            }
            return Futures.immediateFuture(new MediaSession.MediaItemsWithStartPosition(
                selection.items,
                selection.startIndex,
                Math.max(0, startPositionMs)
            ));
        }
    }

    private static void clearPlexPlayQueue() {
        MusicComplexAutoService service = activeService;
        if (service != null) service.activePlexPlayQueue = null;
    }

    private static List<MediaItem> mediaChildrenFor(String parentId) {
        List<MediaItem> items = new ArrayList<>();
        if (ROOT_ID.equals(parentId)) {
            items.add(rootItem(ROOT_ARTISTS, "Artists", catalog.artists.size()));
            items.add(rootItem(ROOT_PLAYLISTS, "Playlists", catalog.playlists.size()));
            return items;
        }
        if (ROOT_ARTISTS.equals(parentId)) return mediaItems(catalog.artists);
        if (ROOT_PLAYLISTS.equals(parentId)) return mediaItems(catalog.playlists);

        if (parentId.startsWith("artist:")) {
            List<AutoItem> songs = catalog.songsForArtist(parentId);
            List<AutoItem> albums = catalog.children(catalog.albums, parentId);
            if (!songs.isEmpty() || !albums.isEmpty() || catalog.canFetchPlaylists()) items.add(shuffleItem(parentId));
            items.addAll(mediaItems(albums));
            return items;
        }
        if (parentId.startsWith("album:")) {
            List<AutoItem> songs = catalog.children(catalog.songs, parentId);
            if (!songs.isEmpty() || catalog.canFetchPlaylists()) items.add(shuffleItem(parentId));
            items.addAll(mediaItems(songs));
            return items;
        }
        if (parentId.startsWith("playlist:")) {
            List<AutoItem> songs = catalog.children(catalog.songs, parentId);
            AutoItem playlist = catalog.find(parentId);
            int playlistSize = playlist == null ? songs.size() : Math.max(songs.size(), playlist.leafCount);
            if (playlistSize > 0 || catalog.canFetchPlaylists()) items.add(shuffleItem(parentId));
            if (MusicComplexAutoRules.shouldPagePlaylist(playlistSize)) {
                int pageCount = MusicComplexAutoRules.pageCount(playlistSize);
                for (int index = 0; index < pageCount; index += 1) {
                    int start = MusicComplexAutoRules.pageStart(index, playlistSize) + 1;
                    int end = MusicComplexAutoRules.pageEndExclusive(index, playlistSize);
                    items.add(pageItem(parentId, index, start + " - " + end));
                }
            } else {
                items.addAll(mediaItems(songs));
            }
            return items;
        }
        if (parentId.startsWith(PAGE_PREFIX)) {
            List<AutoItem> cachedPage = catalog.playlistPages.get(parentId);
            if (cachedPage != null) return mediaItems(cachedPage);
            PageTarget target = PageTarget.parse(parentId);
            if (target == null) return items;
            List<AutoItem> songs = catalog.children(catalog.songs, target.parentId);
            int start = MusicComplexAutoRules.pageStart(target.pageIndex, songs.size());
            int end = MusicComplexAutoRules.pageEndExclusive(target.pageIndex, songs.size());
            return mediaItems(songs.subList(start, end));
        }
        return items;
    }

    private static PlaybackSelection playbackSelection(String mediaId) {
        if (mediaId.startsWith(SHUFFLE_PREFIX)) {
            String parentId = Uri.decode(mediaId.substring(SHUFFLE_PREFIX.length()));
            List<AutoItem> songs = playableSongsFor(parentId);
            Collections.shuffle(songs);
            return new PlaybackSelection(playableMediaItems(songs), 0);
        }

        AutoItem selected = catalog.findSong(mediaId);
        if (selected == null || selected.url.isEmpty()) return PlaybackSelection.empty();
        List<AutoItem> songs = playableSongsFor(selected.parentId);
        int startIndex = indexOf(songs, selected.id);
        if (startIndex < 0) {
            songs = new ArrayList<>();
            songs.add(selected);
            startIndex = 0;
        }
        return new PlaybackSelection(playableMediaItems(songs), startIndex);
    }

    private static List<AutoItem> playableSongsFor(String parentId) {
        List<AutoItem> songs = parentId.startsWith("artist:")
            ? catalog.songsForArtist(parentId)
            : catalog.children(catalog.songs, parentId);
        List<AutoItem> playable = new ArrayList<>();
        for (AutoItem song : songs) {
            if (song.playable && !song.url.isEmpty()) playable.add(song);
        }
        return playable;
    }

    private static int indexOf(List<AutoItem> items, String mediaId) {
        for (int index = 0; index < items.size(); index += 1) {
            if (mediaId.equals(items.get(index).id)) return index;
        }
        return -1;
    }

    private static MediaItem rootItem(String id, String title, int count) {
        return new MediaItem.Builder()
            .setMediaId(id)
            .setMediaMetadata(new MediaMetadata.Builder()
                .setTitle(title)
                .setSubtitle(count + (count == 1 ? " item" : " items"))
                .setIsBrowsable(true)
                .setIsPlayable(false)
                .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
                .build())
            .build();
    }

    private static MediaItem shuffleItem(String parentId) {
        return new MediaItem.Builder()
            .setMediaId(SHUFFLE_PREFIX + Uri.encode(parentId))
            .setMediaMetadata(new MediaMetadata.Builder()
                .setTitle("Shuffle All")
                .setIsBrowsable(false)
                .setIsPlayable(true)
                .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
                .build())
            .build();
    }

    private static MediaItem pageItem(String parentId, int pageIndex, String title) {
        return new MediaItem.Builder()
            .setMediaId(pageMediaId(parentId, pageIndex))
            .setMediaMetadata(new MediaMetadata.Builder()
                .setTitle(title)
                .setIsBrowsable(true)
                .setIsPlayable(false)
                .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_PLAYLISTS)
                .build())
            .build();
    }

    private static String pageMediaId(String parentId, int pageIndex) {
        return PAGE_PREFIX + Uri.encode(parentId) + ":" + pageIndex;
    }

    private static List<MediaItem> mediaItems(List<AutoItem> source) {
        List<MediaItem> items = new ArrayList<>();
        for (AutoItem item : source) items.add(item.toMediaItem(artworkCache, false));
        return items;
    }

    private static List<MediaItem> playableMediaItems(List<AutoItem> source) {
        List<MediaItem> items = new ArrayList<>();
        boolean prioritizeNext = true;
        for (AutoItem item : source) {
            if (item.playable && !item.url.isEmpty()) {
                items.add(item.toMediaItem(artworkCache, prioritizeNext));
                prioritizeNext = false;
            }
        }
        return items;
    }

    private static List<MediaItem> requestedWindow(List<MediaItem> items, int page, int pageSize) {
        if (page < 0 || pageSize <= 0) return items;
        long requestedStart = (long) page * pageSize;
        if (requestedStart >= items.size()) return new ArrayList<>();
        int start = (int) requestedStart;
        int end = Math.min(items.size(), start + pageSize);
        return new ArrayList<>(items.subList(start, end));
    }

    private static final class PlaybackSelection {
        final List<MediaItem> items;
        final int startIndex;

        PlaybackSelection(List<MediaItem> items, int startIndex) {
            this.items = items;
            this.startIndex = startIndex;
        }

        static PlaybackSelection empty() {
            return new PlaybackSelection(new ArrayList<>(), 0);
        }
    }

    private static final class PageTarget {
        final String parentId;
        final int pageIndex;

        PageTarget(String parentId, int pageIndex) {
            this.parentId = parentId;
            this.pageIndex = pageIndex;
        }

        @Nullable
        static PageTarget parse(String mediaId) {
            try {
                String value = mediaId.substring(PAGE_PREFIX.length());
                int separator = value.lastIndexOf(':');
                if (separator <= 0) return null;
                return new PageTarget(
                    Uri.decode(value.substring(0, separator)),
                    Integer.parseInt(value.substring(separator + 1))
                );
            } catch (Exception ignored) {
                return null;
            }
        }
    }

    private static final class AutoCatalog {
        final List<AutoItem> playlists = new ArrayList<>();
        final List<AutoItem> artists = new ArrayList<>();
        final List<AutoItem> albums = new ArrayList<>();
        final List<AutoItem> songs = new ArrayList<>();
        final Map<String, AutoItem> itemsById = new LinkedHashMap<>();
        final Map<String, List<AutoItem>> playlistPages = new LinkedHashMap<>();
        final Map<String, PageTarget> trackPages = new LinkedHashMap<>();
        final java.util.Set<String> loadingPageIds = java.util.Collections.synchronizedSet(new java.util.HashSet<>());
        final List<String> serverUrls = new ArrayList<>();
        String serverUrl = "";
        String serverId = "";
        String token = "";
        boolean matchVolume;

        static AutoCatalog fromJson(JSObject payload) {
            AutoCatalog next = new AutoCatalog();
            JSONObject plex = payload.optJSONObject("plex");
            if (plex != null) {
                next.serverUrl = trimTrailingSlash(plex.optString("serverUrl", ""));
                next.serverId = plex.optString("serverId", "");
                next.token = plex.optString("token", "");
                next.matchVolume = plex.optBoolean("matchVolume", false);
                JSONArray urls = plex.optJSONArray("serverUrls");
                if (urls != null) {
                    for (int index = 0; index < urls.length(); index += 1) {
                        String url = trimTrailingSlash(urls.optString(index, ""));
                        if (!url.isEmpty() && !next.serverUrls.contains(url)) next.serverUrls.add(url);
                    }
                }
                if (!next.serverUrl.isEmpty() && !next.serverUrls.contains(next.serverUrl)) {
                    next.serverUrls.add(next.serverUrl);
                }
            }
            next.addAll(next.playlists, payload.optJSONArray("playlists"));
            next.addAll(next.artists, payload.optJSONArray("artists"));
            next.addAll(next.albums, payload.optJSONArray("albums"));
            next.addAll(next.songs, payload.optJSONArray("songs"));
            next.resolveRelativeArtwork();
            return next;
        }

        boolean isEmpty() {
            return playlists.isEmpty() && artists.isEmpty() && albums.isEmpty() && songs.isEmpty();
        }

        boolean canFetchPlaylists() {
            return !serverUrl.isEmpty() && !token.isEmpty();
        }

        synchronized void updateConnection(AutoCatalog source) {
            if (!source.serverUrl.isEmpty()) serverUrl = source.serverUrl;
            if (!source.serverId.isEmpty()) serverId = source.serverId;
            if (!source.token.isEmpty()) token = source.token;
            matchVolume = source.matchVolume;
            if (!source.serverUrls.isEmpty()) {
                serverUrls.clear();
                serverUrls.addAll(source.serverUrls);
            }
        }

        JSObject bootstrapJson() {
            JSObject payload = new JSObject();
            payload.put("playlists", jsonArray(playlists));
            payload.put("artists", jsonArray(artists));
            payload.put("albums", new JSONArray());
            payload.put("songs", new JSONArray());
            JSONObject plex = new JSONObject();
            try {
                plex.put("serverUrl", serverUrl);
                plex.put("serverUrls", new JSONArray(serverUrls));
                plex.put("serverId", serverId);
                plex.put("token", token);
                plex.put("matchVolume", matchVolume);
            } catch (Exception error) {
                Log.w(TAG, "Could not build Android Auto bootstrap catalog", error);
            }
            payload.put("plex", plex);
            return payload;
        }

        private JSONArray jsonArray(List<AutoItem> items) {
            JSONArray result = new JSONArray();
            for (AutoItem item : items) result.put(item.toJson());
            return result;
        }

        void addAll(List<AutoItem> destination, @Nullable JSONArray array) {
            if (array == null) return;
            for (int index = 0; index < array.length(); index += 1) {
                JSONObject object = array.optJSONObject(index);
                if (object == null) continue;
                AutoItem item = AutoItem.fromJson(object);
                destination.add(item);
                itemsById.putIfAbsent(item.id, item);
            }
        }

        @Nullable
        AutoItem find(String mediaId) {
            return itemsById.get(mediaId);
        }

        @Nullable
        AutoItem findSong(String mediaId) {
            for (AutoItem song : songs) {
                if (mediaId.equals(song.id)) return song;
            }
            return null;
        }

        List<AutoItem> children(List<AutoItem> source, String parentId) {
            List<AutoItem> result = new ArrayList<>();
            for (AutoItem item : source) {
                if (parentId.equals(item.parentId)) result.add(item);
            }
            return result;
        }

        List<AutoItem> songsForArtist(String artistId) {
            List<AutoItem> directSongs = children(songs, artistId);
            if (!directSongs.isEmpty()) return directSongs;

            List<AutoItem> result = new ArrayList<>();
            Map<String, Boolean> seen = new LinkedHashMap<>();
            for (AutoItem album : children(albums, artistId)) {
                for (AutoItem song : children(songs, album.id)) {
                    String identity = song.sourceId.isEmpty() ? song.id : song.sourceId;
                    if (seen.containsKey(identity)) continue;
                    seen.put(identity, true);
                    result.add(song);
                }
            }
            return result;
        }

        synchronized void replaceSongsForParent(String parentId, List<AutoItem> replacements) {
            songs.removeIf((song) -> parentId.equals(song.parentId));
            songs.addAll(replacements);
            for (AutoItem replacement : replacements) itemsById.put(replacement.id, replacement);
        }

        synchronized void cachePlaylistPage(String pageId, List<AutoItem> replacements) {
            playlistPages.put(pageId, replacements);
            PageTarget target = PageTarget.parse(pageId);
            for (AutoItem replacement : replacements) {
                songs.removeIf((song) -> replacement.id.equals(song.id));
                songs.add(replacement);
                itemsById.put(replacement.id, replacement);
                if (target != null) trackPages.put(replacement.id, target);
            }
        }

        synchronized void replaceChildren(List<AutoItem> destination, String parentId, List<AutoItem> replacements) {
            destination.removeIf((item) -> parentId.equals(item.parentId));
            destination.addAll(replacements);
            for (AutoItem replacement : replacements) itemsById.put(replacement.id, replacement);
        }

        List<AutoItem> fetchArtistAlbums(String artistId) throws Exception {
            List<AutoItem> result = new ArrayList<>();
            JSONArray metadata = fetchMetadata(metadataChildrenPath(artistId), 0, 1000).metadata;
            for (int index = 0; index < metadata.length(); index += 1) {
                JSONObject album = metadata.optJSONObject(index);
                if (album == null) continue;
                AutoItem item = new AutoItem();
                item.sourceId = album.optString("ratingKey", album.optString("key", ""));
                item.id = "album:" + Uri.encode(item.sourceId);
                item.title = album.optString("title", "Untitled album");
                item.subtitle = album.optString("parentTitle", album.optString("grandparentTitle", ""));
                item.parentId = artistId;
                item.key = metadataChildrenPath(item.id);
                item.artwork = artworkUrl(album.optString("thumb", album.optString("parentThumb", "")));
                item.browsable = true;
                item.playable = false;
                result.add(item);
            }
            return result;
        }

        List<AutoItem> fetchAlbumSongs(String albumId) throws Exception {
            List<AutoItem> result = new ArrayList<>();
            JSONArray metadata = fetchMetadata(metadataChildrenPath(albumId), 0, 1000).metadata;
            for (int index = 0; index < metadata.length(); index += 1) {
                JSONObject track = metadata.optJSONObject(index);
                if (track != null) result.add(trackFromPlex(track, albumId));
            }
            return result;
        }

        List<AutoItem> fetchArtistSongs(String artistId) throws Exception {
            List<AutoItem> artistAlbums = children(albums, artistId);
            if (artistAlbums.isEmpty()) {
                artistAlbums = fetchArtistAlbums(artistId);
                replaceChildren(albums, artistId, artistAlbums);
            }
            List<AutoItem> result = new ArrayList<>();
            for (AutoItem album : artistAlbums) {
                List<AutoItem> albumSongs = children(songs, album.id);
                if (albumSongs.isEmpty()) {
                    albumSongs = fetchAlbumSongs(album.id);
                    replaceSongsForParent(album.id, albumSongs);
                }
                result.addAll(albumSongs);
            }
            return result;
        }

        List<AutoItem> fetchEntirePlaylist(AutoItem playlist) throws Exception {
            List<AutoItem> result = new ArrayList<>();
            int expected = Math.max(playlist.leafCount, MusicComplexAutoRules.PLAYLIST_PAGE_SIZE);
            int pageCount = Math.max(1, MusicComplexAutoRules.pageCount(expected));
            for (int pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
                List<AutoItem> page = fetchPlaylistPage(playlist, pageIndex);
                if (page.isEmpty()) break;
                result.addAll(page);
                if (page.size() < MusicComplexAutoRules.PLAYLIST_PAGE_SIZE) break;
            }
            return result;
        }

        synchronized void refreshPlaylists() throws Exception {
            if (!canFetchPlaylists()) return;
            MetadataResponse response = fetchMetadata("/playlists?playlistType=audio", 0, 1000);
            JSONArray metadata = response.metadata;
            for (int index = 0; index < metadata.length(); index += 1) {
                JSONObject remote = metadata.optJSONObject(index);
                if (remote == null) continue;
                AutoItem existing = findMatchingPlaylist(remote);
                if (existing == null) continue;
                updatePlaylistFromRemote(existing, remote);
            }
        }

        @Nullable
        private AutoItem findMatchingPlaylist(JSONObject remote) {
            String ratingKey = remote.optString("ratingKey", "");
            if (!ratingKey.isEmpty()) {
                AutoItem byId = itemsById.get("playlist:" + Uri.encode(ratingKey));
                if (byId != null) return byId;
            }
            String title = remote.optString("title", remote.optString("titleSort", ""));
            if (title.isEmpty()) return null;
            for (AutoItem playlist : playlists) {
                if (title.equals(playlist.title)) return playlist;
            }
            return null;
        }

        private void updatePlaylistFromRemote(AutoItem playlist, JSONObject remote) {
            int remoteCount = remote.optInt("leafCount", playlist.leafCount);
            if (remoteCount >= 0) playlist.leafCount = remoteCount;
            String remoteKey = remote.optString("key", "");
            String ratingKey = remote.optString("ratingKey", "");
            if (!remoteKey.isEmpty()) {
                playlist.key = remoteKey;
            } else if (!ratingKey.isEmpty() && playlist.key.isEmpty()) {
                playlist.key = "/playlists/" + ratingKey + "/items";
            }
            String artwork = remote.optString("composite", remote.optString("thumb", ""));
            if (!artwork.isEmpty()) playlist.artwork = artworkUrl(artwork);
            itemsById.put(playlist.id, playlist);
        }

        PlexPlayQueue createShuffledPlayQueue(AutoItem playlist) throws Exception {
            String playlistId = playlist.sourceId.isEmpty()
                ? playlist.id.replace("playlist:", "")
                : playlist.sourceId;
            String uri = "server://" + serverId + "/com.plexapp.plugins.library" + playlist.key;
            String path = "/playQueues?type=audio&shuffle=1&repeat=0&continuous=0&includeRelated=0"
                + "&window=" + MusicComplexAutoRules.PLAY_QUEUE_WINDOW_SIZE
                + "&playlistID=" + Uri.encode(playlistId)
                + "&uri=" + Uri.encode(uri);
            JSONObject container = requestPlayQueue("POST", path);
            PlexPlayQueue playQueue = PlexPlayQueue.fromContainer(playlist, container);
            playQueue.initialSongs.addAll(tracksFromPlayQueue(container, playQueue));
            if (playQueue.initialSongs.isEmpty()) throw new IllegalStateException("Plex returned an empty shuffled play queue");
            return playQueue;
        }

        List<AutoItem> fetchNextPlayQueueWindow(PlexPlayQueue playQueue) throws Exception {
            if (!playQueue.hasMore()) return new ArrayList<>();
            String path = "/playQueues/" + Uri.encode(playQueue.id)
                + "?own=1&includeRelated=0&includeBefore=0&includeAfter=1"
                + "&window=" + MusicComplexAutoRules.PLAY_QUEUE_WINDOW_SIZE
                + "&center=" + Uri.encode(playQueue.lastItemId);
            JSONObject container = requestPlayQueue("GET", path);
            return tracksFromPlayQueue(container, playQueue);
        }

        List<AutoItem> tracksFromPlayQueue(JSONObject container, PlexPlayQueue playQueue) {
            List<AutoItem> songs = new ArrayList<>();
            JSONArray metadata = container.optJSONArray("Metadata");
            if (metadata == null) return songs;
            playQueue.totalCount = Math.max(playQueue.totalCount, container.optInt("playQueueTotalCount", metadata.length()));
            for (int index = 0; index < metadata.length(); index += 1) {
                JSONObject track = metadata.optJSONObject(index);
                if (track == null) continue;
                String itemId = track.optString("playQueueItemID", "");
                if (itemId.isEmpty() || !playQueue.seenItemIds.add(itemId)) continue;
                AutoItem song = trackFromPlex(track, playQueue.playlist.id);
                song.id = "playqueue:" + Uri.encode(playQueue.id + ":" + itemId);
                song.playQueueItemId = itemId;
                songs.add(song);
                playQueue.lastItemId = itemId;
            }
            return songs;
        }

        JSONObject requestPlayQueue(String method, String path) throws Exception {
            Exception lastError = null;
            for (String candidate : orderedConnectionCandidates()) {
                HttpURLConnection connection = null;
                try {
                    String separator = path.contains("?") ? "&" : "?";
                    String requestUrl = candidate + path + separator + "X-Plex-Token=" + Uri.encode(token);
                    connection = (HttpURLConnection) new URL(requestUrl).openConnection();
                    connection.setRequestMethod(method);
                    connection.setConnectTimeout(3000);
                    connection.setReadTimeout(12000);
                    connection.setRequestProperty("Accept", "application/json");
                    connection.setRequestProperty("X-Plex-Token", token);
                    connection.setRequestProperty("X-Plex-Product", "Music Complex");
                    connection.setRequestProperty("X-Plex-Client-Identifier", "music-complex-android-auto");
                    if ("POST".equals(method)) connection.setDoOutput(true);
                    int status = connection.getResponseCode();
                    if (status < 200 || status >= 300) throw new IllegalStateException("Plex returned " + status);
                    StringBuilder body = new StringBuilder();
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()))) {
                        String line;
                        while ((line = reader.readLine()) != null) body.append(line);
                    }
                    JSONObject container = new JSONObject(body.toString()).optJSONObject("MediaContainer");
                    if (container == null) throw new IllegalStateException("Plex returned no play queue");
                    promoteConnection(candidate);
                    return container;
                } catch (Exception error) {
                    lastError = error;
                } finally {
                    if (connection != null) connection.disconnect();
                }
            }
            throw lastError == null ? new IllegalStateException("No Plex server connection available") : lastError;
        }

        List<AutoItem> fetchPlaylistPage(AutoItem playlist, int pageIndex) throws Exception {
            if (!canFetchPlaylists() || playlist.key.isEmpty()) return new ArrayList<>();
            int start = pageIndex * MusicComplexAutoRules.PLAYLIST_PAGE_SIZE;
            MetadataResponse response = fetchMetadata(playlist.key, start, MusicComplexAutoRules.PLAYLIST_PAGE_SIZE);
            JSONArray metadata = response.metadata;
            playlist.leafCount = Math.max(playlist.leafCount, response.totalSize);
            List<AutoItem> tracks = new ArrayList<>();
            for (int index = 0; index < metadata.length(); index += 1) {
                JSONObject track = metadata.optJSONObject(index);
                if (track != null) tracks.add(trackFromPlex(track, playlist.id));
            }
            return tracks;
        }

        MetadataResponse fetchMetadata(String path, int start, int size) throws Exception {
            if (!canFetchPlaylists() || path == null || path.isEmpty()) return new MetadataResponse(new JSONArray(), 0);
            List<String> candidates = orderedConnectionCandidates();
            try {
                return fetchFastest(candidates, path, start, size);
            } catch (Exception error) {
                Log.w(TAG, "Known Plex connections failed", error);
            }
            List<String> discovered = discoverServerUrls();
            List<String> newCandidates = new ArrayList<>();
            for (String candidate : discovered) {
                if (!candidates.contains(candidate)) newCandidates.add(candidate);
            }
            if (!newCandidates.isEmpty()) return fetchFastest(newCandidates, path, start, size);
            throw new IllegalStateException("No Plex server connection available");
        }

        synchronized List<String> orderedConnectionCandidates() {
            List<String> candidates = new ArrayList<>();
            if (!serverUrl.isEmpty()) candidates.add(serverUrl);
            for (String candidate : serverUrls) {
                if (!candidate.isEmpty() && !candidates.contains(candidate)) candidates.add(candidate);
            }
            return candidates;
        }

        MetadataResponse fetchFastest(List<String> candidates, String path, int start, int size) throws Exception {
            if (candidates.isEmpty()) throw new IllegalStateException("No Plex server connection available");
            long startedAt = System.currentTimeMillis();
            CompletionService<ConnectionResult> completion = new ExecutorCompletionService<>(CONNECTION_RACE_EXECUTOR);
            List<Future<ConnectionResult>> requests = new ArrayList<>();
            Set<String> submitted = new HashSet<>();
            Exception lastError = null;
            int completed = 0;
            try {
                String preferred = candidates.get(0);
                submitted.add(preferred);
                requests.add(submitConnection(completion, preferred, path, start, size));

                Future<ConnectionResult> preferredResult = completion.poll(350, TimeUnit.MILLISECONDS);
                if (preferredResult != null) {
                    completed += 1;
                    try {
                        return acceptWinner(preferredResult.get(), path, startedAt);
                    } catch (Exception error) {
                        lastError = error;
                    }
                }

                for (String candidate : candidates) {
                    if (candidate == null || candidate.isEmpty() || !submitted.add(candidate)) continue;
                    requests.add(submitConnection(completion, candidate, path, start, size));
                }
                while (completed < requests.size()) {
                    completed += 1;
                    try {
                        return acceptWinner(completion.take().get(), path, startedAt);
                    } catch (Exception error) {
                        lastError = error;
                    }
                }
            } finally {
                for (Future<ConnectionResult> request : requests) request.cancel(true);
            }
            throw lastError == null ? new IllegalStateException("No Plex server connection available") : lastError;
        }

        Future<ConnectionResult> submitConnection(
            CompletionService<ConnectionResult> completion,
            String candidate,
            String path,
            int start,
            int size
        ) {
            return completion.submit(() -> new ConnectionResult(
                candidate,
                fetchMetadataFrom(candidate, path, start, size)
            ));
        }

        MetadataResponse acceptWinner(ConnectionResult winner, String path, long startedAt) {
            promoteConnection(winner.baseUrl);
            Log.i(TAG, "Loaded " + path + " from " + winner.baseUrl + " in "
                + (System.currentTimeMillis() - startedAt) + "ms");
            return winner.response;
        }

        synchronized void promoteConnection(String winner) {
            serverUrl = winner;
            serverUrls.remove(winner);
            serverUrls.add(0, winner);
        }

        List<String> discoverServerUrls() {
            if (token.isEmpty()) return new ArrayList<>();
            HttpURLConnection connection = null;
            try {
                String requestUrl = "https://plex.tv/api/resources?includeHttps=1&includeRelay=1&X-Plex-Token="
                    + Uri.encode(token);
                connection = (HttpURLConnection) new URL(requestUrl).openConnection();
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(12000);
                connection.setRequestProperty("Accept", "application/xml,text/xml,*/*");
                connection.setRequestProperty("X-Plex-Token", token);
                connection.setRequestProperty("X-Plex-Product", "Music Complex");
                connection.setRequestProperty("X-Plex-Client-Identifier", "music-complex-android-auto");
                if (connection.getResponseCode() < 200 || connection.getResponseCode() >= 300) return new ArrayList<>();
                StringBuilder body = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()))) {
                    String line;
                    while ((line = reader.readLine()) != null) body.append(line);
                }
                XmlPullParser parser = Xml.newPullParser();
                parser.setInput(new StringReader(body.toString()));
                boolean selectedDevice = false;
                List<String> discovered = new ArrayList<>();
                int event = parser.getEventType();
                while (event != XmlPullParser.END_DOCUMENT) {
                    if (event == XmlPullParser.START_TAG && "Device".equals(parser.getName())) {
                        String provides = parser.getAttributeValue(null, "provides");
                        String product = parser.getAttributeValue(null, "product");
                        String clientIdentifier = parser.getAttributeValue(null, "clientIdentifier");
                        boolean isServer = (provides != null && provides.contains("server"))
                            || "Plex Media Server".equals(product);
                        selectedDevice = isServer && (serverId.isEmpty() || serverId.equals(clientIdentifier));
                    } else if (event == XmlPullParser.END_TAG && "Device".equals(parser.getName())) {
                        selectedDevice = false;
                    } else if (selectedDevice && event == XmlPullParser.START_TAG && "Connection".equals(parser.getName())) {
                        String uri = trimTrailingSlash(parser.getAttributeValue(null, "uri"));
                        if (!uri.isEmpty() && !discovered.contains(uri)) discovered.add(uri);
                    }
                    event = parser.next();
                }
                if (!discovered.isEmpty()) {
                    serverUrls.clear();
                    serverUrls.addAll(discovered);
                }
                return discovered;
            } catch (Exception error) {
                Log.w(TAG, "Could not discover Plex server connections", error);
                return new ArrayList<>();
            } finally {
                if (connection != null) connection.disconnect();
            }
        }

        MetadataResponse fetchMetadataFrom(String baseUrl, String path, int start, int size) throws Exception {
            String separator = path.contains("?") ? "&" : "?";
            String requestUrl = baseUrl
                + path
                + separator
                + "X-Plex-Container-Start=" + start
                + "&X-Plex-Container-Size=" + size
                + "&X-Plex-Token=" + Uri.encode(token);
            HttpURLConnection connection = (HttpURLConnection) new URL(requestUrl).openConnection();
            connection.setConnectTimeout(3000);
            connection.setReadTimeout(12000);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("X-Plex-Token", token);
            connection.setRequestProperty("X-Plex-Product", "Music Complex");
            connection.setRequestProperty("X-Plex-Client-Identifier", "music-complex-android-auto");
            try {
                if (connection.getResponseCode() < 200 || connection.getResponseCode() >= 300) {
                    throw new IllegalStateException("Plex returned " + connection.getResponseCode());
                }
                StringBuilder body = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()))) {
                    String line;
                    while ((line = reader.readLine()) != null) body.append(line);
                }
                JSONObject container = new JSONObject(body.toString()).optJSONObject("MediaContainer");
                JSONArray metadata = container == null ? null : container.optJSONArray("Metadata");
                JSONArray result = metadata == null ? new JSONArray() : metadata;
                int totalSize = container == null ? result.length() : container.optInt("totalSize", container.optInt("size", result.length()));
                return new MetadataResponse(result, totalSize);
            } finally {
                connection.disconnect();
            }
        }

        private static final class MetadataResponse {
            final JSONArray metadata;
            final int totalSize;

            MetadataResponse(JSONArray metadata, int totalSize) {
                this.metadata = metadata;
                this.totalSize = totalSize;
            }
        }

        private static final class ConnectionResult {
            final String baseUrl;
            final MetadataResponse response;

            ConnectionResult(String baseUrl, MetadataResponse response) {
                this.baseUrl = baseUrl;
                this.response = response;
            }
        }

        String metadataChildrenPath(String mediaId) {
            String[] parts = mediaId.split(":", 2);
            String identity = parts.length == 2 ? Uri.decode(parts[1]) : Uri.decode(mediaId);
            return "/library/metadata/" + identity + "/children";
        }

        AutoItem trackFromPlex(JSONObject track, String parentId) {
            AutoItem item = new AutoItem();
            item.sourceId = track.optString("ratingKey", track.optString("key", ""));
            item.playQueueItemId = track.optString("playQueueItemID", "");
            item.id = item.playQueueItemId.isEmpty()
                ? "track:" + Uri.encode(item.sourceId + "|parent=" + parentId)
                : "playqueue:" + Uri.encode(item.playQueueItemId);
            item.title = track.optString("title", "Untitled");
            item.subtitle = track.optString("grandparentTitle", track.optString("originalTitle", "Unknown artist"));
            item.album = track.optString("parentTitle", "Unknown album");
            item.parentId = parentId;
            item.duration = track.optLong("duration", 0);
            item.browsable = false;
            item.playable = true;
            String artwork = track.optString("thumb", track.optString("parentThumb", track.optString("grandparentThumb", "")));
            item.artwork = artworkUrl(artwork);
            JSONArray media = track.optJSONArray("Media");
            JSONObject firstMedia = media == null ? null : media.optJSONObject(0);
            JSONArray parts = firstMedia == null ? null : firstMedia.optJSONArray("Part");
            JSONObject firstPart = parts == null ? null : parts.optJSONObject(0);
            String partKey = firstPart == null ? "" : firstPart.optString("key", "");
            item.url = absoluteUrl(partKey);
            return item;
        }

        String absoluteUrl(String path) {
            if (path == null || path.isEmpty()) return "";
            if (path.startsWith("http")) return path;
            return serverUrl + path + (path.contains("?") ? "&" : "?") + "X-Plex-Token=" + Uri.encode(token);
        }

        String artworkUrl(String path) {
            if (path == null || path.isEmpty()) return "";
            if (path.startsWith("http")) return path;
            return serverUrl + "/photo/:/transcode?width=360&height=360&minSize=1&upscale=1&url="
                + Uri.encode(path)
                + "&X-Plex-Token="
                + Uri.encode(token);
        }

        void resolveRelativeArtwork() {
            PlexArtworkContext context = PlexArtworkContext.fromSongs(songs);
            if (!context.isUsable()) return;
            for (AutoItem item : playlists) item.artwork = context.resolve(item.artwork);
            for (AutoItem item : artists) item.artwork = context.resolve(item.artwork);
            for (AutoItem item : albums) item.artwork = context.resolve(item.artwork);
            for (AutoItem item : songs) item.artwork = context.resolve(item.artwork);
        }

        private static String trimTrailingSlash(String value) {
            String result = value == null ? "" : value.trim();
            while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
            return result;
        }
    }

    private static final class PlexPlayQueue {
        final AutoItem playlist;
        final List<AutoItem> initialSongs = new ArrayList<>();
        final Set<String> seenItemIds = new HashSet<>();
        String id = "";
        String lastItemId = "";
        int totalCount;
        boolean loading;

        PlexPlayQueue(AutoItem playlist) {
            this.playlist = playlist;
        }

        static PlexPlayQueue fromContainer(AutoItem playlist, JSONObject container) {
            PlexPlayQueue playQueue = new PlexPlayQueue(playlist);
            playQueue.id = String.valueOf(container.optLong("playQueueID", 0));
            playQueue.totalCount = container.optInt("playQueueTotalCount", playlist.leafCount);
            return playQueue;
        }

        synchronized boolean startLoading() {
            if (loading || !hasMore()) return false;
            loading = true;
            return true;
        }

        synchronized void finishLoading() {
            loading = false;
        }

        synchronized boolean hasMore() {
            return !lastItemId.isEmpty() && seenItemIds.size() < totalCount;
        }

        boolean owns(String mediaId) {
            return mediaId != null && mediaId.startsWith("playqueue:");
        }
    }

    private static final class AutoItem {
        String id = "";
        String sourceId = "";
        String title = "";
        String subtitle = "";
        String album = "";
        String artwork = "";
        String parentId = "";
        String url = "";
        String key = "";
        String playQueueItemId = "";
        long duration;
        int leafCount;
        boolean browsable;
        boolean playable;

        static AutoItem fromJson(JSONObject object) {
            AutoItem item = new AutoItem();
            item.id = object.optString("id", "");
            item.sourceId = object.optString("sourceId", "");
            item.title = object.optString("title", "Untitled");
            item.subtitle = object.optString("subtitle", "");
            item.album = object.optString("album", "");
            item.artwork = object.optString("artwork", "");
            item.parentId = object.optString("parentId", "");
            item.url = object.optString("url", "");
            item.key = object.optString("key", "");
            item.duration = object.optLong("duration", 0);
            item.leafCount = object.optInt("leafCount", 0);
            item.browsable = object.optBoolean("browsable", false);
            item.playable = object.optBoolean("playable", true);
            return item;
        }

        JSONObject toJson() {
            JSONObject object = new JSONObject();
            try {
                object.put("id", id);
                object.put("sourceId", sourceId);
                object.put("title", title);
                object.put("subtitle", subtitle);
                object.put("album", album);
                object.put("artwork", artwork);
                object.put("parentId", parentId);
                object.put("url", url);
                object.put("key", key);
                object.put("duration", duration);
                object.put("leafCount", leafCount);
                object.put("browsable", browsable);
                object.put("playable", playable);
            } catch (Exception error) {
                Log.w(TAG, "Could not serialize Android Auto item " + id, error);
            }
            return object;
        }

        MediaItem toMediaItem(@Nullable MusicComplexArtworkCache cache, boolean nowPlayingArtwork) {
            String safeId = id == null ? "" : id;
            String safeTitle = title == null ? "Untitled" : title;
            String safeSubtitle = subtitle == null ? "" : subtitle;
            String safeAlbum = album == null ? "" : album;
            String safeArtwork = artwork == null ? "" : artwork;
            String safeUrl = url == null ? "" : url;
            MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                .setTitle(safeTitle)
                .setSubtitle(safeSubtitle)
                .setArtist(safeSubtitle)
                .setAlbumTitle(safeAlbum)
                .setDurationMs(duration)
                .setIsBrowsable(browsable)
                .setIsPlayable(playable)
                .setMediaType(browsable ? MediaMetadata.MEDIA_TYPE_FOLDER_MIXED : MediaMetadata.MEDIA_TYPE_MUSIC);
            if (!safeArtwork.isEmpty()) {
                Uri artworkUri = cache == null
                    ? Uri.parse(safeArtwork)
                    : cache.localOrRemoteUri(safeArtwork, nowPlayingArtwork);
                metadata.setArtworkUri(artworkUri);
            }

            MediaItem.Builder item = new MediaItem.Builder()
                .setMediaId(safeId)
                .setMediaMetadata(metadata.build());
            if (!safeUrl.isEmpty()) item.setUri(safeUrl);
            return item.build();
        }
    }

    private static final class PlexArtworkContext {
        final String baseUrl;
        final String token;

        PlexArtworkContext(String baseUrl, String token) {
            this.baseUrl = baseUrl;
            this.token = token;
        }

        static PlexArtworkContext fromSongs(List<AutoItem> songs) {
            for (AutoItem song : songs) {
                try {
                    Uri uri = Uri.parse(song.url);
                    String token = uri.getQueryParameter("X-Plex-Token");
                    if (uri.getScheme() != null && uri.getAuthority() != null && token != null && !token.isEmpty()) {
                        return new PlexArtworkContext(uri.getScheme() + "://" + uri.getAuthority(), token);
                    }
                } catch (Exception ignored) {
                }
            }
            return new PlexArtworkContext("", "");
        }

        boolean isUsable() {
            return !baseUrl.isEmpty() && !token.isEmpty();
        }

        String resolve(String artwork) {
            if (artwork == null || artwork.isEmpty() || artwork.startsWith("http")) return artwork == null ? "" : artwork;
            return baseUrl + "/photo/:/transcode?width=360&height=360&minSize=1&upscale=1&url="
                + Uri.encode(artwork)
                + "&X-Plex-Token="
                + Uri.encode(token);
        }
    }
}
