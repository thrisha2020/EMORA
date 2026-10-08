import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import OfflineBanner from '@/components/OfflineBanner'
import AppShell from '@/layouts/AppShell'
import BootPage from '@/pages/Boot/BootPage'
import LoginPage from '@/pages/Login/LoginPage'

const Chat = lazy(() => import('@/pages/Chat/ChatPage'))
const Mood = lazy(() => import('@/pages/Mood/MoodPage'))
const Analytics = lazy(() => import('@/pages/Analytics/AnalyticsPage'))
const Reminders = lazy(() => import('@/pages/Reminders/RemindersPage'))
const Profile = lazy(() => import('@/pages/Profile/ProfilePage'))
const Settings = lazy(() => import('@/pages/Settings/SettingsPage'))

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  if (isAuthenticated) return <Navigate to="/chat" replace />
  return <>{children}</>
}

function Loading() {
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--c-bg)' }}>
      <span className="font-orbitron" style={{ color: 'var(--c-primary)', letterSpacing: '0.3em' }}>
        EMORA
      </span>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <OfflineBanner />
          <BrowserRouter>
          <Suspense fallback={<Loading />}>
            <Routes>
            <Route path="/" element={<BootPage />} />
            <Route
              path="/login"
              element={
                <GuestOnly>
                  <LoginPage />
                </GuestOnly>
              }
            />
            {/* Enrollment happens inline inside the login conversation. */}
            <Route path="/register" element={<Navigate to="/login" replace />} />
            <Route
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              <Route path="/chat" element={<Chat />} />
              {/* Dashboard and J.A.R.V.I.S. were folded into chat; keep old links working. */}
              <Route path="/dashboard" element={<Navigate to="/chat" replace />} />
              <Route path="/jarvis" element={<Navigate to="/chat" replace />} />
              <Route path="/mood" element={<Mood />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/reminders" element={<Reminders />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}