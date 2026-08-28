import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authService } from '../services/authService'

export const useAuthStore = create(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isLoggedIn: false,

      login: async (phone, code) => {
        try {
          const response = await authService.login(phone, code)
          const { token, user } = response

          set({
            token,
            user,
            isLoggedIn: true,
          })

          return user
        } catch (error) {
          throw error
        }
      },

      logout: () => {
        set({
          token: null,
          user: null,
          isLoggedIn: false,
        })
      },

      refreshAuth: async () => {
        try {
          // refreshToken 现在通过 httpOnly cookie 自动携带，无需手动管理
          const response = await authService.refresh()
          set({ token: response.token })

          return response.token
        } catch (error) {
          // 刷新失败，清除登录状态
          get().logout()
          throw error
        }
      },

      updatePersona: (persona) => {
        const user = get().user
        if (user) set({ user: { ...user, persona } })
      },

      updateProfile: (updates) => {
        const user = get().user
        if (user) set({ user: { ...user, ...updates } })
      },

      setVip: (isVip) => {
        const user = get().user
        if (user) set({ user: { ...user, isVip } })
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
