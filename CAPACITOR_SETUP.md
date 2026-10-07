# Wrapping CodeEditor v2 as an Android app (Capacitor)

`capacitor.config.json` points `webDir` at `docs/` — the folder `npm run build`
writes (the same folder GitHub Pages serves), so the APK always wraps your
latest build.

## 1. Pick a real app ID first

Change `appId` in `capacitor.config.json` from `com.example.codeeditor` to your
own reverse-domain id (e.g. `com.yourname.codeeditor`). It is baked into the
native project when you add the platform; changing it later means editing
several native files by hand.

## 2. Install Capacitor and the filesystem plugin

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/filesystem
```

Skip `npx cap init` — the config file already exists.

## 3. Add the Android platform

```bash
npx cap add android
```

## 4. Permissions (android/app/src/main/AndroidManifest.xml)

Inside `<manifest>`:

```xml
<!-- Spec §4.2 Option B: real project folders on shared storage -->
<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />
<!-- keys-bar / gesture haptics (navigator.vibrate) -->
<uses-permission android:name="android.permission.VIBRATE" />
<!-- git push / pull / clone -->
<uses-permission android:name="android.permission.INTERNET" />
```

`MANAGE_EXTERNAL_STORAGE` is granted by the user in Android settings
(*Settings → Apps → CodeEditor → All files access*), not by a dialog. Without
it, "Device folder" can't read shared storage; in-app projects (the default)
need no permission at all. Note: the Play Store restricts this permission
(spec §2 "Before a public release").

## 5. Build, sync, run

```bash
npm run build
npx cap sync
npx cap open android      # then Run in Android Studio, or Build → Generate Signed APK
```

Repeat `npm run build && npx cap sync` after every change.

## How the app behaves inside the APK

- **Storage**: in-app projects live in the WebView's private storage (OPFS) and
  work immediately. With the filesystem plugin installed, the project picker
  also shows **Device folder**, which opens a real path such as
  `Documents/Projects/site` (`src/storage/capacitorFs.js`, spec Option B).
  This path is unit-tested against a fake plugin but has **not yet been tested
  on a real device** — try it on a test folder first.
- The service worker is not registered inside Capacitor (the files are already
  local).
- **Git push/pull** from the WebView still needs a CORS proxy (Settings → Git),
  because the requests are made by web code. A native HTTP plugin could remove
  that requirement later.
- **Keyboard**: Capacitor's default `windowSoftInputMode="adjustResize"` shrinks
  the WebView when the keyboard opens, so the coding-keys bar sits right above
  it.

## Test on a real device early

Things emulation can't fully check: each keyboard app's composing behaviour
(Gboard, Samsung Keyboard, SwiftKey), swipe-typing next to the gesture layer,
Android's edge back-gesture, and the keyboard-visible heuristic of the keys bar
(Settings → Coding keys bar → Always/Never overrides it).
