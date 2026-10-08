import { api } from './api'

export interface ChatResponse {
  reply: string
  action: boolean
  nudge: string | null
}

/** Emotion-aware chat. The full score vector is persisted with the interaction. */
export async function chat(
  message: string,
  emotion?: string,
  confidence?: number,
  scores?: Record<string, number>,
): Promise<ChatResponse> {
  const { data } = await api.post<ChatResponse>('/chat', { message, emotion, confidence, scores })
  return data
}
