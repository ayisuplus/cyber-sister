import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import PhoneFrame from './components/layout/PhoneFrame'
import LoginPage from './pages/LoginPage'
import ChatPage from './pages/ChatPage'
import ToolsPage from './pages/ToolsPage'
import ProfilePage from './pages/ProfilePage'
import PeriodPage from './pages/PeriodPage'
import TodoPage from './pages/TodoPage'
import CountdownPage from './pages/CountdownPage'
import MemoriesPage from './pages/MemoriesPage'
import MembershipPage from './pages/MembershipPage'
import SettingsPage from './pages/SettingsPage'

function ProtectedRoute({ children }) {
  const isLoggedIn = useAuthStore(state => state.isLoggedIn)
  if (!isLoggedIn) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <PhoneFrame>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
          <Route path="/tools" element={<ProtectedRoute><ToolsPage /></ProtectedRoute>} />
          <Route path="/tools/period" element={<ProtectedRoute><PeriodPage /></ProtectedRoute>} />
          <Route path="/tools/todo" element={<ProtectedRoute><TodoPage /></ProtectedRoute>} />
          <Route path="/tools/countdown" element={<ProtectedRoute><CountdownPage /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/profile/memories" element={<ProtectedRoute><MemoriesPage /></ProtectedRoute>} />
          <Route path="/membership" element={<ProtectedRoute><MembershipPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </PhoneFrame>
    </BrowserRouter>
  )
}
