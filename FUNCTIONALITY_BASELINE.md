# Music Complex Functionality Baseline

Use this checklist as the parity contract for a mobile version. A mobile build should keep each checked behavior unless we explicitly decide to redesign it.

## App Identity

- [ ] The app is named `Music Complex`.
- [ ] The MC logo is used for the app icon, taskbar/dock icon where supported, and empty/default hero artwork.
- [ ] The main app view does not show a native desktop menu bar.
- [ ] The home screen opens directly into the music player/browser experience, not a landing page.

## Settings And Persistence

- [ ] Settings are available from a gear icon.
- [ ] Settings include Dark and Light theme switching.
- [ ] Theme choice persists across launches.
- [ ] Plex server URL, Plex token, selected library, Plex account token, and selected Plex server persist across launches.
- [ ] Settings can be dismissed without changing playback state.
- [ ] Status/error messages from connection attempts are visible in settings.

## Plex Authentication And Connection

- [ ] User can sign in with a Plex account.
- [ ] Plex sign-in opens Plex authentication externally and polls for the auth token.
- [ ] After sign-in, available Plex Media Server resources are discovered.
- [ ] User can select a discovered Plex server and connect to it.
- [ ] Server connection tries local/non-relay HTTP URLs first, then falls back through other reported URLs.
- [ ] Manual Plex server URL plus token connection remains available.
- [ ] User can select a music library after connection.
- [ ] User can refresh the selected library.
- [ ] If no music library exists, the app reports that clearly.

## Plex Library Data

- [ ] Music libraries load only Plex sections with artist-type libraries.
- [ ] Artists load sorted by title.
- [ ] Audio playlists load from Plex.
- [ ] Duplicate playlist names are deduplicated, preferring playlists with playable items, usable keys, non-smart playlists, and higher track counts.
- [ ] Playlists are displayed sorted by track count descending.
- [ ] Album artwork, playlist composite art, artist art, and track art resolve through authenticated Plex image URLs.
- [ ] Track streams resolve through authenticated Plex media part URLs.
- [ ] Track MIME type supports at least MP3/MPEG, FLAC, M4A/MP4, OGG, and WAV.

## Browsing Modes

- [ ] User can browse by Artists.
- [ ] User can browse by Playlists.
- [ ] Switching browse modes does not interrupt currently playing music.
- [ ] Artist search filters the artist list locally.
- [ ] Playlist search filters the playlist list locally.
- [ ] Track search queries Plex search when in artist mode.
- [ ] Search text can be cleared.

## Artist Browsing

- [ ] Selecting an artist loads that artist's albums.
- [ ] Selecting an artist also loads that artist's tracks so the artist can be played or shuffled without selecting an album.
- [ ] Selecting an artist updates the hero area to show that artist.
- [ ] Selecting an artist does not automatically start playback.
- [ ] Artist album lists are cached with a bounded cache.
- [ ] Nearby artists are prefetched to make artist switching faster.
- [ ] Artist track lists are cached with a bounded cache.

## Album Browsing

- [ ] Albums display as compact square cover cards.
- [ ] Only the first chunk of album cards is rendered in the current desktop UI for performance.
- [ ] Selecting an album loads its tracks.
- [ ] Selecting an album updates the hero area to show that album.
- [ ] Selecting an album does not automatically start playback.
- [ ] Album track lists populate the track panel.

## Playlist Browsing

- [ ] Selecting a playlist loads its tracks.
- [ ] Selecting a playlist updates the hero area to show that playlist, not the last played song.
- [ ] Selecting a playlist does not automatically start playback.
- [ ] Playlist view uses a two-column layout on desktop: playlists and tracks.
- [ ] Large playlists remain responsive by virtualizing the track list.
- [ ] If Plex returns an empty playlist response but another matching playlist object exists, the app tries the matching playlist fallback.

## Track Selection

- [ ] Clicking a track selects it.
- [ ] Clicking a track does not interrupt current playback.
- [ ] Double-clicking a track starts playback from that track.
- [ ] The hero Play button can play the selected track.
- [ ] The currently playing track is visually distinct from the selected-but-not-playing track.
- [ ] Track rows show track number/index, title, artist, duration, add-to-queue action, and add-to-playlist action.

