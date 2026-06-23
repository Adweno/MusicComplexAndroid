package com.musiccomplex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class MusicComplexPlayerRulesTest {
    @Test
    public void nextIndexAfterCompletionAdvancesInsideQueue() {
        assertEquals(2, MusicComplexPlayerRules.nextIndexAfterCompletion(1, 4));
    }

    @Test
    public void nextIndexAfterCompletionStopsAtQueueEnd() {
        assertEquals(-1, MusicComplexPlayerRules.nextIndexAfterCompletion(3, 4));
        assertEquals(-1, MusicComplexPlayerRules.nextIndexAfterCompletion(-1, 0));
    }

    @Test
    public void previousControlRestartsCurrentTrackAfterAFewSeconds() {
        assertEquals(2, MusicComplexPlayerRules.previousIndexForControl(2, 5, 3500));
    }

    @Test
    public void previousControlMovesToPreviousTrackNearBeginning() {
        assertEquals(1, MusicComplexPlayerRules.previousIndexForControl(2, 5, 2500));
    }

    @Test
    public void previousControlRestartsFirstTrackInsteadOfLeavingQueue() {
        assertEquals(0, MusicComplexPlayerRules.previousIndexForControl(0, 5, 500));
    }

    @Test
    public void previousControlRejectsEmptyQueues() {
        assertEquals(-1, MusicComplexPlayerRules.previousIndexForControl(-1, 0, 500));
    }

    @Test
    public void androidAutoControlsNativePlayerWhenNativeQueueExists() {
        assertTrue(MusicComplexPlayerRules.shouldHandleAutoControlWithNativePlayer(true));
        assertFalse(MusicComplexPlayerRules.shouldHandleAutoControlWithNativePlayer(false));
    }

    @Test
    public void playbackLocksAreHeldOnlyForActiveQueues() {
        assertTrue(MusicComplexPlayerRules.shouldHoldPlaybackLocks(true, true, false));
        assertTrue(MusicComplexPlayerRules.shouldHoldPlaybackLocks(true, false, true));
        assertFalse(MusicComplexPlayerRules.shouldHoldPlaybackLocks(false, true, false));
        assertFalse(MusicComplexPlayerRules.shouldHoldPlaybackLocks(true, false, false));
    }

    @Test
    public void castVolumeAdjustsInSmallClampedSteps() {
        assertEquals(55, MusicComplexPlayerRules.adjustedCastVolume(50, 1));
        assertEquals(45, MusicComplexPlayerRules.adjustedCastVolume(50, -1));
        assertEquals(50, MusicComplexPlayerRules.adjustedCastVolume(50, 0));
        assertEquals(100, MusicComplexPlayerRules.adjustedCastVolume(98, 1));
        assertEquals(0, MusicComplexPlayerRules.adjustedCastVolume(2, -1));
    }

    @Test
    public void castVolumeSetIsClampedToPercentRange() {
        assertEquals(0, MusicComplexPlayerRules.clampPercent(-10));
        assertEquals(42, MusicComplexPlayerRules.clampPercent(42));
        assertEquals(100, MusicComplexPlayerRules.clampPercent(120));
    }
}
