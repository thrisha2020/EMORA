import { api } from './api'

export interface MoodHistory {
  days: number
  /** ISO dates, one per point, oldest first. */
  dates: string[]
  emotions: Array<string | null>
  counts: Record<string, number>
}

export interface AnalyticsStats {
  total_chats: number
  /** Dominant emotion in the last 24h; null when there were no readings. */
  recent_emotion: string | null
  common_emotion: string
  total_reminders: number
  total_sessions: number
  emotion_counts: Record<string, number>
}

export interface Profile {
  name: string
  joined: string | null
  preferred_language: string
  emotion_stats: Record<string, number>
}

export async function moodHistory(days = 7): Promise<MoodHistory> {
  const { data } = await api.get<MoodHistory>('/mood/history', { params: { days } })
  return data
}

export async function analytics(): Promise<AnalyticsStats> {
  const { data } = await api.get<AnalyticsStats>('/analytics')
  return data
}

export async function profile(): Promise<Profile> {
  const { data } = await api.get<Profile>('/profile')
  return data
}