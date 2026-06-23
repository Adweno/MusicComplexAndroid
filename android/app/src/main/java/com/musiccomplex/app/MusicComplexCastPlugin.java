package com.musiccomplex.app;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.mediarouter.media.MediaRouteSelector;
import androidx.mediarouter.media.MediaRouter;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.cast.CastMediaControlIntent;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.MediaQueueItem;
import com.google.android.gms.cast.MediaStatus;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.SessionManager;
import com.google.android.gms.cast.framework.SessionManagerListener;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;
import com.google.android.gms.common.images.WebImage;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "MusicComplexCast")
public class MusicComplexCastPlugin extends Plugin {
    private static final int MAX_CAST_QUEUE_ITEMS = 40;
    private static final int CAST_QUEUE_PREVIOUS_ITEMS = 5;
    private static MusicComplexCastPlugin activeInstance;
    private static volatile boolean activeCastConnected = false;
    private static volatile int cachedCastVolumePercent = 50;
    private CastContext castContext;
    private SessionManager sessionManager;
    private MediaRouter mediaRouter;
    private MediaRouteSelector routeSelector;
    private MediaRouter.Callback mediaRouterCallback;
    private SessionManagerListener<CastSession> sessionListener;
    private RemoteMediaClient.Callback remoteMediaCallback;
    private final List<CastQueueItem> castQueue = new ArrayList<>();
    private int castQueueIndex = -1;

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            activeInstance = this;
            castContext = CastContext.getSharedInstance(getContext());
            sessionManager = castContext.getSessionManager();
            updateCachedSessionState();
            mediaRouter = MediaRouter.getInstance(getContext());
            routeSelector = new MediaRouteSelector.Builder()
                .addControlCategory(CastMediaControlIntent.categoryForCast(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID))
                .build();
            mediaRouterCallback = new MediaRouter.Callback() {
                @Override
                public void onRouteAdded(@NonNull MediaRouter router, @NonNull MediaRouter.RouteInfo route) {
                    notifyDeviceListeners();
                }

                @Override
                public void onRouteRemoved(@NonNull MediaRouter router, @NonNull MediaRouter.RouteInfo route) {
                    notifyDeviceListeners();
                }

                @Override
                public void onRouteChanged(@NonNull MediaRouter router, @NonNull MediaRouter.RouteInfo route) {
                    notifyDeviceListeners();
                }

                @Override
                public void onRouteSelected(@NonNull MediaRouter router, @NonNull MediaRouter.RouteInfo route) {
                    notifyDeviceListeners();
                }

                @Override
                public void onRouteUnselected(@NonNull MediaRouter router, @NonNull MediaRouter.RouteInfo route) {
                    notifyDeviceListeners();
                }
            };
            mediaRouter.addCallback(routeSelector, mediaRouterCallback, MediaRouter.CALLBACK_FLAG_REQUEST_DISCOVERY);
            sessionListener = new SessionManagerListener<CastSession>() {
                @Override
                public void onSessionStarted(CastSession session, String sessionId) {
                    updateCachedSessionState(session);
                    notifyDeviceListeners();
                    MusicComplexAutoService.refreshVolumeRoute();
                }

                @Override
                public void onSessionResumed(CastSession session, boolean wasSuspended) {
                    updateCachedSessionState(session);
                    notifyDeviceListeners();
                    MusicComplexAutoService.refreshVolumeRoute();
                }

                @Override
                public void onSessionEnded(CastSession session, int error) {
                    activeCastConnected = false;
                    notifyDeviceListeners();
                    MusicComplexAutoService.refreshVolumeRoute();
                }

                @Override public void onSessionStarting(CastSession session) {}
                @Override public void onSessionStartFailed(CastSession session, int error) {}
                @Override public void onSessionEnding(CastSession session) {
                    activeCastConnected = false;
                    MusicComplexAutoService.refreshVolumeRoute();
                }
                @Override public void onSessionResuming(CastSession session, String sessionId) {}
                @Override public void onSessionResumeFailed(CastSession session, int error) {
                    activeCastConnected = false;
                    MusicComplexAutoService.refreshVolumeRoute();
                }
                @Override public void onSessionSuspended(CastSession session, int reason) {
                    activeCastConnected = false;
                    MusicComplexAutoService.refreshVolumeRoute();
                }
            };
            sessionManager.addSessionManagerListener(sessionListener, CastSession.class);
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        if (mediaRouter != null && mediaRouterCallback != null) {
            mediaRouter.removeCallback(mediaRouterCallback);
        }
        if (sessionManager != null && sessionListener != null) {
            sessionManager.removeSessionManagerListener(sessionListener, CastSession.class);
        }
    }

    @PluginMethod
    public void list(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            ensureDiscovery();
            JSObject result = new JSObject();
            result.put("supported", true);
            result.put("devices", routeSnapshot());
            call.resolve(result);
        });
    }

    @PluginMethod
    public void rescan(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            ensureDiscovery();
            JSObject result = new JSObject();
            result.put("supported", true);
            result.put("devices", routeSnapshot());
            call.resolve(result);
            notifyDeviceListeners();
        });
    }

    @PluginMethod
    public void connect(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String id = call.getString("id", "");
            String host = call.getString("host", "");
            MediaRouter.RouteInfo route = findRoute(id, host);
            if (route == null) {
                call.reject("Cast device is no longer available.");
                return;
            }
            mediaRouter.selectRoute(route);
            waitForConnectedSession(call, route.getName(), System.currentTimeMillis());
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            CastSession session = currentSession();
            if (session == null || !session.isConnected()) {
                String id = call.getString("id", "");
                String host = call.getString("host", "");
                MediaRouter.RouteInfo route = findRoute(id, host);
                if (route != null) mediaRouter.selectRoute(route);
                session = currentSession();
            }

            if (session == null) {
                call.reject("No active cast device.");
                return;
            }

            RemoteMediaClient client = session.getRemoteMediaClient();
            if (client == null) {
                call.reject("Cast device is not ready for media.");
                return;
            }

            syncCastQueue(call);
            if (castQueue.isEmpty()) {
                call.reject("No playable cast queue items.");
                return;
            }
            double startTime = call.getDouble("startTime", 0.0);
            long startTimeMs = (long) Math.max(0, startTime * 1000);

            attachRemoteCallback(client);
            loadCastQueue(session, client, startTimeMs, call);
        });
    }

    @PluginMethod
    public void control(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            CastSession session = currentSession();
            if (session == null) {
                call.reject("No active cast device.");
                return;
            }
            RemoteMediaClient client = session.getRemoteMediaClient();
            String action = call.getString("action", "");
            double value = call.getDouble("value", 0.0);

            if ("volume".equals(action)) {
                try {
                    session.setVolume(Math.max(0, Math.min(1, value)));
                    call.resolve(new JSObject().put("ok", true));
                } catch (Exception error) {
                    call.reject(error.getMessage());
                }
                return;
            }

            if (client == null) {
                call.reject("Cast device is not ready for media.");
                return;
            }

            if ("pause".equals(action)) client.pause();
            else if ("resume".equals(action)) client.play();
            else if ("next".equals(action)) client.queueNext(null);
            else if ("previous".equals(action)) client.queuePrev(null);
            else if ("stop".equals(action)) client.stop();
            else if ("seek".equals(action)) client.seek((long) Math.max(0, value * 1000));
            else {
                call.reject("Unsupported cast action: " + action);
                return;
            }
            call.resolve(new JSObject().put("ok", true));
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (sessionManager != null) sessionManager.endCurrentSession(true);
            if (mediaRouter != null) mediaRouter.selectRoute(mediaRouter.getDefaultRoute());
            call.resolve(new JSObject().put("ok", true));
            notifyDeviceListeners();
        });
    }

    @PluginMethod
    public void status(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            CastSession session = currentSession();
            if (session == null) {
                call.reject("No active cast device.");
                return;
            }
            RemoteMediaClient client = session.getRemoteMediaClient();
            if (client == null || client.getMediaStatus() == null) {
                call.resolve(new JSObject()
                    .put("currentTime", 0)
                    .put("duration", 0)
                    .put("playerState", ""));
                return;
            }

            JSObject result = new JSObject();
            updateCastQueueIndexFromClient(client);
            CastQueueItem item = currentCastQueueItem();
            result.put("currentTime", client.getApproximateStreamPosition() / 1000.0);
            result.put("duration", Math.max(0, client.getStreamDuration()) / 1000.0);
            result.put("playerState", playerStateLabel(client.getPlayerState()));
            result.put("index", item == null ? castQueueIndex : item.appIndex);
            result.put("title", item == null ? "" : item.title);
            result.put("artist", item == null ? "" : item.subtitle);
            result.put("coverUrl", item == null ? "" : item.coverUrl);
            call.resolve(result);
        });
    }

    private void ensureDiscovery() {
        if (mediaRouter != null && mediaRouterCallback != null && routeSelector != null) {
            mediaRouter.addCallback(routeSelector, mediaRouterCallback, MediaRouter.CALLBACK_FLAG_REQUEST_DISCOVERY);
        }
    }

    private JSArray routeSnapshot() {
        JSArray devices = new JSArray();
        if (mediaRouter == null) return devices;
        List<MediaRouter.RouteInfo> routes = mediaRouter.getRoutes();
        for (MediaRouter.RouteInfo route : routes) {
            if (!route.matchesSelector(routeSelector) || route.isDefault()) continue;
            devices.put(routeToJson(route));
        }
        return devices;
    }

    private JSObject routeToJson(MediaRouter.RouteInfo route) {
        JSObject device = new JSObject();
        device.put("id", route.getId());
        device.put("name", route.getName());
        device.put("friendlyName", route.getName());
        device.put("host", route.getId());
        return device;
    }

    private MediaRouter.RouteInfo findRoute(String id, String host) {
        if (mediaRouter == null) return null;
        for (MediaRouter.RouteInfo route : mediaRouter.getRoutes()) {
            if (!route.matchesSelector(routeSelector) || route.isDefault()) continue;
            if (route.getId().equals(id)
                || route.getId().equals(host)
                || route.getName().equals(id)
                || route.getName().equals(host)) {
                return route;
            }
        }
        return null;
    }

    private CastSession currentSession() {
        return sessionManager == null ? null : sessionManager.getCurrentCastSession();
    }

    private void syncCastQueue(PluginCall call) {
        List<CastQueueItem> fullQueue = new ArrayList<>();
        castQueue.clear();
        JSArray tracks = call.getArray("tracks", new JSArray());
        for (int index = 0; index < tracks.length(); index += 1) {
            JSONObject object = tracks.optJSONObject(index);
            if (object == null) continue;
            CastQueueItem item = CastQueueItem.fromJson(object);
            item.appIndex = index;
            if (!item.url.isEmpty()) fullQueue.add(item);
        }

        if (fullQueue.isEmpty()) {
            CastQueueItem fallback = new CastQueueItem();
            fallback.url = call.getString("url", "");
            fallback.title = call.getString("title", "Music Complex");
            fallback.subtitle = call.getString("subtitle", "");
            fallback.coverUrl = call.getString("coverUrl", "");
            fallback.mimeType = call.getString("mimeType", "audio/mpeg");
            fallback.appIndex = 0;
            if (!fallback.url.isEmpty()) fullQueue.add(fallback);
        }

        int requestedIndex = call.getInt("startIndex", 0);
        if (fullQueue.isEmpty()) {
            castQueueIndex = -1;
            return;
        }

        int safeRequestedIndex = Math.max(0, Math.min(requestedIndex, fullQueue.size() - 1));
        int windowStart = Math.max(0, safeRequestedIndex - CAST_QUEUE_PREVIOUS_ITEMS);
        int windowEnd = Math.min(fullQueue.size(), windowStart + MAX_CAST_QUEUE_ITEMS);
        if (safeRequestedIndex >= windowEnd) {
            windowEnd = Math.min(fullQueue.size(), safeRequestedIndex + 1);
            windowStart = Math.max(0, windowEnd - MAX_CAST_QUEUE_ITEMS);
        }

        castQueue.addAll(fullQueue.subList(windowStart, windowEnd));
        castQueueIndex = safeRequestedIndex - windowStart;
    }

    private CastQueueItem currentCastQueueItem() {
        if (castQueueIndex >= 0 && castQueueIndex < castQueue.size()) return castQueue.get(castQueueIndex);
        return null;
    }

    private void attachRemoteCallback(RemoteMediaClient client) {
        if (remoteMediaCallback != null) {
            try {
                client.unregisterCallback(remoteMediaCallback);
            } catch (Exception ignored) {
            }
        }
        remoteMediaCallback = new RemoteMediaClient.Callback() {
            @Override
            public void onStatusUpdated() {
                updateCastQueueIndexFromClient(client);
                updateAutoServiceFromCastClient(client);
            }
        };
        client.registerCallback(remoteMediaCallback);
    }

    private MediaInfo mediaInfoFor(CastQueueItem item) {
        MediaMetadata metadata = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MUSIC_TRACK);
        metadata.putString(MediaMetadata.KEY_TITLE, item.title);
        metadata.putString(MediaMetadata.KEY_SUBTITLE, item.subtitle);
        if (!item.coverUrl.isEmpty()) {
            metadata.addImage(new WebImage(Uri.parse(item.coverUrl)));
        }

        return new MediaInfo.Builder(item.url)
            .setContentType(item.mimeType)
            .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
            .setMetadata(metadata)
            .build();
    }

    private MediaQueueItem queueItemFor(CastQueueItem item) {
        JSONObject customData = new JSONObject();
        try {
            customData.put("appIndex", item.appIndex);
        } catch (Exception ignored) {
        }
        return new MediaQueueItem.Builder(mediaInfoFor(item))
            .setAutoplay(true)
            .setCustomData(customData)
            .build();
    }

    private void loadCastQueue(CastSession session, RemoteMediaClient client, long startTimeMs, PluginCall call) {
        MediaQueueItem[] queueItems = new MediaQueueItem[castQueue.size()];
        for (int index = 0; index < castQueue.size(); index += 1) {
            queueItems[index] = queueItemFor(castQueue.get(index));
        }

        String deviceName = session.getCastDevice().getFriendlyName();
        try {
            client.queueLoad(queueItems, castQueueIndex, MediaStatus.REPEAT_MODE_REPEAT_OFF, startTimeMs, null).setResultCallback(result -> {
                if (!result.getStatus().isSuccess()) {
                    if (call != null) call.reject(result.getStatus().getStatusMessage());
                    return;
                }

                activeCastConnected = true;
                updateCachedSessionState(session);
                MusicComplexAutoService.refreshVolumeRoute();
                updateCastQueueIndexFromClient(client);
                updateAutoServiceFromCastClient(client);
                CastQueueItem item = currentCastQueueItem();
                if (call != null) {
                    call.resolve(new JSObject()
                        .put("ok", true)
                        .put("device", deviceName)
                        .put("index", item == null ? castQueueIndex : item.appIndex));
                }
            });
        } catch (IllegalArgumentException error) {
            if (call != null) {
                call.reject(error.getMessage() == null ? "Cast queue was too large." : error.getMessage());
            }
        }
    }

    private void updateCastQueueIndexFromClient(RemoteMediaClient client) {
        if (client == null) return;
        MediaQueueItem currentItem = client.getCurrentItem();
        if (currentItem == null || currentItem.getCustomData() == null) return;
        int appIndex = currentItem.getCustomData().optInt("appIndex", -1);
        int[] appIndices = new int[castQueue.size()];
        for (int index = 0; index < castQueue.size(); index += 1) {
            appIndices[index] = castQueue.get(index).appIndex;
        }
        int nextIndex = MusicComplexPlayerRules.castQueueLocalIndexForAppIndex(appIndices, appIndex);
        if (nextIndex >= 0) {
            castQueueIndex = nextIndex;
        }
    }

    private void updateAutoServiceFromCastClient(RemoteMediaClient client) {
        if (client == null) return;
        updateCastQueueIndexFromClient(client);
        CastQueueItem item = currentCastQueueItem();
        if (item == null) return;
        MusicComplexAutoService.updateFromJs(new JSObject()
            .put("title", item.title)
            .put("artist", item.subtitle)
            .put("album", "")
            .put("coverUrl", item.coverUrl)
            .put("duration", Math.max(0, client.getStreamDuration()) / 1000.0)
            .put("position", Math.max(0, client.getApproximateStreamPosition()) / 1000.0)
            .put("playing", client.getPlayerState() == MediaStatus.PLAYER_STATE_PLAYING
                || client.getPlayerState() == MediaStatus.PLAYER_STATE_BUFFERING));
        updateCachedSessionState();
        MusicComplexAutoService.refreshVolumeRoute();
    }

    private void updateCachedSessionState() {
        updateCachedSessionState(currentSession());
    }

    private void updateCachedSessionState(CastSession session) {
        activeCastConnected = session != null && session.isConnected();
        if (!activeCastConnected) return;
        try {
            cachedCastVolumePercent = (int) Math.round(Math.max(0, Math.min(1, session.getVolume())) * 100);
        } catch (Exception ignored) {
        }
    }

    private void waitForConnectedSession(PluginCall call, String deviceName, long startedAt) {
        CastSession session = currentSession();
        if (session != null && session.isConnected()) {
            call.resolve(new JSObject().put("ok", true).put("device", deviceName));
            return;
        }

        if (System.currentTimeMillis() - startedAt > 10000) {
            call.reject("Timed out connecting to " + deviceName + ".");
            return;
        }

        new Handler(Looper.getMainLooper()).postDelayed(
            () -> waitForConnectedSession(call, deviceName, startedAt),
            200
        );
    }

    public static boolean handleVolumeKey(int keyCode) {
        MusicComplexCastPlugin plugin = activeInstance;
        if (plugin == null) return false;
        CastSession session = plugin.currentSession();
        if (session == null || !session.isConnected()) return false;
        if (keyCode != android.view.KeyEvent.KEYCODE_VOLUME_UP
            && keyCode != android.view.KeyEvent.KEYCODE_VOLUME_DOWN) {
            return false;
        }

        try {
            double step = keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP ? 0.05 : -0.05;
            double nextVolume = Math.max(0, Math.min(1, session.getVolume() + step));
            session.setVolume(nextVolume);
            cachedCastVolumePercent = (int) Math.round(nextVolume * 100);
            activeCastConnected = true;
            plugin.notifyCastVolume(nextVolume, session);
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    public static boolean hasActiveCastSession() {
        return activeCastConnected;
    }

    public static int currentCastVolumePercent() {
        return cachedCastVolumePercent;
    }

    public static void setActiveCastVolumePercent(int volumePercent) {
        MusicComplexCastPlugin plugin = activeInstance;
        if (plugin == null) return;
        int nextPercent = MusicComplexPlayerRules.clampPercent(volumePercent);
        cachedCastVolumePercent = nextPercent;
        new Handler(Looper.getMainLooper()).post(() -> {
            CastSession session = plugin.currentSession();
            if (session == null || !session.isConnected()) {
                activeCastConnected = false;
                MusicComplexAutoService.refreshVolumeRoute();
                return;
            }
            try {
                double nextVolume = nextPercent / 100.0;
                session.setVolume(nextVolume);
                activeCastConnected = true;
                plugin.notifyCastVolume(nextVolume, session);
            } catch (Exception ignored) {
            }
        });
    }

    private void notifyCastVolume(double nextVolume, CastSession session) {
        JSObject result = new JSObject();
        result.put("volume", nextVolume);
        if (session.getCastDevice() != null) {
            result.put("device", session.getCastDevice().getFriendlyName());
        }
        notifyListeners("volume", result);
    }

    private void notifyDeviceListeners() {
        JSObject result = new JSObject();
        result.put("devices", routeSnapshot());
        notifyListeners("devices", result);
    }

    private String playerStateLabel(int state) {
        if (state == MediaStatus.PLAYER_STATE_PLAYING) return "PLAYING";
        if (state == MediaStatus.PLAYER_STATE_PAUSED) return "PAUSED";
        if (state == MediaStatus.PLAYER_STATE_IDLE) return "IDLE";
        if (state == MediaStatus.PLAYER_STATE_BUFFERING) return "BUFFERING";
        return "";
    }

    private static class CastQueueItem {
        String url = "";
        String title = "Music Complex";
        String subtitle = "";
        String coverUrl = "";
        String mimeType = "audio/mpeg";
        long durationMs = 0;
        int appIndex = 0;

        static CastQueueItem fromJson(JSONObject object) {
            CastQueueItem item = new CastQueueItem();
            item.url = object.optString("url", "");
            item.title = object.optString("title", "Music Complex");
            item.subtitle = object.optString("subtitle", "");
            item.coverUrl = object.optString("coverUrl", "");
            item.mimeType = object.optString("mimeType", "audio/mpeg");
            item.durationMs = object.optLong("duration", 0);
            return item;
        }
    }
}
