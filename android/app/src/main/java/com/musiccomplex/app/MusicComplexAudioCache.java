package com.musiccomplex.app;

import android.content.Context;
import android.net.Uri;
import android.util.Log;

import androidx.media3.common.util.UnstableApi;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.CacheKeyFactory;
import androidx.media3.datasource.cache.CacheWriter;
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;

import java.io.File;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

@UnstableApi
final class MusicComplexAudioCache {
    private static final String TAG = "MusicComplexAudioCache";
    private static final long MAX_CACHE_BYTES = 512L * 1024L * 1024L;

    private final SimpleCache cache;
    private final CacheDataSource.Factory dataSourceFactory;
    private final ExecutorService prefetchExecutor = Executors.newSingleThreadExecutor();
    private final AtomicInteger generation = new AtomicInteger();
    private volatile CacheWriter activeWriter;

    MusicComplexAudioCache(Context context) {
        Context appContext = context.getApplicationContext();
        File cacheDirectory = new File(appContext.getCacheDir(), "audio-prefetch");
        cache = new SimpleCache(
            cacheDirectory,
            new LeastRecentlyUsedCacheEvictor(MAX_CACHE_BYTES),
            new StandaloneDatabaseProvider(appContext)
        );
        dataSourceFactory = new CacheDataSource.Factory()
            .setCache(cache)
            .setUpstreamDataSourceFactory(new DefaultDataSource.Factory(appContext))
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);
    }

    CacheDataSource.Factory dataSourceFactory() {
        return dataSourceFactory;
    }

    void updateWindow(List<Uri> retainedUris, List<Uri> prefetchUris) {
        int nextGeneration = generation.incrementAndGet();
        CacheWriter writer = activeWriter;
        if (writer != null) writer.cancel();

        List<Uri> retained = new ArrayList<>(retainedUris);
        List<Uri> upcoming = new ArrayList<>(prefetchUris);
        prefetchExecutor.execute(() -> {
            if (generation.get() != nextGeneration) return;
            evictOutsideWindow(retained);
            for (Uri uri : upcoming) {
                if (generation.get() != nextGeneration) return;
                DataSpec dataSpec = new DataSpec.Builder().setUri(uri).build();
                CacheWriter nextWriter = new CacheWriter(
                    dataSourceFactory.createDataSource(),
                    dataSpec,
                    null,
                    null
                );
                activeWriter = nextWriter;
                try {
                    nextWriter.cache();
                } catch (Exception error) {
                    if (generation.get() == nextGeneration) {
                        Log.w(TAG, "Could not prefetch " + uri, error);
                    }
                } finally {
                    if (activeWriter == nextWriter) activeWriter = null;
                }
            }
        });
    }

    void release() {
        generation.incrementAndGet();
        CacheWriter writer = activeWriter;
        if (writer != null) writer.cancel();
        prefetchExecutor.shutdownNow();
        try {
            prefetchExecutor.awaitTermination(1, TimeUnit.SECONDS);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        }
        try {
            cache.release();
        } catch (Exception error) {
            Log.w(TAG, "Could not close audio cache", error);
        }
    }

    private void evictOutsideWindow(List<Uri> retainedUris) {
        Set<String> retainedKeys = new HashSet<>();
        for (Uri uri : retainedUris) {
            retainedKeys.add(CacheKeyFactory.DEFAULT.buildCacheKey(
                new DataSpec.Builder().setUri(uri).build()
            ));
        }
        for (String cacheKey : new HashSet<>(cache.getKeys())) {
            if (retainedKeys.contains(cacheKey)) continue;
            try {
                cache.removeResource(cacheKey);
            } catch (Exception error) {
                Log.w(TAG, "Could not evict stale audio cache entry", error);
            }
        }
    }
}
