import { api } from './api'

/** Mirrors ReminderOut in backend/app/routers/reminders.py. */
export interface Reminder {
  id: number
  title: string
  description: string | null
  scheduled_at: string | null
  is_completed: number
  is_mood_triggered: number
  repeat: string | null
  notified_at: string | null
}

export interface ReminderInput {
  title: string
  /** ISO datetime. The backend only delivers reminders that have one. */
  scheduled_at: string
  repeat?: 'hourly' | 'daily' | 'weekly' | null
}

export async function listReminders(): Promise<Reminder[]> {
  const { data } = await api.get<Reminder[]>('/reminders')
  return data
}

export async function createReminder(input: ReminderInput): Promise<Reminder> {
  const { data } = await api.post<Reminder>('/reminders', input)
  return data
}

export async function completeReminder(id: number): Promise<Reminder> {
  // The endpoint takes a ReminderUpdate body; without it FastAPI returns 422.
  const { data } = await api.patch<Reminder>(`/reminders/${id}/complete`, { is_completed: true })
  return data
}

export async function deleteReminder(id: number): Promise<void> {
  await api.delete(`/reminders/${id}`)
}
