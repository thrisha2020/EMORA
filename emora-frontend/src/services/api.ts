import axios from 'axios'

export const TOKEN_KEY = 'emora_token'
export const USER_KEY = 'emora_user'

export interface EmoraUser {
  user_id: number
  name: string
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getStoredUser(): EmoraUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as EmoraUser) : null
  } catch {
    return null
  }
}

export function storeAuth(user: EmoraUser, token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

/**
 * Same-origin `/api` in the browser and the desktop app.
 *
 * The Android build sets VITE_API_BASE to the backend's address on the LAN,
 * because the phone serves the UI from inside the APK (http://localhost). That
 * origin is what makes the camera and microphone work at all: browsers refuse
 * getUserMedia on a plain-http address like http://192.168.x.x.
 */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
})

api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      clearAuth()
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  },
)

export function formData(fields: Record<string, Blob | string | undefined>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) fd.append(k, v)
  }
  return fd
}

export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(err)) {
    const detail = (err.response?.data as { detail?: string } | undefined)?.detail
    if (typeof detail === 'string') return detail
  }
  if (err instanceof Error && err.message) return err.message
  return fallback
}
export interface HealthStatus {
  status: string
  ready: boolean
  models: Record<string, boolean>
  /** False when EMORA_WARMUP=0: models load on first use instead of at startup. */
  warmup?: boolean
}

/** Liveness + model readiness. Models cold-load slowly on a fresh backend. */
export async function health(): Promise<HealthStatus> {
  const { data } = await api.get<HealthStatus>('/health')
  return data
}
