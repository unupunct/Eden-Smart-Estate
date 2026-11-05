import { useEffect, useState } from 'react'
import { Bell, BookOpen, Box, Camera, ChevronsLeft, ChevronsRight, ClipboardList, CloudSun, Cpu, FileBarChart, Droplets, FileText, Flower2, Home, LayoutDashboard, LogOut, Search, Map as MapIcon, Moon, Settings, Sprout, Sun, TreeDeciduous, Warehouse, Zap } from 'lucide-react'
import { startAutosave } from './model/autosave'
import { useLibrary } from './library/store'
import { useApp, type Route } from './model/app'
import { NewPropertyDialog } from './panels/NewProperty'
import { Overview } from './pages/Overview'
import { Suspense, lazy } from 'react'
const ImageImportDialog = lazy(() => import('./panels/ImageImport').then((m) => ({ default: m.ImageImportDialog })))
const EditorPage = lazy(() => import('./pages/EditorPage').then((m) => ({ default: m.EditorPage })))
const GardenPage = lazy(() => import('./pages/Design').then((m) => ({ default: m.GardenPage })))
const GreenhousePage = lazy(() => import('./pages/Design').then((m) => ({ default: m.GreenhousePage })))
const OrchardPage = lazy(() => import('./pages/Design').then((m) => ({ default: m.OrchardPage })))
const PondPage = lazy(() => import('./pages/Design').then((m) => ({ default: m.PondPage })))
const LibraryPage = lazy(() => import('./pages/Library').then((m) => ({ default: m.LibraryPage })))
const BuildingsPage = lazy(() => import('./pages/Buildings').then((m) => ({ default: m.BuildingsPage })))
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })))
const SunPage = lazy(() => import('./pages/Sun').then((m) => ({ default: m.SunPage })))
const SkyPage = lazy(() => import('./pages/Sky').then((m) => ({ default: m.SkyPage })))
const SmartHomePage = lazy(() => import('./pages/SmartHome').then((m) => ({ default: m.SmartHomePage })))
const SecurityPage = lazy(() => import('./pages/Security').then((m) => ({ default: m.SecurityPage })))
const AutomationsPage = lazy(() => import('./pages/Automations').then((m) => ({ default: m.AutomationsPage })))
const TasksPage = lazy(() => import('./pages/Tasks').then((m) => ({ default: m.TasksPage })))
const DocumentsPage = lazy(() => import('./pages/Documents').then((m) => ({ default: m.DocumentsPage })))
const WeatherPage = lazy(() => import('./pages/Weather').then((m) => ({ default: m.WeatherPage })))
const ReportsPage = lazy(() => import('./pages/Reports').then((m) => ({ default: m.ReportsPage })))

import { ErrorBoundary } from './ErrorBoundary'
import { LoginScreen } from './Login'
import { useManage } from './manage/store'
import { useReminders } from './manage/reminders'
import { SearchPalette } from './search/SearchPalette'
import { useSmart } from './smart/store'

const NAV: { route: Route; label: string; icon: React.ReactNode; live?: boolean }[] = [
  { route: 'overview', label: 'Estate Overview', icon: <LayoutDashboard size={18} />, live: true },
  { route: 'editor', label: 'Property Editor', icon: <MapIcon size={18} />, live: true },
  { route: 'buildings', label: 'Buildings', icon: <Warehouse size={18} />, live: true },
  { route: 'garden', label: 'Garden & Permaculture', icon: <Flower2 size={18} />, live: true },
  { route: 'orchard', label: 'Orchard', icon: <TreeDeciduous size={18} />, live: true },
  { route: 'greenhouse', label: 'Greenhouse', icon: <Sprout size={18} />, live: true },
  { route: 'pond', label: 'Natural Swimming Pond', icon: <Droplets size={18} />, live: true },
  { route: 'library', label: 'Plants & Mushrooms', icon: <BookOpen size={18} />, live: true },
  { route: 'smart', label: 'Smart Home', icon: <Cpu size={18} />, live: true },
  { route: 'automations', label: 'Automations', icon: <Zap size={18} />, live: true },
  { route: 'security', label: 'Security & Cameras', icon: <Camera size={18} />, live: true },
  { route: 'sun', label: 'Sun & Shadows', icon: <Sun size={18} />, live: true },
  { route: 'sky', label: 'Night Sky', icon: <Moon size={18} />, live: true },
  { route: 'tasks', label: 'Tasks & Maintenance', icon: <ClipboardList size={18} />, live: true },
  { route: 'weather', label: 'Weather', icon: <CloudSun size={18} />, live: true },
  { route: 'notes', label: 'Notes & Documents', icon: <FileText size={18} />, live: true },
  { route: 'reports', label: 'Reports', icon: <FileBarChart size={18} />, live: true },
  { route: 'settings', label: 'Settings', icon: <Settings size={18} />, live: true },
]

