import { api, formData, getToken, type EmoraUser } from './api'

export interface LoginResult {
  user_id: number
  name: string
  token: string
}

/** Is this spoken name already enrolled? Decides verify-vs-enroll in the login flow. */
export async function identify(name: string): Promise<{ known: boolean; name: string; enrolled_count: number }> {
  const { data } = await api.post('/auth/identify', { name })
  return data
}

/** Face login. Passing `name` scopes the match to that user, so name and face must agree. */
export async function loginWithFace(file: Blob, name?: string): Promise<LoginResult> {
  const { data } = await api.post<LoginResult>('/login', formData({ file, name }), {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function registerWithFace(name: string, file: Blob): Promise<LoginResult> {
  const { data } = await api.post<LoginResult>('/register', formData({ name, file }), {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export type { EmoraUser }

/**
 * Revoke the current session server-side. Best effort: the client clears its token regardless.
 *
 * The header is set explicitly because the caller clears storage immediately; by
 * the time axios' interceptor runs there is no token left to attach.
 */
export async function logoutRequest(): Promise<void> {
  const token = getToken()
  if (!token) return
  try {
    await api.post('/logout', null, { headers: { Authorization: `Bearer ${token}` } })
  } catch {
    /* already expired, offline, or a token minted before sessions were checked */
  }
}
