import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import PhoneFrame from './components/layout/PhoneFrame'
import ErrorBoundary from './components/layout/ErrorBoundary'
import LoginPage from './pages/LoginPage'
import ChatPage from './pages/ChatPage'
import ToolsPage from './pages/ToolsPage'
import ProfilePage from './pages/ProfilePage'
import MemoriesPage from './pages/MemoriesPage'
import LocalModelPage from './pages/LocalModelPage'
import VirtualMakeupRoomPage from './pages/VirtualMakeupRoomPage'
import VirtualFittingRoomPage from './pages/VirtualFittingRoomPage'
import BeautyCameraPage from './pages/BeautyCameraPage'
import PeriodPage from './pages/PeriodPage'
import CountdownPage from './pages/CountdownPage'
import TodoPage from './pages/TodoPage'
import SettingsPage from './pages/SettingsPage'

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
      <PhoneFrame>
        <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
          <Route path="/tools" element={<ProtectedRoute><ToolsPage /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/profile/memories" element={<ProtectedRoute><MemoriesPage /></ProtectedRoute>} />
          <Route path="/profile/local-model" element={<ProtectedRoute><LocalModelPage /></ProtectedRoute>} />
          <Route path="/tools/virtual-makeup" element={<ProtectedRoute><VirtualMakeupRoomPage /></ProtectedRoute>} />
          <Route path="/tools/virtual-fitting" element={<ProtectedRoute><VirtualFittingRoomPage /></ProtectedRoute>} />
          <Route path="/tools/beauty-camera" element={<ProtectedRoute><BeautyCameraPage /></ProtectedRoute>} />
          <Route path="/tools/period" element={<ProtectedRoute><PeriodPage /></ProtectedRoute>} />
          <Route path="/tools/countdown" element={<ProtectedRoute><CountdownPage /></ProtectedRoute>} />
          <Route path="/tools/todo" element={<ProtectedRoute><TodoPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          <Route path="/" element={<DefaultRedirect />} />
          <Route path="*" element={<DefaultRedirect />} />
        </Routes>
        </ErrorBoundary>
      </PhoneFrame>
    </BrowserRouter>
  )
}
