# Wrapping this app with Capacitor

`capacitor.config.json` is already in the project root, pointing `webDir` at `www/` — that's
the folder `npx esbuild ...` builds into, so Capacitor will always wrap whatever you last built.

## 1. Pick a real app ID first

Open `capacitor.config.json` and change `appId` from `com.example.codeeditor` to your own
reverse-domain identifier — e.g. `com.yourname.codeeditor`. This gets baked into the native
Android project at creation time in step 3; changing it afterward means editing multiple native
files by hand, so get it right now rather than later.

## 2. Install Capacitor

From the project root:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
```

Skip `npx cap init` — that command *creates* a `capacitor.config.json`, and you already have
one. Running it again would ask the same questions and likely overwrite your `appId` edit.

## 3. Add the Android platform

```bash
npx cap add android
```

This generates a full Android Studio project in `./android/` — gradle files, manifest, the
works. You now own that project the same way you'd own one created directly in Android Studio.

## 4. Build the web app, then sync it into the native project

Every time you change anything in `src/`, rebuild and re-sync before testing on-device:

```bash
npx esbuild src/main.js --bundle --minify --outfile=www/bundle.js --format=iife --target=es2020
cp src/index.html src/styles.css www/
npx cap sync
```

`cap sync` copies `www/` into the Android project and updates native dependencies. Worth
turning the first two lines into an npm script (`npm run build`) so this becomes one command.

## 5. Open in Android Studio and run

```bash
npx cap open android
```

From there it's a normal Android Studio project — pick a device/emulator and hit Run, or
Build > Generate Signed Bundle/APK when you want a real installable file.

## What still needs work after this

- **File System Access API doesn't exist in Android's WebView.** Until `CapacitorFSProvider`
  is written (see the `TODO` in `src/fileSystem.js`), the app will run in "Open File" fallback
  mode inside the wrapped app — usable, but no live folder access or direct disk saves. Wiring
  in `@capacitor/filesystem` is a good focused next session.
- **Test on a real device early.** The keys-bar visibility heuristic (`src/keysBar.js`) and the
  visual-viewport-based layout behavior are the two things most likely to behave differently on
  a real Android WebView than in desktop Chrome — worth checking before you build much more on
  top of them.
