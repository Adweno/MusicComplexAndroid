package com.musiccomplex.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.audiofx.AutomaticGainControl;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class MusicComplexPlayerService extends Service {
    private static final String CHANNEL_ID = "music_complex_playback";
    private static final int NOTIFICATION_ID = 42;
    private static Context appContext;
    private static MediaPlayer mediaPlayer;
    private static PowerManager.WakeLock playbackWakeLock;
    private static WifiManager.WifiLock playbackWifiLock;
    private static AudioManager audioManager;
    private static AudioFocusRequest audioFocusRequest;
    private static boolean hasAudioFocus = false;
    private static final List<PlaybackItem> queue = new ArrayList<>();
    private static int currentIndex = -1;
    private static boolean playing = false;
    private static boolean preparing = false;
    private static double volume = 1.0;
    private static boolean matchVolume = false;
    private static AutomaticGainControl automaticGainControl;

    static void setAppContext(Context context) {
        if (context != null) appContext = context.getApplicationContext();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        setAppContext(this);
        ensureNotificationChannel();
        startForeground(NOTIFICATION_ID, notification());
        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    static void play(Context context, JSArray tracks, int startIndex, double startTime, double nextVolume, boolean shouldMatchVolume) {
        setAppContext(context);
        ensureService();
        queue.clear();
        for (int index = 0; index < tracks.length(); index += 1) {
            JSONObject object = tracks.optJSONObject(index);
            if (object == null) continue;
            PlaybackItem item = PlaybackItem.fromJson(object);
            if (!item.url.isEmpty()) queue.add(item);
        }
        currentIndex = Math.max(0, Math.min(startIndex, queue.size() - 1));
        volume = clamp(nextVolume);
        matchVolume = shouldMatchVolume;
        updatePlaybackLocks(true);
        playCurrent(startTime);
    }

    static void pause() {
        if (mediaPlayer != null && mediaPlayer.isPlaying()) {
            mediaPlayer.pause();
        }
        playing = false;
        preparing = false;
        updatePlaybackLocks(false);
        emitState("paused");
        updateForeground();
    }

    static void resume() {
        if (!requestAudioFocus()) {
            emitError(new Exception("Audio focus was not granted"));
            return;
        }
        if (mediaPlayer == null) {
            playCurrent(0);
            return;
        }
        try {
            mediaPlayer.start();
            playing = true;
            preparing = false;
            updatePlaybackLocks(true);
            emitState("playing");
            updateForeground();
        } catch (Exception error) {
            emitError(error);
        }
    }

    static boolean hasQueue() {
        return !queue.isEmpty() && currentIndex >= 0 && currentIndex < queue.size();
    }

    static boolean isPlayingOrPreparing() {
        return playing || preparing;
    }

    static boolean next() {
        if (!hasQueue()) return false;
        int nextIndex = MusicComplexPlayerRules.nextIndexAfterCompletion(currentIndex, queue.size());
        if (nextIndex < 0) return false;
        currentIndex = nextIndex;
        playCurrent(0);
        return true;
    }

    static boolean previous() {
        if (!hasQueue()) return false;
        try {
            int positionMs = mediaPlayer == null ? 0 : mediaPlayer.getCurrentPosition();
            int previousIndex = MusicComplexPlayerRules.previousIndexForControl(currentIndex, queue.size(), positionMs);
            if (previousIndex == currentIndex) {
                seek(0);
                return true;
            }
            if (previousIndex < 0) return false;
            currentIndex = previousIndex;
            playCurrent(0);
            return true;
        } catch (Exception ignored) {
        }
        return false;
    }

    static void seek(double positionSeconds) {
        if (mediaPlayer == null) return;
        try {
            mediaPlayer.seekTo((int) Math.max(0, positionSeconds * 1000));
            emitState(playing ? "playing" : "paused");
        } catch (Exception error) {
            emitError(error);
        }
    }

    static void setVolume(double nextVolume) {
        volume = clamp(nextVolume);
        if (mediaPlayer != null) {
            float nativeVolume = (float) volume;
            mediaPlayer.setVolume(nativeVolume, nativeVolume);
        }
    }

    static void setMatchVolume(boolean enabled) {
        matchVolume = enabled;
        applyMatchVolume();
    }

    static void stopPlayback() {
        releasePlayer();
        playing = false;
        preparing = false;
        updatePlaybackLocks(false);
        abandonAudioFocus();
        emitState("stopped");
        stopServiceIfPossible();
    }

    static JSObject status() {
        return statePayload("status");
    }

    private static void playCurrent(double startTime) {
        if (appContext == null || queue.isEmpty() || currentIndex < 0 || currentIndex >= queue.size()) {
            stopPlayback();
            return;
        }
        releasePlayer();
        if (!requestAudioFocus()) {
            preparing = false;
            playing = false;
            updatePlaybackLocks(false);
            emitError(new Exception("Audio focus was not granted"));
            return;
        }
        preparing = true;
        playing = false;
        updatePlaybackLocks(true);
        PlaybackItem item = queue.get(currentIndex);
        emitState("preparing");
        try {
            MediaPlayer nextPlayer = new MediaPlayer();
            nextPlayer.setWakeMode(appContext, PowerManager.PARTIAL_WAKE_LOCK);
            nextPlayer.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build());
            nextPlayer.setDataSource(appContext, Uri.parse(item.url));
            nextPlayer.setVolume((float) volume, (float) volume);
            mediaPlayer = nextPlayer;
            applyMatchVolume();
            nextPlayer.setOnPreparedListener((player) -> {
                try {
                    if (startTime > 0) player.seekTo((int) (startTime * 1000));
                    player.start();
                    preparing = false;
                    playing = true;
                    updatePlaybackLocks(true);
                    emitState("playing");
                    updateForeground();
                } catch (Exception error) {
                    emitError(error);
                }
            });
            nextPlayer.setOnCompletionListener((player) -> playNextFromCompletion());
            nextPlayer.setOnErrorListener((player, what, extra) -> {
                emitError(new Exception("Native playback error " + what + " / " + extra));
                playNextFromCompletion();
                return true;
            });
            ensureNotificationChannel();
            updateForeground();
            nextPlayer.prepareAsync();
        } catch (Exception error) {
            preparing = false;
            playing = false;
            emitError(error);
        }
    }

    private static void playNextFromCompletion() {
        int nextIndex = MusicComplexPlayerRules.nextIndexAfterCompletion(currentIndex, queue.size());
        if (nextIndex >= 0) {
            currentIndex = nextIndex;
            new Handler(Looper.getMainLooper()).post(() -> playCurrent(0));
            return;
        }
        playing = false;
        preparing = false;
        updatePlaybackLocks(false);
        abandonAudioFocus();
        emitState("queueFinished");
        stopServiceIfPossible();
    }

    private static void releasePlayer() {
        releaseAutomaticGainControl();
        if (mediaPlayer == null) return;
        try {
            mediaPlayer.setOnCompletionListener(null);
            mediaPlayer.setOnErrorListener(null);
            mediaPlayer.stop();
        } catch (Exception ignored) {
        }
        try {
            mediaPlayer.release();
        } catch (Exception ignored) {
        }
        mediaPlayer = null;
    }

    private static void applyMatchVolume() {
        releaseAutomaticGainControl();
        if (!matchVolume || mediaPlayer == null || !AutomaticGainControl.isAvailable()) return;
        try {
            automaticGainControl = AutomaticGainControl.create(mediaPlayer.getAudioSessionId());
            if (automaticGainControl != null) automaticGainControl.setEnabled(true);
        } catch (Exception ignored) {
            automaticGainControl = null;
        }
    }

    private static void releaseAutomaticGainControl() {
        if (automaticGainControl == null) return;
        try {
            automaticGainControl.setEnabled(false);
            automaticGainControl.release();
        } catch (Exception ignored) {
        }
        automaticGainControl = null;
    }

    private static boolean requestAudioFocus() {
        if (appContext == null) return false;
        try {
            if (audioManager == null) {
                audioManager = (AudioManager) appContext.getSystemService(Context.AUDIO_SERVICE);
            }
            if (audioManager == null) return false;

            int result;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (audioFocusRequest == null) {
                    audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build())
                        .setAcceptsDelayedFocusGain(false)
                        .setOnAudioFocusChangeListener(MusicComplexPlayerService::handleAudioFocusChange)
                        .build();
                }
                result = audioManager.requestAudioFocus(audioFocusRequest);
            } else {
                result = audioManager.requestAudioFocus(
                    MusicComplexPlayerService::handleAudioFocusChange,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN
                );
            }
            hasAudioFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
            return hasAudioFocus;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static void abandonAudioFocus() {
        if (audioManager == null || !hasAudioFocus) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
                audioManager.abandonAudioFocusRequest(audioFocusRequest);
            } else {
                audioManager.abandonAudioFocus(MusicComplexPlayerService::handleAudioFocusChange);
            }
        } catch (Exception ignored) {
        }
        hasAudioFocus = false;
    }

    private static void handleAudioFocusChange(int focusChange) {
        if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
            pause();
            abandonAudioFocus();
            return;
        }
        if (focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            if (mediaPlayer != null && mediaPlayer.isPlaying()) {
                mediaPlayer.pause();
            }
            playing = false;
            preparing = false;
            updatePlaybackLocks(false);
            emitState("paused");
            updateForeground();
            return;
        }
        if (focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK && mediaPlayer != null) {
            mediaPlayer.setVolume((float) (volume * 0.25), (float) (volume * 0.25));
            return;
        }
        if (focusChange == AudioManager.AUDIOFOCUS_GAIN) {
            hasAudioFocus = true;
            if (mediaPlayer != null) {
                mediaPlayer.setVolume((float) volume, (float) volume);
            }
        }
    }

    private static void ensureService() {
        if (appContext == null) return;
        Intent intent = new Intent(appContext, MusicComplexPlayerService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            appContext.startForegroundService(intent);
        } else {
            appContext.startService(intent);
        }
    }

    private static void stopServiceIfPossible() {
        if (appContext == null) return;
        try {
            Intent intent = new Intent(appContext, MusicComplexPlayerService.class);
            appContext.stopService(intent);
        } catch (Exception ignored) {
        }
    }

    private static void updateForeground() {
        if (appContext == null) return;
        ensureService();
    }

    private static void updatePlaybackLocks(boolean shouldHold) {
        if (appContext == null) return;
        try {
            if (playbackWakeLock == null) {
                PowerManager powerManager = (PowerManager) appContext.getSystemService(Context.POWER_SERVICE);
                playbackWakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MusicComplex:NativePlayback");
                playbackWakeLock.setReferenceCounted(false);
            }
            if (playbackWifiLock == null) {
                WifiManager wifiManager = (WifiManager) appContext.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                playbackWifiLock = wifiManager.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "MusicComplex:WifiPlayback");
                playbackWifiLock.setReferenceCounted(false);
            }
            boolean holdLocks = MusicComplexPlayerRules.shouldHoldPlaybackLocks(!queue.isEmpty(), shouldHold, preparing);
            if (holdLocks) {
                if (!playbackWakeLock.isHeld()) playbackWakeLock.acquire();
                if (!playbackWifiLock.isHeld()) playbackWifiLock.acquire();
            } else {
                if (playbackWakeLock.isHeld()) playbackWakeLock.release();
                if (playbackWifiLock.isHeld()) playbackWifiLock.release();
            }
        } catch (Exception ignored) {
        }
    }

    private static void ensureNotificationChannel() {
        if (appContext == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) appContext.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Music Complex Playback", NotificationManager.IMPORTANCE_LOW);
        manager.createNotificationChannel(channel);
    }

    private static Notification notification() {
        PlaybackItem item = currentItem();
        Intent launchIntent = appContext.getPackageManager().getLaunchIntentForPackage(appContext.getPackageName());
        PendingIntent pendingIntent = PendingIntent.getActivity(
            appContext,
            0,
            launchIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        return new NotificationCompat.Builder(appContext, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(item.title.isEmpty() ? "Music Complex" : item.title)
            .setContentText(item.artist.isEmpty() ? "Playing music" : item.artist)
            .setContentIntent(pendingIntent)
            .setOngoing(playing || preparing)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private static PlaybackItem currentItem() {
        if (currentIndex >= 0 && currentIndex < queue.size()) return queue.get(currentIndex);
        return new PlaybackItem();
    }

    private static JSObject statePayload(String event) {
        PlaybackItem item = currentItem();
        int positionMs = 0;
        int durationMs = item.durationMs;
        try {
            if (mediaPlayer != null) {
                positionMs = mediaPlayer.getCurrentPosition();
                durationMs = mediaPlayer.getDuration() > 0 ? mediaPlayer.getDuration() : durationMs;
            }
        } catch (Exception ignored) {
        }
        return new JSObject()
            .put("event", event)
            .put("index", currentIndex)
            .put("title", item.title)
            .put("artist", item.artist)
            .put("album", item.album)
            .put("coverUrl", item.coverUrl)
            .put("position", positionMs / 1000.0)
            .put("duration", durationMs / 1000.0)
            .put("playing", playing)
            .put("preparing", preparing);
    }

    private static void emitState(String event) {
        JSObject payload = statePayload(event);
        MusicComplexPlayerPlugin.emitPlayerEvent(payload);
        if ("playing".equals(event) || "preparing".equals(event) || "paused".equals(event)) {
            MusicComplexAutoService.updateFromJs(new JSObject()
                .put("title", payload.getString("title", "Nothing loaded"))
                .put("artist", payload.getString("artist", "Music Complex"))
                .put("album", payload.getString("album", ""))
                .put("coverUrl", payload.getString("coverUrl", ""))
                .put("duration", payload.optDouble("duration", 0.0))
                .put("position", payload.optDouble("position", 0.0))
                .put("playing", payload.optBoolean("playing", false)));
        } else if ("queueFinished".equals(event) || "stopped".equals(event)) {
            MusicComplexAutoService.updateFromJs(new JSObject()
                .put("title", "Nothing loaded")
                .put("artist", "Music Complex")
                .put("album", "")
                .put("duration", 0)
                .put("position", 0)
                .put("playing", false));
        }
    }

    private static void emitError(Exception error) {
        playing = false;
        preparing = false;
        MusicComplexPlayerPlugin.emitPlayerEvent(new JSObject()
            .put("event", "error")
            .put("message", error.getMessage() == null ? "Native playback failed" : error.getMessage())
            .put("index", currentIndex));
    }

    private static double clamp(double value) {
        return Math.max(0.0, Math.min(1.0, value));
    }

    private static class PlaybackItem {
        String url = "";
        String title = "";
        String artist = "";
        String album = "";
        String coverUrl = "";
        int durationMs = 0;

        static PlaybackItem fromJson(JSONObject object) {
            PlaybackItem item = new PlaybackItem();
            item.url = object.optString("url", "");
            item.title = object.optString("title", "");
            item.artist = object.optString("artist", "");
            item.album = object.optString("album", "");
            item.coverUrl = object.optString("coverUrl", "");
            item.durationMs = object.optInt("duration", 0);
            return item;
        }
    }
}
