package com.musiccomplex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class MusicComplexAutoRulesTest {
    @Test
    public void smallPlaylistsAreNotPaged() {
        assertFalse(MusicComplexAutoRules.shouldPagePlaylist(100));
        assertEquals(1, MusicComplexAutoRules.pageCount(100));
    }

    @Test
    public void largePlaylistsAreSplitIntoHundredSongPages() {
        assertTrue(MusicComplexAutoRules.shouldPagePlaylist(251));
        assertEquals(3, MusicComplexAutoRules.pageCount(251));
        assertEquals(0, MusicComplexAutoRules.pageStart(0, 251));
        assertEquals(100, MusicComplexAutoRules.pageEndExclusive(0, 251));
        assertEquals(200, MusicComplexAutoRules.pageStart(2, 251));
        assertEquals(251, MusicComplexAutoRules.pageEndExclusive(2, 251));
    }

    @Test
    public void emptyPlaylistsHaveNoPages() {
        assertEquals(0, MusicComplexAutoRules.pageCount(0));
        assertEquals(0, MusicComplexAutoRules.pageStart(0, 0));
        assertEquals(0, MusicComplexAutoRules.pageEndExclusive(0, 0));
    }

    @Test
    public void lazyShufflePrefetchesBeforeTheCurrentChunkRunsOut() {
        assertTrue(MusicComplexAutoRules.LAZY_SHUFFLE_PREFETCH_THRESHOLD > 0);
        assertTrue(MusicComplexAutoRules.LAZY_SHUFFLE_PREFETCH_THRESHOLD < MusicComplexAutoRules.PLAY_QUEUE_WINDOW_SIZE);
        assertEquals(100, MusicComplexAutoRules.PLAY_QUEUE_WINDOW_SIZE);
    }

    @Test
    public void audioCacheKeepsCurrentTrackAndFiveUpcomingTracks() {
        assertEquals(9, MusicComplexAutoRules.audioCacheWindowEndExclusive(3, 20));
        assertEquals(20, MusicComplexAutoRules.audioCacheWindowEndExclusive(18, 20));
        assertEquals(0, MusicComplexAutoRules.audioCacheWindowEndExclusive(-1, 20));
        assertEquals(0, MusicComplexAutoRules.audioCacheWindowEndExclusive(0, 0));
    }
}
