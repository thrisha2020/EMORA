import { api } from './api'

/** TTS synthesis — returns a playable MP3 blob. */
export async function tts(text: string, voice?: string, rate?: string): Promise<Blob> {
  const { data } = await api.post<Blob>(
    '/tts',
    { text, voice, rate },
    { responseType: 'blob' },
  )
  return data
}