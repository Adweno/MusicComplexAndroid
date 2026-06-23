package com.musiccomplex.app;

final class MusicComplexPlayerRules {
    private MusicComplexPlayerRules() {}

    static int nextIndexAfterCompletion(int currentIndex, int queueSize) {
        int nextIndex = currentIndex + 1;
        return nextIndex < queueSize ? nextIndex : -1;
    }

    static int previousIndexForControl(int currentIndex, int queueSize, int positionMs) {
        if (currentIndex < 0 || queueSize <= 0) return -1;
        if (positionMs > 3000 || currentIndex == 0) return currentIndex;
        return currentIndex - 1;
    }

    static boolean shouldHandleAutoControlWithNativePlayer(boolean hasNativeQueue) {
        return hasNativeQueue;
    }

    static boolean shouldHoldPlaybackLocks(boolean hasQueue, boolean playing, boolean preparing) {
        return hasQueue && (playing || preparing);
    }

    static int adjustedCastVolume(int currentVolume, int direction) {
        int delta = direction > 0 ? 5 : direction < 0 ? -5 : 0;
        return clampPercent(currentVolume + delta);
    }

    static int clampPercent(int value) {
        return Math.max(0, Math.min(100, value));
    }

    static int castQueueLocalIndexForAppIndex(int[] appIndices, int appIndex) {
        if (appIndices == null || appIndex < 0) return -1;
        for (int index = 0; index < appIndices.length; index += 1) {
            if (appIndices[index] == appIndex) return index;
        }
        return -1;
    }
}
