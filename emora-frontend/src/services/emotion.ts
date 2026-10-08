import { api, formData } from './api'

export interface EmotionResult {
  emotion: string
  confidence: number
  scores: Record<string, number>
  source?: string
}

export interface FusedEmotion extends EmotionResult {
  sources: string[]
  agreement: number
  raw_emotion?: string
  breakdown: {
    face: EmotionResult | null
    voice: EmotionResult | null
    text: EmotionResult | null
  }
}

/** STT transcription (Parakeet, Whisper fallback). */
export async function transcribe(audio: Blob): Promise<{ text: string; language: string }> {
  const { data } = await api.post<{ text: string; language: string }>(
    '/stt',
    formData({ file: audio }),
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return data
}

export async function analyzeFaceEmotion(file: Blob): Promise<EmotionResult> {
  const { data } = await api.post<EmotionResult>('/emotion/face', formData({ file }), {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function analyzeVoiceEmotion(file: Blob): Promise<EmotionResult> {
  const { data } = await api.post<EmotionResult>('/emotion/voice', formData({ file }), {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

/** Fused face + voice + text reading. Send whichever modalities you have. */
export async function analyzeEmotion(
  face?: Blob,
  voice?: Blob,
  text?: string,
): Promise<FusedEmotion> {
  const { data } = await api.post<FusedEmotion>(
    '/emotion/analyze',
    formData({ face, voice, text }),
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return data
}
