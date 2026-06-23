# Music Complex for Android

Android and Android Auto Plex music player built with Capacitor, React, Vite, and native Android media services.

## Features

- Plex account sign-in from the phone app
- Artist, album, playlist, and track browsing
- Queue management
- Local Android playback
- Chromecast playback from the mobile app
- Android Auto browsing and playback
- Rolling audio prefetch for upcoming Auto tracks
- Bounded artwork cache with now-playing priority
- Light and dark themes

## Run Web Shell

```powershell
npm install
npm run dev
```

## Sync Android Assets

```powershell
npm run android:sync
```

## Build Debug APK

```powershell
npm run android:apk
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

## Notes

This repo intentionally excludes the Electron Windows app. The Windows app lives in the separate `Music-Complex-Windows` repo.
