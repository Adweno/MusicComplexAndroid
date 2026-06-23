package com.musiccomplex.app;

import android.content.Context;
import android.net.Uri;
import android.util.Log;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.PriorityBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

final class MusicComplexArtworkCache {
    private static final String TAG = "MusicComplexArtwork";
    private static final long MAX_CACHE_BYTES = 80L * 1024L * 1024L;
    private static final int PRIORITY_NOW_PLAYING = 0;
    private static final int PRIORITY_BROWSE = 10;

    private final Context appContext;
    private final File cacheDirectory;
    private final ThreadPoolExecutor executor;
    private final AtomicLong sequence = new AtomicLong();
    private final Set<String> queuedKeys = java.util.Collections.synchronizedSet(new HashSet<>());

    MusicComplexArtworkCache(Context context) {
        appContext = context.getApplicationContext();
        cacheDirectory = new File(appContext.getCacheDir(), "artwork");
        if (!cacheDirectory.exists() && !cacheDirectory.mkdirs()) {
            Log.w(TAG, "Could not create artwork cache directory");
        }
        executor = new ThreadPoolExecutor(
            1,
            1,
            20,
            TimeUnit.SECONDS,
            new PriorityBlockingQueue<>()
        );
        executor.allowCoreThreadTimeOut(true);
    }

    Uri localOrRemoteUri(String artworkUrl, boolean nowPlaying) {
        if (artworkUrl == null || artworkUrl.isEmpty()) return Uri.EMPTY;
        if (!artworkUrl.startsWith("http")) return Uri.parse(artworkUrl);
        File cachedFile = fileFor(artworkUrl);
        if (cachedFile.exists() && cachedFile.length() > 0) {
            cachedFile.setLastModified(System.currentTimeMillis());
            return contentUri(cachedFile);
        }
        queueFetch(artworkUrl, nowPlaying);
        return Uri.parse(artworkUrl);
    }

    void prioritize(String artworkUrl) {
        if (artworkUrl == null || artworkUrl.isEmpty()) return;
        if (!artworkUrl.startsWith("http")) return;
        queueFetch(artworkUrl, true);
    }

    void warm(String artworkUrl) {
        if (artworkUrl == null || artworkUrl.isEmpty()) return;
        if (!artworkUrl.startsWith("http")) return;
        queueFetch(artworkUrl, false);
    }

    void release() {
        executor.shutdownNow();
        queuedKeys.clear();
    }

    private Uri contentUri(File file) {
        return FileProvider.getUriForFile(
            appContext,
            appContext.getPackageName() + ".fileprovider",
            file
        );
    }

    private void queueFetch(String artworkUrl, boolean nowPlaying) {
        File cachedFile = fileFor(artworkUrl);
        if (cachedFile.exists() && cachedFile.length() > 0) return;
        String key = cachedFile.getName();
        if (!queuedKeys.add(key)) return;
        executor.execute(new ArtworkJob(
            nowPlaying ? PRIORITY_NOW_PLAYING : PRIORITY_BROWSE,
            sequence.incrementAndGet(),
            artworkUrl,
            cachedFile
        ));
    }

    private File fileFor(String artworkUrl) {
        return new File(cacheDirectory, sha256(artworkUrl) + ".img");
    }

    private void fetch(String artworkUrl, File destination) {
        File tempFile = new File(destination.getParentFile(), destination.getName() + ".tmp");
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(artworkUrl).openConnection();
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(12000);
            connection.setRequestProperty("Accept", "image/*,*/*");
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("Image returned " + status);
            try (
                InputStream input = connection.getInputStream();
                FileOutputStream output = new FileOutputStream(tempFile)
            ) {
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                }
            }
            if (!tempFile.renameTo(destination)) {
                throw new IllegalStateException("Could not move artwork into cache");
            }
            destination.setLastModified(System.currentTimeMillis());
            trimCache();
        } catch (Exception error) {
            Log.w(TAG, "Could not cache artwork", error);
            tempFile.delete();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void trimCache() {
        File[] files = cacheDirectory.listFiles((file) -> file.isFile() && !file.getName().endsWith(".tmp"));
        if (files == null) return;
        long totalBytes = 0;
        for (File file : files) totalBytes += Math.max(0, file.length());
        if (totalBytes <= MAX_CACHE_BYTES) return;
        Arrays.sort(files, (left, right) -> Long.compare(left.lastModified(), right.lastModified()));
        for (File file : files) {
            if (totalBytes <= MAX_CACHE_BYTES) break;
            long size = Math.max(0, file.length());
            if (file.delete()) totalBytes -= size;
        }
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte next : bytes) result.append(String.format("%02x", next));
            return result.toString();
        } catch (Exception error) {
            return String.valueOf(value.hashCode());
        }
    }

    private final class ArtworkJob implements Runnable, Comparable<ArtworkJob> {
        final int priority;
        final long order;
        final String artworkUrl;
        final File destination;

        ArtworkJob(int priority, long order, String artworkUrl, File destination) {
            this.priority = priority;
            this.order = order;
            this.artworkUrl = artworkUrl;
            this.destination = destination;
        }

        @Override
        public int compareTo(ArtworkJob other) {
            int priorityCompare = Integer.compare(priority, other.priority);
            return priorityCompare != 0 ? priorityCompare : Long.compare(order, other.order);
        }

        @Override
        public void run() {
            try {
                fetch(artworkUrl, destination);
            } finally {
                queuedKeys.remove(destination.getName());
            }
        }
    }
}
