import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Android client for Emora.
 *
 * The phone runs no AI: torch, TensorFlow and the speech models can't run there.
 * The UI ships inside the APK and calls the backend on your computer over Wi-Fi.
 *
 * Build with your computer's LAN address baked in (and only the default avatar):
 *   VITE_MOBILE=1 VITE_API_BASE=http://192.168.1.50:8000/api npm run android:sync
 *   npm run android:apk
 *
 * The backend must listen on the LAN (./start.sh --lan, or uvicorn --host 0.0.0.0),
 * which also exposes it to everyone on that network — use a trusted Wi-Fi only.
 */

const config: CapacitorConfig = {
  appId: 'com.emora.assistant',
  appName: 'Emora',
  // The UI ships inside the APK and Capacitor serves it from http://localhost,
  // which browsers treat as a secure origin — that is what allows the camera and
  // microphone. Loading it from http://192.168.x.x instead silently disables both.
  webDir: 'dist',
  server: {
    cleartext: true, // the API itself is plain http on the LAN
    androidScheme: 'http',
  },
  android: {
    allowMixedContent: true,
  },
}

export default config
