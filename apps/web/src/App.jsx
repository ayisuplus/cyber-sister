import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import AppShell from './components/layout/AppShell'
import ErrorBoundary from './components/layout/ErrorBoundary'
import LoginPage from './pages/LoginPage'
import ChatPage from './pages/ChatPage'

// 路由级代码分割：登录/聊天为关键路径保持直出，其余页面按需加载（首屏包体收敛）
const HerPage = lazy(() => import('./pages/HerPage'))
const StylePage = lazy(() => import('./pages/StylePage'))
const NotesPage = lazy(() => import('./pages/NotesPage'))
const ReadingPage = lazy(() => import('./pages/ReadingPage'))
const ReaderPage = lazy(() => import('./pages/ReaderPage'))
const CalendarPage = lazy(() => import('./pages/CalendarPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const ConversationArchivePage = lazy(() => import('./pages/ConversationArchivePage'))

function ProtectedRoute({ children }) {
  const isLoggedIn = useAuthStore(state => state.isLoggedIn)
  if (!isLoggedIn) return <Navigate to="/login" replace />
  return children
}

function DefaultRedirect() {
  const isLoggedIn = useAuthStore(state => state.isLoggedIn)
  return <Navigate to={isLoggedIn ? '/chat' : '/login'} replace />
}

// 旧入口收拢到新入口：「她」页现在只有一层（来信 + 她记得的你），旧的 tab 深链一律回 /her
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
          {/* 生活功能在 /tools/ 下：日历、手记、读书、装扮 */}
          <Route path="/tools/calendar" element={<ProtectedRoute><CalendarPage /></ProtectedRoute>} />
          <Route path="/tools/notes" element={<ProtectedRoute><NotesPage /></ProtectedRoute>} />
          <Route path="/tools/reading" element={<ProtectedRoute><ReadingPage /></ProtectedRoute>} />
          <Route path="/tools/reading/:bookId" element={<ProtectedRoute><ReaderPage /></ProtectedRoute>} />
          <Route path="/tools/style" element={<ProtectedRoute><StylePage /></ProtectedRoute>} />
          {/* 旧路径（含后端关怀卡 action.to 与外部深链）一律收拢到新入口 */}
          <Route path="/memories" element={<Moved to="/her" />} />
          <Route path="/profile" element={<Moved to="/settings" />} />
          <Route path="/profile/memories" element={<Moved to="/her" />} />
          <Route path="/tools" element={<Navigate to="/chat" replace />} />
          <Route path="/tools/workspace" element={<Moved to="/her" />} />
          {/* 日程、倒数日、提醒、手帐打卡、专注自习与旧的安排/经期入口都收拢到「日历」 */}
          {['planner', 'todo', 'countdown', 'reminders', 'handbook', 'study', 'schedule', 'period'].map(old => (
            <Route key={old} path={`/tools/${old}`} element={<Navigate to="/tools/calendar" replace />} />
          ))}
          {/* 日记并进手记；来信收进「她」页（她的来信）。读书另起一处，见上面的 /tools/reading */}
          <Route path="/tools/diary" element={<Navigate to="/tools/notes" replace />} />
          <Route path="/tools/letters" element={<Moved to="/her" />} />
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
