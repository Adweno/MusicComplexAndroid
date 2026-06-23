import { describe, expect, it } from 'vitest';
import {
  buildPlaybackQueue,
  buildSelectedCollectionQueue,
  inferCastFinished,
  moveQueueItemState,
  nextQueueStep,
  removeQueueItemState,
  toggleShuffleState,
  trackIdentity,
} from './playbackLogic';

const tracks = ['A', 'B', 'C', 'D', 'E'].map((title, index) => ({
  ratingKey: String(index + 1),
  title,
  grandparentTitle: 'Artist',
  parentTitle: 'Album',
}));

function titles(items) {
  return items.map((track) => track.title);
}

describe('trackIdentity', () => {
  it('prefers Plex ids and falls back to track metadata', () => {
    expect(trackIdentity({ ratingKey: '123', title: 'Song' })).toBe('123');
    expect(trackIdentity({ key: '/library/metadata/456', title: 'Song' })).toBe('/library/metadata/456');
    expect(trackIdentity({ grandparentTitle: 'A', parentTitle: 'B', title: 'C' })).toBe('A:B:C');
  });
});

describe('buildPlaybackQueue', () => {
  it('starts the queue at the selected track when shuffle is off', () => {
    const result = buildPlaybackQueue(tracks, tracks[2]);

    expect(result.startIndex).toBe(2);
    expect(titles(result.orderedPlaybackQueue)).toEqual(['C', 'D', 'E']);
    expect(titles(result.playbackQueue)).toEqual(['C', 'D', 'E']);
  });

  it('keeps the selected track first when shuffle is on', () => {
    const result = buildPlaybackQueue(tracks, tracks[2], {
      shuffled: true,
      random: () => 0,
    });

    expect(result.playbackQueue[0]).toBe(tracks[2]);
    expect(titles(result.playbackQueue).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(titles(result.orderedPlaybackQueue)).toEqual(['C', 'D', 'E']);
  });
});

describe('buildSelectedCollectionQueue', () => {
  it('queues a selected collection without selecting a current track', () => {
    const result = buildSelectedCollectionQueue(tracks, { shuffled: false });

    expect(titles(result.queue)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(result.currentIndex).toBe(-1);
    expect(result.shuffle).toBe(false);
  });

  it('can create a shuffled queue before playback starts', () => {
    const result = buildSelectedCollectionQueue(tracks, {
      shuffled: true,
      random: () => 0,
    });

    expect(titles(result.queue).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(result.currentIndex).toBe(-1);
    expect(result.shuffle).toBe(true);
  });
});

describe('toggleShuffleState', () => {
  it('keeps the current track first when shuffle is enabled during playback', () => {
    const result = toggleShuffleState({
      queue: tracks,
      currentIndex: 2,
      currentTrack: tracks[2],
      shuffle: false,
      random: () => 0,
    });

    expect(result.queue[0]).toBe(tracks[2]);
    expect(result.currentIndex).toBe(0);
    expect(result.shuffle).toBe(true);
    expect(titles(result.orderedQueue)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('restores the ordered queue when shuffle is disabled', () => {
    const shuffledQueue = [tracks[2], tracks[4], tracks[0], tracks[1], tracks[3]];
    const result = toggleShuffleState({
      queue: shuffledQueue,
      currentIndex: 0,
      currentTrack: tracks[2],
      shuffle: true,
      orderedQueue: tracks,
    });

    expect(titles(result.queue)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(result.currentIndex).toBe(2);
    expect(result.shuffle).toBe(false);
  });
});

describe('nextQueueStep', () => {
  it('advances to the next track before the queue ends', () => {
    expect(nextQueueStep({ queue: tracks, currentIndex: 1, repeat: 'off', fromEnded: true }))
      .toEqual({ type: 'next', nextIndex: 2 });
  });

  it('repeats one track when repeat-one is active and the track ended', () => {
    expect(nextQueueStep({ queue: tracks, currentIndex: 1, repeat: 'one', fromEnded: true }))
      .toEqual({ type: 'repeat-one', nextIndex: 1 });
  });

  it('wraps to the first track when repeat-all is active', () => {
    expect(nextQueueStep({ queue: tracks, currentIndex: 4, repeat: 'all', fromEnded: true }))
      .toEqual({ type: 'repeat-all', nextIndex: 0 });
  });

  it('finishes when the queue ends and repeat is off', () => {
    expect(nextQueueStep({ queue: tracks, currentIndex: 4, repeat: 'off', fromEnded: true }))
      .toEqual({ type: 'finished', nextIndex: 4 });
  });
});

describe('queue editing', () => {
  it('removes upcoming tracks and adjusts the current index', () => {
    const result = removeQueueItemState({
      queue: tracks,
      currentIndex: 3,
      orderedQueue: tracks,
    }, 1);

    expect(titles(result.queue)).toEqual(['A', 'C', 'D', 'E']);
    expect(result.currentIndex).toBe(2);
    expect(result.removedTrack).toBe(tracks[1]);
  });

  it('blocks removing the current track', () => {
    const result = removeQueueItemState({
      queue: tracks,
      currentIndex: 2,
      orderedQueue: tracks,
    }, 2);

    expect(result.blocked).toBe(true);
    expect(titles(result.queue)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('moves queue items by drag/drop while preserving the current track', () => {
    const result = moveQueueItemState({ queue: tracks, currentIndex: 2 }, 4, 1);

    expect(titles(result.queue)).toEqual(['A', 'E', 'B', 'C', 'D']);
    expect(result.currentIndex).toBe(3);
    expect(result.movedTrack).toBe(tracks[4]);
  });

  it('blocks moving the currently playing queue item', () => {
    const result = moveQueueItemState({ queue: tracks, currentIndex: 2 }, 2, 4);

    expect(result.blocked).toBe(true);
    expect(titles(result.queue)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});

describe('inferCastFinished', () => {
  it('infers completion when Chromecast returns blank status after a near-finished playing status', () => {
    const result = inferCastFinished({
      advanceQueue: true,
      status: { currentTime: 0, duration: 0, playerState: '' },
      previousStatus: {
        currentTime: 251.7,
        duration: 262.45,
        playerState: 'PLAYING',
        timestamp: 1000,
      },
      now: 11000,
    });

    expect(result).toBe(true);
  });

  it('does not infer completion when the previous live status was not close enough to the end', () => {
    const result = inferCastFinished({
      advanceQueue: true,
      status: { currentTime: 0, duration: 0, playerState: '' },
      previousStatus: {
        currentTime: 120,
        duration: 300,
        playerState: 'PLAYING',
        timestamp: 1000,
      },
      now: 11000,
    });

    expect(result).toBe(false);
  });
});
