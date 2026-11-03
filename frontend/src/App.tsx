import { useEffect } from 'react'
import { Bell, BookOpen, Box, Camera, ChevronsLeft, ChevronsRight, ClipboardList, Cpu, Droplets, FileText, Flower2, Home, LayoutDashboard, Map as MapIcon, Moon, Settings, Sprout, Sun, TreeDeciduous, Warehouse } from 'lucide-react'
import { startAutosave } from './model/autosave'
import { useLibrary } from './library/store'
import { useApp, type Route } from './model/app'
import { ImageImportDialog } from './panels/ImageImport'
import { NewPropertyDialog } from './panels/NewProperty'
import { EditorPage } from './pages/EditorPage'
import { GardenPage, GreenhousePage, OrchardPage, PondPage } from './pages/Design'
import { LibraryPage } from './pages/Library'
import { ModulePage } from './pages/Modules'
import { Overview } from './pages/Overview'
import { SettingsPage } from './pages/Settings'

const NAV: { route: Route; label: string; icon: React.ReactNode; live?: boolean }[] = [
  { route: 'overview', label: 'Estate Overview', icon: <LayoutDashboard size={18} />, live: true },
  { route: 'editor', label: 'Property Editor', icon: <MapIcon size={18} />, live: true },
  { route: 'buildings', label: 'Buildings', icon: <Warehouse size={18} /> },
  { route: 'garden', label: 'Garden & Permaculture', icon: <Flower2 size={18} />, live: true },
  { route: 'orchard', label: 'Orchard', icon: <TreeDeciduous size={18} />, live: true },
  { route: 'greenhouse', label: 'Greenhouse', icon: <Sprout size={18} />, live: true },
  { route: 'pond', label: 'Natural Swimming Pond', icon: <Droplets size={18} />, live: true },
  { route: 'library', label: 'Plants & Mushrooms', icon: <BookOpen size={18} />, live: true },
  { route: 'smart', label: 'Smart Home', icon: <Cpu size={18} /> },
  { route: 'security', label: 'Security & Cameras', icon: <Camera size={18} /> },
  { route: 'sun', label: 'Sun & Shadows', icon: <Sun size={18} /> },
  { route: 'sky', label: 'Night Sky', icon: <Moon size={18} /> },
  { route: 'tasks', label: 'Tasks & Maintenance', icon: <ClipboardList size={18} /> },
  { route: 'notes', label: 'Notes & Documents', icon: <FileText size={18} /> },
  { route: 'settings', label: 'Settings', icon: <Settings size={18} />, live: true },
]

export default function App() {
  const { route, go, collapsed, toggleSidebar, booting, serverError, dialog, boot } = useApp()
  useEffect(() => {
    void boot()
    void useLibrary.getState().load()
    return startAutosave()
  }, [boot])

  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
      <nav className="sidebar">
        <div className="brand">
          <span className="logo"><Home size={18} /></span>
          {!collapsed && <div><strong>EDEN</strong><small>Smart Estate</small></div>}
        </div>
        <div className="navlist">
          {NAV.map((n) => (
            <button key={n.route} className={`navitem ${route === n.route ? 'on' : ''}`} onClick={() => go(n.route)} title={n.label}>
              {n.icon}
              {!collapsed && <span>{n.label}</span>}
              {!collapsed && !n.live && <i className="soon" title="Planned module">soon</i>}
            </button>
          ))}
        </div>
        <button className="navitem collapse" onClick={toggleSidebar} title={collapsed ? 'Expand menu' : 'Collapse menu'}>
          {collapsed ? <ChevronsRight size={18} /> : <><ChevronsLeft size={18} /><span>Collapse</span></>}
        </button>
      </nav>
      <main className="main">
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
          : <ModulePage route={route} />}
      </main>
      {dialog === 'new-property' && <NewPropertyDialog />}
      {dialog === 'image-import' && <ImageImportDialog />}
    </div>
  )
}
