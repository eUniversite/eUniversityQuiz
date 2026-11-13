import type React from "react"
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Landing from './pages/Landing'
import Join from './pages/Join'
import Play from './pages/Play'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Forgot from './pages/Forgot'
import Reset from './pages/Reset'
import Legal from './pages/Legal'
import Dashboard from './pages/Dashboard'
import QuizEditor from './pages/QuizEditor'
import Console from './pages/Console'
import Results from './pages/Results'
import Projection from './pages/Projection'
import Connexion from './pages/Connexion'
import StudentSignup from './pages/StudentSignup'
import StudentHome from './pages/StudentHome'
import StudyNew from './pages/StudyNew'
import Evolution from './pages/Evolution'
import StudyCourse from './pages/StudyCourse'
import Admin from './pages/Admin'
import AdminLogin from './pages/AdminLogin'
import SsoConnexion from './pages/SsoConnexion'
import Subscribe from './pages/Subscribe'
import SubscribeReturn from './pages/SubscribeReturn'
import { adminToken, studentToken, teacherToken } from './lib/api'

const Private = ({ children }: { children: React.ReactElement }) => {
  const loc = useLocation()
  return teacherToken() ? children : <Navigate to={`/enseignant/connexion?next=${encodeURIComponent(loc.pathname)}`} replace />
}

const PrivateStudent = ({ children }: { children: React.ReactElement }) => {
  const loc = useLocation()
  return studentToken() ? children : <Navigate to={`/connexion?next=${encodeURIComponent(loc.pathname)}`} replace />
}

const PrivateAdmin = ({ children }: { children: React.ReactElement }) => (adminToken() ? children : <Navigate to="/admin/connexion" replace />)

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/j/:code" element={<Join />} />
      <Route path="/play/:code" element={<Play />} />
      <Route path="/projection/:code" element={<Projection />} />
      <Route path="/connexion" element={<Connexion />} />
      <Route path="/sso/connexion" element={<SsoConnexion />} />
      <Route path="/etudiant/inscription" element={<StudentSignup />} />
      <Route path="/etudiant" element={<PrivateStudent><StudentHome /></PrivateStudent>} />
      <Route path="/etudiant/abonnement" element={<PrivateStudent><Subscribe /></PrivateStudent>} />
      <Route path="/etudiant/abonnement/retour" element={<PrivateStudent><SubscribeReturn /></PrivateStudent>} />
      <Route path="/etudiant/evolution" element={<PrivateStudent><Evolution /></PrivateStudent>} />
      <Route path="/etudiant/study/nouveau" element={<PrivateStudent><StudyNew /></PrivateStudent>} />
      <Route path="/etudiant/study/:id" element={<PrivateStudent><StudyCourse /></PrivateStudent>} />
      <Route path="/enseignant/connexion" element={<Login />} />
      <Route path="/enseignant/inscription" element={<Signup />} />
      <Route path="/enseignant/mot-de-passe-oublie" element={<Forgot />} />
      <Route path="/enseignant/nouveau-mot-de-passe" element={<Reset />} />
      <Route path="/cgu" element={<Legal kind="cgu" />} />
      <Route path="/confidentialite" element={<Legal kind="privacy" />} />
      <Route path="/admin/connexion" element={<AdminLogin />} />
      <Route path="/admin" element={<PrivateAdmin><Admin /></PrivateAdmin>} />
      <Route path="/enseignant" element={<Private><Dashboard /></Private>} />
      <Route path="/enseignant/quiz/:id" element={<Private><QuizEditor /></Private>} />
      <Route path="/enseignant/session/:id" element={<Private><Console /></Private>} />
      <Route path="/enseignant/resultats/:id" element={<Private><Results /></Private>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
