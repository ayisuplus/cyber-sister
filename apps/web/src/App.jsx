import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { isLocalWorkClient } from './features/distribution'
import { useAuthStore } from './stores/authStore'
import AppShell from './components/layout/AppShell'
import ErrorBoundary from './components/layout/ErrorBoundary'
import LoginPage from './pages/LoginPage'
import ChatPage from './pages/ChatPage'

// 路由级代码分割：登录/聊天为关键路径保持直出，其余页面按需加载（首屏包体收敛）
const ToolsPage = lazy(() => import('./pages/ToolsPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const MemoryHubPage = lazy(() => import('./pages/MemoryHubPage'))
const MembershipPage = lazy(() => import('./pages/MembershipPage'))
const MakeupRoomPage = lazy(() => import('./pages/MakeupRoomPage'))
const WardrobePage = lazy(() => import('./pages/WardrobePage'))
const PeriodPage = lazy(() => import('./pages/PeriodPage'))
const PlannerPage = lazy(() => import('./pages/PlannerPage'))
const DiaryPage = lazy(() => import('./pages/DiaryPage'))
const HandbookPage = lazy(() => import('./pages/HandbookPage'))
const ReadingPage = lazy(() => import('./pages/ReadingPage'))
const StudyPage = lazy(() => import('./pages/StudyPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const ConversationArchivePage = lazy(() => import('./pages/ConversationArchivePage'))
const LettersPage = lazy(() => import('./pages/LettersPage'))

function ProtectedRoute({ children }) {
  const isLoggedIn = useAuthStore(state => state.isLoggedIn)
  const { pathname } = useLocation()
  if (!isLoggedIn) return <Navigate to="/login" replace />
  if (!isLocalWorkClient() && (pathname.startsWith('/tools') || pathname === '/profile/membership')) return <Navigate to="/chat" replace />
  return children
}

function DefaultRedirect() {
  const isLoggedIn = useAuthStore(state => state.isLoggedIn)
  return <Navigate to={isLoggedIn ? '/chat' : '/login'} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <ErrorBoundary>
        <Suspense fallback={<div className="flex-1 bg-transparent" />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
          <Route path="/chat/archives" element={<ProtectedRoute><ConversationArchivePage /></ProtectedRoute>} />
          <Route path="/tools" element={<ProtectedRoute><ToolsPage /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/memories" element={<ProtectedRoute><MemoryHubPage /></ProtectedRoute>} />
          <Route path="/profile/memories" element={<Navigate to="/memories" replace />} />
          <Route path="/profile/membership" element={<ProtectedRoute><MembershipPage /></ProtectedRoute>} />
          <Route path="/tools/makeup-room" element={<ProtectedRoute><MakeupRoomPage /></ProtectedRoute>} />
          <Route path="/tools/wardrobe" element={<ProtectedRoute><WardrobePage /></ProtectedRoute>} />
          <Route path="/tools/period" element={<ProtectedRoute><PeriodPage /></ProtectedRoute>} />
          <Route path="/tools/planner" element={<ProtectedRoute><PlannerPage /></ProtectedRoute>} />
          {/* 旧三页路由重定向到合并后的日程与提醒页（后端 care touchpoints 的 action.to 仍指旧路径，靠这里兼容） */}
          <Route path="/tools/countdown" element={<Navigate to="/tools/planner?tab=countdown" replace />} />
          <Route path="/tools/todo" element={<Navigate to="/tools/planner?tab=todo" replace />} />
          <Route path="/tools/reminders" element={<Navigate to="/tools/planner?tab=reminders" replace />} />
          <Route path="/tools/diary" element={<ProtectedRoute><DiaryPage /></ProtectedRoute>} />
          <Route path="/tools/handbook" element={<ProtectedRoute><HandbookPage /></ProtectedRoute>} />
          <Route path="/tools/reading" element={<ProtectedRoute><ReadingPage /></ProtectedRoute>} />
          <Route path="/tools/study" element={<ProtectedRoute><StudyPage /></ProtectedRoute>} />
          <Route path="/tools/workspace" element={<Navigate to="/memories?tab=pending" replace />} />
          <Route path="/tools/letters" element={<ProtectedRoute><LettersPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          <Route path="/" element={<DefaultRedirect />} />
          <Route path="*" element={<DefaultRedirect />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
      </AppShell>
    </BrowserRouter>
  )
}