export default function App() {
  const { route, go, collapsed, toggleSidebar, booting, serverError, dialog, boot } = useApp()
  const currentId = useApp((s) => s.currentId)
  useReminders()
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearching((s) => !s)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  const [auth, setAuth] = useState<'checking' | 'login' | 'ok'>('checking')
  const [authRequired, setAuthRequired] = useState(false)
  useEffect(() => {
    fetch('/api/auth/status').then((r) => r.json()).then((st: { required: boolean; authenticated: boolean }) => {
      setAuthRequired(st.required)
      setAuth(st.required && !st.authenticated ? 'login' : 'ok')
    }).catch(() => setAuth('ok')) // server unreachable: the normal error screen explains it
  }, [])
  useEffect(() => {
    if (auth !== 'ok') return
    void useManage.getState().load(currentId)
    const h = setInterval(() => void useManage.getState().load(currentId), 30000)
    return () => clearInterval(h)
  }, [currentId, auth])
  useEffect(() => {
    if (auth !== 'ok') return
    void boot()
    void useLibrary.getState().load()
    void useSmart.getState().load()
    const poll = setInterval(() => void useSmart.getState().load(), 10000)
    const stop = startAutosave()
    return () => {
      clearInterval(poll)
      stop()
    }
  }, [boot, auth])

  if (auth === 'login') return <LoginScreen onDone={() => location.reload()} />
  if (auth === 'checking') return null

  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
      <nav className="sidebar">
        <div className="brand">
          <span className="logo"><Home size={18} /></span>
          {!collapsed && <div><strong>EDEN</strong><small>Smart Estate</small></div>}
        </div>
        <button className="navitem" onClick={() => setSearching(true)} title="Search everything (Ctrl+K)"><Search size={18} />{!collapsed && <><span>Search</span><i className="soon">Ctrl K</i></>}</button>
        <div className="navlist">
          {NAV.map((n) => (
            <button key={n.route} className={`navitem ${route === n.route ? 'on' : ''}`} onClick={() => go(n.route)} title={n.label}>
              {n.icon}
              {!collapsed && <span>{n.label}</span>}
              {!collapsed && !n.live && <i className="soon" title="Planned module">soon</i>}
            </button>
          ))}
        </div>
        {authRequired && <button className="navitem" title="Sign out" onClick={() => void fetch('/api/auth/logout', { method: 'POST' }).then(() => location.reload())}><LogOut size={18} />{!collapsed && <span>Sign out</span>}</button>}
        <button className="navitem collapse" onClick={toggleSidebar} title={collapsed ? 'Expand menu' : 'Collapse menu'}>
          {collapsed ? <ChevronsRight size={18} /> : <><ChevronsLeft size={18} /><span>Collapse</span></>}
        </button>
      </nav>
      <main className="main">
        <ErrorBoundary key={route} onHome={() => go('overview')}>
        <Suspense fallback={<div className="emptystate"><Box className="spin" /><p>Loading…</p></div>}>
        {booting ? (
          <div className="emptystate"><Box className="spin" /><p>Loading…</p></div>
        ) : serverError ? (
          <div className="emptystate">
            <Bell />
            <h2>Cannot reach the EDEN server</h2>
            <p>{serverError}</p>
            <p className="muted">Start it with <code>scripts\start.ps1</code> (see the README), then reload this page.</p>
            <button className="primary" onClick={() => location.reload()}>Retry</button>
          </div>
        ) : route === 'overview' ? <Overview />
          : route === 'editor' ? <EditorPage />
          : route === 'settings' ? <SettingsPage />
          : route === 'garden' ? <GardenPage />
          : route === 'orchard' ? <OrchardPage />
          : route === 'greenhouse' ? <GreenhousePage />
          : route === 'pond' ? <PondPage />
          : route === 'library' ? <LibraryPage />
          : route === 'sun' ? <SunPage />
          : route === 'sky' ? <SkyPage />
          : route === 'smart' ? <SmartHomePage />
          : route === 'security' ? <SecurityPage />
          : route === 'automations' ? <AutomationsPage />
          : route === 'tasks' ? <TasksPage />
          : route === 'notes' ? <DocumentsPage />
          : route === 'weather' ? <WeatherPage />
          : route === 'reports' ? <ReportsPage />
          : route === 'buildings' ? <BuildingsPage />
          : <Overview />}
        </Suspense>
        </ErrorBoundary>
      </main>
      <SearchPalette open={searching} onClose={() => setSearching(false)} />
      {dialog === 'new-property' && <NewPropertyDialog />}
      {dialog === 'image-import' && <Suspense fallback={null}><ImageImportDialog /></Suspense>}
    </div>
  )
}