## Hero Area

- [ ] With no selection or playback, the hero shows the logo and "Pick a track".
- [ ] With selected artist, the hero shows artist title plus album/track count context.
- [ ] With selected album, the hero shows album title, artist, and year when available.
- [ ] With selected playlist, the hero shows playlist title and loaded track count.
- [ ] With selected track, the hero shows track title, artist, and album.
- [ ] With active playback and no selected collection overriding it, the hero can show now-playing information.
- [ ] Hero Play acts on the current selection before falling back to the current queue.
- [ ] Hero Shuffle creates a queue from the selected artist/album/playlist if no queue exists.
- [ ] Hero Repeat creates a queue from the selected artist/album/playlist if no queue exists.

## Queue Creation

- [ ] Playing a track creates a queue starting with that track.
- [ ] When not shuffled, the queue contains the selected track followed by later tracks from the source album/playlist/artist list.
- [ ] Tracks before the selected track are not inserted as "Played" when starting playback.
- [ ] When shuffled, the selected track starts first and all other source tracks may follow in shuffled order.
- [ ] Playing an artist, album, or playlist starts from the first track when shuffle is off.
- [ ] Playing an artist, album, or playlist starts from a random track when shuffle is on.
- [ ] Selecting browse items alone does not replace or stop the active queue.

## Queue Management

- [ ] Queue popover is available from the queue button.
- [ ] Queue shows current track as `Now`.
- [ ] Queue shows prior tracks as `Played`.
- [ ] Queue shows upcoming tracks relative to the current track.
- [ ] Clicking a queue item starts that queue item.
- [ ] Upcoming tracks can be removed.
- [ ] The currently playing track cannot be removed from the queue.
- [ ] Upcoming queue can be cleared while preserving the current/played portion.
- [ ] Queue can be fully cleared when nothing is currently selected/playing.
- [ ] Tracks can be added to the queue from the track list.
- [ ] Queue items can be reordered by drag and drop.
- [ ] The currently playing queue item cannot be dragged or used as a drop target.
- [ ] Reordering preserves the correct current track index.

## Shuffle And Repeat

- [ ] Shuffle toggles on/off.
- [ ] Turning shuffle on preserves the current track at the front when one is playing.
- [ ] Turning shuffle on with no current track shuffles the current queue.
- [ ] Turning shuffle off restores the previous ordered queue when available.
- [ ] Repeat cycles `off -> all -> one -> off`.
- [ ] Repeat one restarts the current track when it ends.
- [ ] Repeat all returns to the first queue item after the last item ends.
- [ ] Shuffle/repeat buttons work against a selected artist, album, or playlist even before playback starts.

## Local Playback

- [ ] Local playback uses the HTML audio element.
- [ ] Play/Pause controls always reflect the current playing state.
- [ ] Bottom transport Play/Pause controls the current track, regardless of browser selection.
- [ ] Previous restarts the local track if more than four seconds have elapsed.
- [ ] Previous goes to the prior queue item when near the start.
- [ ] Next advances to the next queue item and updates Play/Pause state.
- [ ] Seeking updates local audio current time.
- [ ] Progress bar tracks local playback time.
- [ ] Local audio auto-advances near the end of a track and on the ended event.
- [ ] Local auto-advance handles repeat one and repeat all.
- [ ] Local playback logs start, success, error, ended, and near-end advance events.

## Volume

- [ ] Volume slider controls computer/system volume during local playback.
- [ ] App audio element volume remains full scale while system volume is changed.
- [ ] Volume changes are debounced.
- [ ] Volume slider controls Chromecast volume when a cast device is selected.
- [ ] Initial local volume is read from system volume where supported.

## Now Playing Bar

- [ ] Bottom now-playing bar shows the current track title.
- [ ] Bottom now-playing bar shows the current artist.
- [ ] Bottom now-playing bar shows the current track album art when available.
- [ ] Bottom now-playing art does not depend on the current browser selection.
- [ ] Clicking the now-playing artist navigates to that artist in the music browser.
- [ ] Navigating to the now-playing artist loads that artist's albums/tracks without interrupting playback.

## Chromecast Discovery

