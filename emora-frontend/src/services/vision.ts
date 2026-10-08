import { api, formData } from './api'
import type { ChatResponse } from './chat'

/**
 * Phrases that mean "use your eyes".
 *
 * Attaching the webcam frame to *every* message would work, but an image costs
 * roughly a thousand tokens a turn — real money on every "what's the weather".
 * Matching intent keeps vision to the turns that actually need it.
 *
 * Deliberately broad: a false positive costs one image, a false negative makes
 * Emora look like she can't see, which is worse.
 */
const VISION_INTENT =
  /\b(see|seeing|look(ing)?|watch|show(ing)?|holding|wearing|point(ing)?|gesture|sign|finger|fingers|hand|thumbs?|peace|count|how many|what.{0,12}(this|that|these|those|is it|am i|do i)|behind me|in front of me|my (face|shirt|hair|room|desk)|camera|colou?r of)\b/i

export function looksLikeVisionQuestion(message: string): boolean {
  return VISION_INTENT.test(message)
}

/** Chat with a webcam frame attached. */
export async function chatWithVision(
  message: string,
  frame: Blob,
  opts: {
    emotion?: string
    confidence?: number
    scores?: Record<string, number>
    location?: string
  } = {},
): Promise<ChatResponse> {
  const { data } = await api.post<ChatResponse>(
    '/chat/vision',
    formData({
      message,
      image: frame,
      emotion: opts.emotion,
      confidence: opts.confidence !== undefined ? String(opts.confidence) : undefined,
      scores: opts.scores ? JSON.stringify(opts.scores) : undefined,
      location: opts.location,
    }),
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return data
}
