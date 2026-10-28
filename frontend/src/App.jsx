import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import People from './pages/People'
import LiveRecognition from './pages/LiveRecognition'
import Attendance from './pages/Attendance'
import Settings from './pages/Settings'

function Protected({ children }) {
  const { admin, checking } = useAuth()
  const location = useLocation()
  if (checking) return <div className="min-h-screen"><Spinner label="Checking your session" /></div>
  if (!admin) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="people" element={<People />} />
        <Route path="live" element={<LiveRecognition />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
