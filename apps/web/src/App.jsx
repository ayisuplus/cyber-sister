import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import AppShell from './components/layout/AppShell'
import ErrorBoundary from './components/layout/ErrorBoundary'
import LoginPage from './pages/LoginPage'
import ChatPage from './pages/ChatPage'

// 路由级代码分割：登录/聊天为关键路径保持直出，其余页面按需加载（首屏包体收敛）
const ToolsPage = lazy(() => import('./pages/ToolsPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const MemoriesPage = lazy(() => import('./pages/MemoriesPage'))
const MembershipPage = lazy(() => import('./pages/MembershipPage'))
const MakeupRoomPage = lazy(() => import('./pages/MakeupRoomPage'))
const WardrobePage = lazy(() => import('./pages/WardrobePage'))
const PeriodPage = lazy(() => import('./pages/PeriodPage'))
const CountdownPage = lazy(() => import('./pages/CountdownPage'))
const TodoPage = lazy(() => import('./pages/TodoPage'))
const DiaryPage = lazy(() => import('./pages/DiaryPage'))
const HandbookPage = lazy(() => import('./pages/HandbookPage'))
const ReadingPage = lazy(() => import('./pages/ReadingPage'))
const StudyPage = lazy(() => import('./pages/StudyPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const WorkspacePage = lazy(() => import('./pages/WorkspacePage'))
const LettersPage = lazy(() => import('./pages/LettersPage'))

function ProtectedRoute({ children }) {
  const isLoggedIn = useAuthStore(state => state.isLoggedIn)
  if (!isLoggedIn) return <Navigate to="/login" replace />
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
          <Route path="/tools" element={<ProtectedRoute><ToolsPage /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/profile/memories" element={<ProtectedRoute><MemoriesPage /></ProtectedRoute>} />
          <Route path="/profile/membership" element={<ProtectedRoute><MembershipPage /></ProtectedRoute>} />
          <Route path="/tools/makeup-room" element={<ProtectedRoute><MakeupRoomPage /></ProtectedRoute>} />
          <Route path="/tools/wardrobe" element={<ProtectedRoute><WardrobePage /></ProtectedRoute>} />
          <Route path="/tools/period" element={<ProtectedRoute><PeriodPage /></ProtectedRoute>} />
          <Route path="/tools/countdown" element={<ProtectedRoute><CountdownPage /></ProtectedRoute>} />
          <Route path="/tools/todo" element={<ProtectedRoute><TodoPage /></ProtectedRoute>} />
          <Route path="/tools/diary" element={<ProtectedRoute><DiaryPage /></ProtectedRoute>} />
          <Route path="/tools/handbook" element={<ProtectedRoute><HandbookPage /></ProtectedRoute>} />
          <Route path="/tools/reading" element={<ProtectedRoute><ReadingPage /></ProtectedRoute>} />
          <Route path="/tools/study" element={<ProtectedRoute><StudyPage /></ProtectedRoute>} />
          <Route path="/tools/workspace" element={<ProtectedRoute><WorkspacePage /></ProtectedRoute>} />
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
