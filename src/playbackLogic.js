export function trackIdentity(track) {
  return track?.ratingKey || track?.key || `${track?.grandparentTitle || ''}:${track?.parentTitle || ''}:${track?.title || ''}`;
}

export function shuffleTracks(items, random = Math.random) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function buildPlaybackQueue(nextQueue, startTrack, { shuffled = false, random = Math.random } = {}) {
  const sourceQueue = nextQueue.filter(Boolean);
  const startIdentity = trackIdentity(startTrack);
  const startIndex = Math.max(0, sourceQueue.findIndex((track) => trackIdentity(track) === startIdentity));
  const orderedPlaybackQueue = sourceQueue.slice(startIndex);
  const playbackQueue = shuffled
    ? [sourceQueue[startIndex], ...shuffleTracks(sourceQueue.filter((_, itemIndex) => itemIndex !== startIndex), random)]
    : orderedPlaybackQueue;

  return {
    startIndex,
    sourceQueue,
    orderedPlaybackQueue,
    playbackQueue: playbackQueue.filter(Boolean),
  };
}

export function buildSelectedCollectionQueue(tracks, { shuffled = false, random = Math.random } = {}) {
  const orderedQueue = [...tracks];
  return {
    queue: shuffled ? shuffleTracks(tracks, random) : orderedQueue,
    orderedQueue,
    currentIndex: -1,
    shuffle: shuffled,
  };
}

export function toggleShuffleState({
  queue,
  currentIndex,
  currentTrack,
  shuffle,
  orderedQueue = [],
  random = Math.random,
}) {
  if (!queue.length) {
    return { queue, currentIndex, shuffle, orderedQueue };
  }

  if (!shuffle) {
    if (currentTrack) {
      const remaining = queue.filter((_, index) => index !== currentIndex);
      return {
        queue: [currentTrack, ...shuffleTracks(remaining, random)],
        currentIndex: 0,
        shuffle: true,
        orderedQueue: queue,
      };
    }

    return {
      queue: shuffleTracks(queue, random),
      currentIndex: -1,
      shuffle: true,
      orderedQueue: queue,
    };
  }

  const restoredQueue = orderedQueue.length ? orderedQueue : queue;
  const restoredIndex = currentTrack
    ? Math.max(0, restoredQueue.findIndex((track) => trackIdentity(track) === trackIdentity(currentTrack)))
    : -1;

  return {
    queue: restoredQueue,
    currentIndex: restoredIndex,
    shuffle: false,
    orderedQueue,
  };
}

export function removeQueueItemState({ queue, currentIndex, orderedQueue = [] }, removeIndex) {
  if (removeIndex === currentIndex) {
    return {
      queue,
      currentIndex,
      orderedQueue,
      removedTrack: null,
      blocked: true,
    };
  }

  const removedTrack = queue[removeIndex];
  const nextQueue = queue.filter((_, itemIndex) => itemIndex !== removeIndex);
  const nextIndex = removeIndex < currentIndex ? currentIndex - 1 : currentIndex;
  let removedFromOrdered = false;
  const nextOrderedQueue = orderedQueue.filter((track) => {
    if (!removedFromOrdered && trackIdentity(track) === trackIdentity(removedTrack)) {
      removedFromOrdered = true;
      return false;
    }
    return true;
  });

  return {
    queue: nextQueue,
    currentIndex: nextQueue.length ? nextIndex : -1,
    orderedQueue: nextOrderedQueue,
    removedTrack,
    blocked: false,
  };
}

export function moveQueueItemState({ queue, currentIndex }, fromIndex, toIndex) {
  if (fromIndex === currentIndex || toIndex === currentIndex) {
    return { queue, currentIndex, movedTrack: null, blocked: true };
  }
  if (toIndex < 0 || toIndex >= queue.length || fromIndex === toIndex) {
    return { queue, currentIndex, movedTrack: null, blocked: true };
  }

  const nextQueue = [...queue];
  const [movedTrack] = nextQueue.splice(fromIndex, 1);
  nextQueue.splice(toIndex, 0, movedTrack);

  let nextIndex = currentIndex;
  if (currentIndex >= 0) {
    if (fromIndex < currentIndex && toIndex >= currentIndex) nextIndex -= 1;
    if (fromIndex > currentIndex && toIndex <= currentIndex) nextIndex += 1;
  }

  return {
    queue: nextQueue,
    currentIndex: nextIndex,
    movedTrack,
    blocked: false,
  };
}

export function nextQueueStep({ queue, currentIndex, repeat, fromEnded }) {
  if (!queue.length) return { type: 'noop', nextIndex: currentIndex };
  if (repeat === 'one' && fromEnded) return { type: 'repeat-one', nextIndex: currentIndex };

  const nextIndex = currentIndex + 1;
  if (nextIndex < queue.length) return { type: 'next', nextIndex };
  if (repeat === 'all') return { type: 'repeat-all', nextIndex: 0 };
  return { type: 'finished', nextIndex: currentIndex };
}

export function inferCastFinished({
  advanceQueue,
  status,
  previousStatus,
  now,
  fallbackDuration = 0,
}) {
  const hasLiveStatus = Boolean(status?.playerState || status?.duration || status?.currentTime);
  const statusDuration = status?.duration || fallbackDuration;
  const previousRemaining = previousStatus
    ? Math.max(0, previousStatus.duration - previousStatus.currentTime)
    : Infinity;
  const secondsSincePrevious = previousStatus
    ? (now - previousStatus.timestamp) / 1000
    : 0;

  return Boolean(
    advanceQueue
      && !hasLiveStatus
      && previousStatus?.playerState === 'PLAYING'
      && previousStatus.duration > 0
      && secondsSincePrevious >= Math.max(1, previousRemaining - 2),
  );
}
