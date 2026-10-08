import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  clearAuth,
  getStoredUser,
  getToken,
  storeAuth,
  type EmoraUser,
} from '@/services/api'
import { loginWithFace, logoutRequest, registerWithFace } from '@/services/auth'

interface AuthContextValue {
  user: EmoraUser | null
  token: string | null
  isAuthenticated: boolean
  login: (file: Blob, name?: string) => Promise<EmoraUser>
  register: (name: string, file: Blob) => Promise<EmoraUser>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<EmoraUser | null>(() => getStoredUser())
  const [token, setToken] = useState<string | null>(() => getToken())

  const login = useCallback(async (file: Blob, name?: string) => {
    const result = await loginWithFace(file, name)
    const u = { user_id: result.user_id, name: result.name }
    storeAuth(u, result.token)
    setUser(u)
    setToken(result.token)
    return u
  }, [])

  const register = useCallback(async (name: string, file: Blob) => {
    const result = await registerWithFace(name, file)
    const u = { user_id: result.user_id, name: result.name }
    storeAuth(u, result.token)
    setUser(u)
    setToken(result.token)
    return u
  }, [])

  const logout = useCallback(() => {
    // Revoke the session server-side; the local clear happens either way.
    void logoutRequest()
    clearAuth()
    setUser(null)
    setToken(null)
  }, [])

  const value = useMemo(
    () => ({ user, token, isAuthenticated: Boolean(user && token), login, register, logout }),
    [user, token, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}