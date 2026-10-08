# Emora as an app: desktop (macOS / Windows) and Android

Emora's AI runs locally: DeepFace, wav2vec2, DistilRoBERTa, Parakeet and Whisper
need Python, torch and TensorFlow — about 2.7 GB of environment plus ~5 GB of
model cache. Neither a 10 MB desktop app nor a phone can carry that, so:

| Platform | What ships | What it needs |
|---|---|---|
| macOS / Windows | A native window (Tauri, ~10 MB binary / 99 MB `.app`) that **starts your existing backend** and opens the UI | The project folder with its `venv` on the same machine |
| Android | A WebView client (3.9 MB APK) pointed at the backend **over Wi-Fi** | The backend running on a computer, reachable on the LAN |

---

## Desktop

### What the shell does (`emora-frontend/src-tauri/src/main.rs`)

1. If something already listens on `127.0.0.1:8000`, it uses that (your own
   `uvicorn` in a terminal keeps working, and is never killed).
2. Otherwise it finds the project and runs `venv/bin/uvicorn backend.app.main:app`
   (`venv\Scripts\uvicorn.exe` on Windows) with `EMORA_WARMUP=0`, so a launch
   doesn't pin 2–3 GB.
3. It opens a window on `http://127.0.0.1:8000`, where FastAPI serves the built
   React UI, and reloads once the backend answers.
4. On quit it stops the backend it started.

The project is found via `EMORA_HOME`, then by walking up from the app, then
`~/Desktop/my_apps/emotion-assistant` and `~/emotion-assistant`. Set `EMORA_HOME`
if yours lives elsewhere.

### Build

```bash
cd emora-frontend
npm install
npm run desktop:build          # builds the UI, then the native app
npm run desktop                # dev mode with hot reload
```

Output: `emora-frontend/src-tauri/target/release/bundle/`
- macOS: `macos/Emora.app`, and `dmg/Emora_0.2.0_aarch64.dmg` with `--bundles dmg`
- Windows: `nsis/Emora_0.2.0_x64-setup.exe`

**Windows builds must run on Windows** (Tauri can't cross-compile). Either build
on a Windows machine with Rust + Node + the project, or add a GitHub Actions job
using `tauri-apps/tauri-action` on a `windows-latest` runner.

### Prerequisites per machine
- Python environment: `./setup.sh` (macOS/Linux) or `setup.ps1` (Windows)
- Rust (`rustup`) and Node 20+ to build; **not** needed to run the built app
- Windows also needs the WebView2 runtime (bundled by the NSIS installer)

---

## Android

### What it is

A Capacitor WebView that loads the backend's own page, so there is no separate
copy of the UI to keep in sync and no CORS setup. `mobile-shell/index.html` is a
one-page fallback shown only when the backend can't be reached.

Works on the phone: chat, voice, camera emotion, avatar, reminders, settings.
Desktop commands still act on the computer running the backend, not the phone.

### Build

```bash
# 1. Point the app at your computer's LAN address
EMORA_SERVER_URL=http://192.168.1.50:8000 npx cap sync android

# 2. Build the APK
cd android && ./gradlew assembleDebug
# -> android/app/build/outputs/apk/debug/app-debug.apk (3.9 MB)

# 3. Install on a phone
adb install -r app/build/outputs/apk/debug/app-debug.apk
# or copy the APK to the phone and open it (allow "install unknown apps")
```

Requires JDK 21 (`JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home`
on this Mac) and `ANDROID_HOME=~/Library/Android/sdk`.

If `./gradlew` fails to download Gradle, a cached copy works:

```bash
$(ls ~/.gradle/wrapper/dists/gradle-8.13-bin/*/gradle-8.13/bin/gradle) assembleDebug
```

### Run the backend so the phone can see it

```bash
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

`0.0.0.0` exposes Emora to **everyone on that network**, and `/register` needs no
login, so anyone who can reach it can enroll and use chat, code execution and
desktop actions. Use a trusted network, and turn off those permissions in
Settings while the port is open.

The phone needs the built UI on the backend: run `npm run build` once so
`emora-frontend/dist` exists, since `main.py` only serves the SPA when it does.

### Permissions

The manifest requests `INTERNET`, `CAMERA`, `RECORD_AUDIO` and
`MODIFY_AUDIO_SETTINGS`; Android asks the user at first use. Browser speech
recognition may be unavailable in the WebView, in which case voice falls back to
the backend's Parakeet/Whisper endpoint automatically.

### Not verified
The APK builds and carries the right permissions, but it has not been installed
on a device from here — no phone or emulator was attached. Camera and microphone
prompts inside the WebView should be tested once on a real phone.

---

## Release checklist

- [ ] `npm run build` so the backend can serve the UI
- [ ] macOS: `npm run desktop:build`, then open `Emora.app` once (Gatekeeper will
      warn about an unsigned app: right-click → Open). Signing needs an Apple
      Developer ID.
- [ ] Windows: build on Windows or in CI; unsigned installers show SmartScreen.
- [ ] Android: set `EMORA_SERVER_URL`, rebuild, install, grant camera and mic.
