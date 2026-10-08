import { api } from './api'

export interface ProviderInfo {
  id: string
  label: string
  default_model: string
  models: string[]
  key_prefix: string
  console_url: string
  configured: boolean
  masked_key: string | null
  model: string
  is_active: boolean
}

export async function listProviders(): Promise<ProviderInfo[]> {
  const { data } = await api.get<{ providers: ProviderInfo[] }>('/settings/providers')
  return data.providers
}

export async function saveProvider(input: {
  provider: string
  api_key?: string
  model?: string
  activate?: boolean
}): Promise<void> {
  await api.put('/settings/providers', input)
}

export async function deleteProvider(provider: string): Promise<void> {
  await api.delete(`/settings/providers/${provider}`)
}

export async function testProvider(input: {
  provider: string
  api_key?: string
  model?: string
}): Promise<{ ok: boolean; message: string; model: string }> {
  const { data } = await api.post('/settings/providers/test', input)
  return data
}

// --- personality + permissions (stored per user on the backend) ---------------

export interface Preferences {
  allow_actions: boolean
  allow_code: boolean
  tone: 'warm' | 'professional' | 'playful' | 'calm'
  reply_length: 'brief' | 'normal' | 'detailed'
  language: 'auto' | 'en' | 'hi' | 'hinglish'
}

export async function getPreferences(): Promise<Preferences> {
  const { data } = await api.get<Preferences>('/settings/preferences')
  return data
}

export async function savePreferences(patch: Partial<Preferences>): Promise<Preferences> {
  const { data } = await api.put<Preferences>('/settings/preferences', patch)
  return data
}

// --- privacy + data -------------------------------------------------------------

export async function exportData(): Promise<Blob> {
  const { data } = await api.get('/settings/export')
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
}

export async function clearData(kind: 'chats' | 'mood' | 'memories'): Promise<number> {
  const { data } = await api.delete<{ deleted: number }>(`/settings/data/${kind}`)
  return data.deleted
}

export async function deleteAccount(confirmName: string): Promise<void> {
  await api.post('/settings/account/delete', { confirm_name: confirmName })
}

// --- per-browser choices (localStorage) ------------------------------------------

/** Chat toggles, remembered between visits. ChatPage and Settings share these keys. */
export const CHAT_TOGGLES = {
  voice: { key: 'emora_chat_voice', label: 'Speak replies aloud', fallback: true },
  handsFree: { key: 'emora_chat_handsfree', label: 'Hands-free listening', fallback: false },
  camera: { key: 'emora_chat_camera', label: 'Camera on', fallback: true },
  preview: { key: 'emora_chat_preview', label: 'Show camera preview', fallback: false },
}

// v2: the default moved to Neerja at normal speed. The old key mostly held the
// previous defaults (Aria, +15%) written by merely opening Settings.
export const VOICE_KEY = 'emora_voice_v2'
export const VOICE_DEFAULTS = { voice: 'en-IN-NeerjaExpressiveNeural', rate: 0 }

/** edge-tts neural voices, grouped for the picker. Any valid edge-tts name works. */
export const VOICE_GROUPS: { label: string; voices: { id: string; label: string }[] }[] = [
  {
    label: 'Indian English',
    voices: [
      { id: 'en-IN-NeerjaExpressiveNeural', label: 'Neerja · expressive (default)' },
      { id: 'en-IN-NeerjaNeural', label: 'Neerja' },
      { id: 'en-IN-PrabhatNeural', label: 'Prabhat · male' },
    ],
  },
  {
    label: 'Most natural · conversational',
    voices: [
      { id: 'en-US-AvaMultilingualNeural', label: 'Ava · expressive, caring' },
      { id: 'en-US-EmmaMultilingualNeural', label: 'Emma · cheerful, chatty' },
      { id: 'en-US-AndrewMultilingualNeural', label: 'Andrew · warm, male' },
      { id: 'en-US-BrianMultilingualNeural', label: 'Brian · casual, male' },
    ],
  },
  {
    label: 'Indian languages',
    voices: [
      { id: 'hi-IN-SwaraNeural', label: 'Hindi · Swara' },
      { id: 'hi-IN-MadhurNeural', label: 'Hindi · Madhur (male)' },
      { id: 'kn-IN-SapnaNeural', label: 'Kannada · Sapna' },
      { id: 'kn-IN-GaganNeural', label: 'Kannada · Gagan (male)' },
      { id: 'ta-IN-PallaviNeural', label: 'Tamil · Pallavi' },
      { id: 'te-IN-ShrutiNeural', label: 'Telugu · Shruti' },
      { id: 'ml-IN-SobhanaNeural', label: 'Malayalam · Sobhana' },
      { id: 'mr-IN-AarohiNeural', label: 'Marathi · Aarohi' },
      { id: 'bn-IN-TanishaaNeural', label: 'Bengali · Tanishaa' },
      { id: 'gu-IN-DhwaniNeural', label: 'Gujarati · Dhwani' },
    ],
  },
  {
    label: 'Other English',
    voices: [
      { id: 'en-US-AriaNeural', label: 'Aria · US' },
      { id: 'en-US-JennyNeural', label: 'Jenny · US' },
      { id: 'en-GB-SoniaNeural', label: 'Sonia · UK' },
      { id: 'en-AU-NatashaNeural', label: 'Natasha · Australia' },
    ],
  },
]

/** edge-tts wants a signed percentage: 15 -> "+15%". */
export const rateParam = (rate: number) => `${rate >= 0 ? '+' : ''}${rate}%`

export const ALERTS_KEY = 'emora_reminder_alerts'
export const ALERT_DEFAULTS = {
  notify: false,
  sound: true,
  quiet: false,
  quietStart: '22:00',
  quietEnd: '07:00',
}

/** Is `now` inside a HH:MM–HH:MM window? Handles windows that cross midnight. */
export function inQuietHours(now: Date, start: string, end: string): boolean {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }
  const s = toMin(start)
  const e = toMin(end)
  const n = now.getHours() * 60 + now.getMinutes()
  if (s === e) return false
  return s < e ? n >= s && n < e : n >= s || n < e
}

/** Short two-note chime, no audio file needed. */
export function chime(): void {
  try {
    const ctx = new AudioContext()
    ;[880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const t = ctx.currentTime + i * 0.18
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.12, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.35)
    })
    window.setTimeout(() => void ctx.close(), 800)
  } catch {
    /* no audio output available */
  }
}