- [ ] Cast menu opens from a single cast button.
- [ ] Cast menu contains `This Device` as a local playback option.
- [ ] Cast menu lists discovered Chromecast devices.
- [ ] Cast devices can be rescanned manually.
- [ ] Chromecast discovery combines `chromecast-api` discovery and raw mDNS `_googlecast._tcp.local` scanning.
- [ ] Duplicate Chromecast devices are deduped by stable display/device keys.
- [ ] Device records prefer richer host/IP data when duplicates are found.
- [ ] Cast UI reports when casting support is unavailable.

## Chromecast Connection

- [ ] Clicking a cast device fully connects to it before playback is requested.
- [ ] Switching from one cast device to another stops the prior cast receiver.
- [ ] Switching from local playback to Chromecast preserves the current track position.
- [ ] Switching between cast devices preserves the current track position.
- [ ] Choosing `This Device` disconnects from Chromecast.
- [ ] Switching from Chromecast back to this device preserves the current track position if music was playing.
- [ ] The selected cast device remains selected across transient status failures while active playback is ongoing.
- [ ] Idle/stale cast connections are health-checked.
- [ ] If idle cast controls are lost repeatedly, the app falls back to `This Device`.

## Chromecast Playback

- [ ] Chromecast playback sends track URL, MIME type, cover art, title, subtitle, and optional start time.
- [ ] Local audio pauses when casting starts.
- [ ] Cast Play/Pause controls Chromecast playback.
- [ ] Cast seek controls Chromecast seek.
- [ ] Cast progress is polled while casting.
- [ ] Cast duration uses Chromecast-reported duration, falling back to Plex track duration.
- [ ] Cast auto-advances the queue when Chromecast reports idle/finished.
- [ ] Cast auto-advance also handles the observed blank-status-after-finish case by inferring completion from the last live status.
- [ ] Cast repeat one and repeat all follow the same queue rules as local playback.
- [ ] Cast playback logs play, control, status, errors, polling, and auto-advance events.

## Playlists

- [ ] Each track has an Add to playlist action.
- [ ] Add to playlist opens a playlist picker modal.
- [ ] Playlist picker lists audio playlists with track counts.
- [ ] Adding a track to a playlist calls Plex with the server machine identifier and track metadata URI.
- [ ] Playlist list refreshes after a successful add.
- [ ] Errors while adding to playlists are displayed.

## Keyboard And Desktop Controls

- [ ] Space toggles playback when focus is not in an input/select/textarea.
- [ ] ArrowRight advances to the next track.
- [ ] ArrowLeft goes to previous/restart behavior.
- [ ] Desktop packaged app sets the Windows App User Model ID.
- [ ] Desktop packaged app uses the MC icon.
- [ ] Desktop app uses a hidden/removed native menu bar.

## Performance Requirements

- [ ] Large track lists are virtualized.
- [ ] Track list scroll position resets when artist, album, or playlist selection changes.
- [ ] Artist album and artist track caches are bounded.
- [ ] Artist track loading batches album-track requests in small chunks.
- [ ] Stale artist track loads are ignored when the user switches artists quickly.
- [ ] Large playlists should remain responsive while rendering and scrolling.
- [ ] Mobile version should avoid loading/rendering unnecessary artwork at full resolution.

## Error Handling And Diagnostics

- [ ] User-visible status is updated for Plex connection, library load, artist load, album load, playlist load, playback, cast, and playlist-add errors.
- [ ] Renderer logs notable playback, queue, and cast events through the desktop bridge.
- [ ] Desktop logs are written to the app user data logs directory.
- [ ] Mobile version needs an equivalent debug log/export path before beta testing.

## Mobile Parity Decisions To Make

- [ ] Decide whether mobile controls device hardware volume, app media volume, or cast volume depending on platform limits.
- [ ] Decide how Plex sign-in opens and returns from the browser on iOS/Android.
- [ ] Decide whether Chromecast uses native mobile Cast SDKs instead of the desktop `chromecast-api` bridge.
- [ ] Decide whether local network device discovery needs user permissions and onboarding copy.
- [ ] Decide whether mobile supports keyboard shortcuts on tablets/external keyboards.
- [ ] Decide whether queue drag-and-drop should use long-press drag handles on touch.
- [ ] Decide how to expose logs on mobile for troubleshooting.
