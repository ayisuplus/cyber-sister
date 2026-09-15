import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authService } from '../services/authService'
import { runAuthOperation } from '../services/api'
import './chatStore'
import { assertSessionVersion, getSessionVersion, onSessionReset, resetSession } from '../services/sessionLifecycle'

export const useAuthStore = create(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isLoggedIn: false,

      login: (phone, code) => runAuthOperation(async () => {
        const session = getSessionVersion()
        const response = await authService.login(phone, code)
        assertSessionVersion(session)
        const { token, user } = response

        resetSession()
        set({
          token,
          user,
          isLoggedIn: true,
        })

        return user
      }),

      logout: () => runAuthOperation(async () => {
        const session = getSessionVersion()
        await authService.logout()
        assertSessionVersion(session)
        resetSession()
      }),

      refreshAuth: async () => {
        const session = getSessionVersion()
        try {
          // refreshToken 现在通过 httpOnly cookie 自动携带，无需手动管理
          const response = await authService.refresh()
          assertSessionVersion(session)
          set({ token: response.token })

          return response.token
        } catch (error) {
          // 刷新失败，清除登录状态
          if (session === getSessionVersion()) resetSession()
          throw error
        }
      },

      updatePersona: async (persona) => {
        const session = getSessionVersion()
        const response = await authService.updatePersona(persona)
        assertSessionVersion(session)
        const user = get().user
        if (user) set({ user: { ...user, persona: response.persona } })
        return response.persona
      },

      updateRolePlay: async ({ name, setting }) => {
        const session = getSessionVersion()
        const response = await authService.updateRolePlay({ name, setting })
        assertSessionVersion(session)
        const user = get().user
        if (user) set({ user: { ...user, roleName: response.roleName, roleSetting: response.roleSetting } })
        return response
      },

      clearRolePlay: async () => {
        const session = getSessionVersion()
        await authService.clearRolePlay()
        assertSessionVersion(session)
        const user = get().user
        if (user) set({ user: { ...user, roleName: null, roleSetting: null } })
      },

      updateProfile: (updates) => {
        const user = get().user
        if (user) set({ user: { ...user, ...updates } })
      },
    }),
    {
      name: 'cyber-sister-auth',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isLoggedIn: state.isLoggedIn,
      }),
    }
  )
)

onSessionReset(() => useAuthStore.setState({ token: null, user: null, isLoggedIn: false }))
