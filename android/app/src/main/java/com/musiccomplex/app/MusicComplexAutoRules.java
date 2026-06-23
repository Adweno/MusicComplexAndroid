package com.musiccomplex.app;

final class MusicComplexAutoRules {
    static final int PLAYLIST_PAGE_SIZE = 100;
    static final int LAZY_SHUFFLE_PREFETCH_THRESHOLD = 25;
    static final int PLAY_QUEUE_WINDOW_SIZE = 100;
    static final int AUDIO_PREFETCH_COUNT = 5;

    private MusicComplexAutoRules() {
    }

    static int pageCount(int itemCount) {
        if (itemCount <= 0) return 0;
        return (itemCount + PLAYLIST_PAGE_SIZE - 1) / PLAYLIST_PAGE_SIZE;
    }

    static int pageStart(int pageIndex, int itemCount) {
        if (pageIndex < 0 || itemCount <= 0) return 0;
        return Math.min(pageIndex * PLAYLIST_PAGE_SIZE, itemCount);
    }

    static int pageEndExclusive(int pageIndex, int itemCount) {
        return Math.min(pageStart(pageIndex, itemCount) + PLAYLIST_PAGE_SIZE, Math.max(0, itemCount));
    }

    static boolean shouldPagePlaylist(int itemCount) {
        return itemCount > PLAYLIST_PAGE_SIZE;
    }

    static int audioCacheWindowEndExclusive(int currentIndex, int itemCount) {
        if (currentIndex < 0 || itemCount <= 0) return 0;
        return Math.min(itemCount, currentIndex + AUDIO_PREFETCH_COUNT + 1);
    }
}
