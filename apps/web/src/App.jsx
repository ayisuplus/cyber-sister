import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { isLocalWorkClient } from './features/distribution'
import { useAuthStore } from './stores/authStore'
import AppShell from './components/layout/AppShell'
import ErrorBoundary from './components/layout/ErrorBoundary'
import LoginPage from './pages/LoginPage'
import ChatPage from './pages/ChatPage'

// 路由级代码分割：登录/聊天为关键路径保持直出，其余页面按需加载（首屏包体收敛）
const HerPage = lazy(() => import('./pages/HerPage'))
const MembershipPage = lazy(() => import('./pages/MembershipPage'))
const StylePage = lazy(() => import('./pages/StylePage'))
const NotesPage = lazy(() => import('./pages/NotesPage'))
const PeriodPage = lazy(() => import('./pages/PeriodPage'))
const SchedulePage = lazy(() => import('./pages/SchedulePage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const ConversationArchivePage = lazy(() => import('./pages/ConversationArchivePage'))

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

// 旧入口收拢到新入口：未指定页签时沿用原链接的 ?tab=（如 /memories?tab=pending → /her?tab=pending）
/** @param {{ to: string, tab?: string }} props */
function Moved({ to, tab }) {
  const { search } = useLocation()
  return <Navigate to={tab ? `${to}?tab=${tab}` : `${to}${search}`} replace />
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
          <Route path="/her" element={<ProtectedRoute><HerPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          <Route path="/profile/membership" element={<ProtectedRoute><MembershipPage /></ProtectedRoute>} />
          {/* 本地客户端功能统一在 /tools/ 下：安排、手记、经期、装扮 */}
          <Route path="/tools/schedule" element={<ProtectedRoute><SchedulePage /></ProtectedRoute>} />
          <Route path="/tools/notes" element={<ProtectedRoute><NotesPage /></ProtectedRoute>} />
          <Route path="/tools/period" element={<ProtectedRoute><PeriodPage /></ProtectedRoute>} />
          <Route path="/tools/style" element={<ProtectedRoute><StylePage /></ProtectedRoute>} />
          {/* 旧路径（含后端关怀卡 action.to 与外部深链）一律收拢到新入口 */}
          <Route path="/memories" element={<Moved to="/her" />} />
          <Route path="/profile" element={<Moved to="/settings" />} />
          <Route path="/profile/memories" element={<Moved to="/her" />} />
          <Route path="/tools" element={<Navigate to="/chat" replace />} />
          <Route path="/tools/workspace" element={<Moved to="/her" tab="pending" />} />
          {/* 日程、倒数日、提醒、手帐打卡、专注自习都已并入「安排」 */}
          {['planner', 'todo', 'countdown', 'reminders', 'handbook', 'study'].map(old => (
            <Route key={old} path={`/tools/${old}`} element={<Navigate to="/tools/schedule" replace />} />
          ))}
          <Route path="/tools/diary" element={<Moved to="/tools/notes" tab="diary" />} />
          <Route path="/tools/reading" element={<Moved to="/tools/notes" tab="reading" />} />
          <Route path="/tools/letters" element={<Moved to="/tools/notes" tab="letters" />} />
          <Route path="/tools/makeup-room" element={<Moved to="/tools/style" tab="makeup" />} />
          <Route path="/tools/wardrobe" element={<Moved to="/tools/style" tab="wardrobe" />} />
          <Route path="/" element={<DefaultRedirect />} />
          <Route path="*" element={<DefaultRedirect />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
      </AppShell>
    </BrowserRouter>
  )
}
