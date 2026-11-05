import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useLibrary } from '../library/store'
import { useManage } from '../manage/store'
import { useApp, type Route } from '../model/app'
import { useEditor } from '../model/store'
import { useSmart } from '../smart/store'
import { searchAll, TYPE_LABEL, type Hit } from './global'
import { useIntent } from './intent'

export const SEARCH_PAGES: { route: Route; label: string; keywords: string }[] = [
  { route: 'overview', label: 'Estate Overview', keywords: 'home dashboard summary properties' },
  { route: 'editor', label: 'Property Editor', keywords: 'map draw boundary layers measure' },
  { route: 'buildings', label: 'Buildings', keywords: 'house floors floor area services' },
  { route: 'garden', label: 'Garden & Permaculture', keywords: 'beds plantings companion' },
  { route: 'orchard', label: 'Orchard', keywords: 'trees fruit pollination age' },
  { route: 'greenhouse', label: 'Greenhouse', keywords: 'glass heater vents' },
  { route: 'pond', label: 'Natural Swimming Pond', keywords: 'water fish volume quality' },
  { route: 'library', label: 'Plants & Mushrooms library', keywords: 'species plants mushrooms fish aquatic' },
  { route: 'smart', label: 'Smart Home', keywords: 'devices home assistant mqtt integrations outlets sensors' },
  { route: 'automations', label: 'Automations', keywords: 'rules triggers log' },
  { route: 'security', label: 'Security & Cameras', keywords: 'camera pictures rtsp' },
  { route: 'sun', label: 'Sun & Shadows', keywords: 'shade sunlight hours sunrise sunset shadows' },
  { route: 'sky', label: 'Night Sky', keywords: 'stars moon planets astronomy' },
  { route: 'tasks', label: 'Tasks & Maintenance', keywords: 'reminders todo calendar history' },
  { route: 'weather', label: 'Weather', keywords: 'forecast frost rain wind' },
  { route: 'notes', label: 'Notes & Documents', keywords: 'photos files manuals pdf receipts' },
  { route: 'reports', label: 'Reports', keywords: 'print pdf export csv' },
  { route: 'settings', label: 'Settings', keywords: 'backup restore imagery provider keys' },
]

/** Ctrl+K: one search over pages, map objects, the plant library, tasks, documents, devices and automations. */
export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <PaletteBody onClose={onClose} /> : null // mounted fresh on every open: empty query, focused input
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const go = useApp((s) => s.go)
  const objects = useEditor((s) => s.doc.objects)
  const focus = useEditor((s) => s.requestFocus)
  const lib = useLibrary((s) => s.lib)
  const { tasks, documents } = useManage()
  const { devices, automations, cameras, integrations } = useSmart()
  const hits = useMemo(() => searchAll(q, { pages: SEARCH_PAGES, objects: Object.values(objects), lib, tasks, documents, devices, automations, cameras, integrations }), [q, objects, lib, tasks, documents, devices, automations, cameras, integrations])

  useEffect(() => setSel(0), [q])

  const choose = (h: Hit) => {
    onClose()
    const tab = { plant: 'plants', aquatic: 'aquatic', fish: 'fish', mushroom: 'mushrooms' } as const
    switch (h.type) {
      case 'page': return go(h.route!)
      case 'object': focus(h.id); return go('editor')
      case 'plant': case 'aquatic': case 'fish': case 'mushroom': useIntent.getState().set({ library: { tab: tab[h.type], q: h.title } }); return go('library')
      case 'task': return go('tasks')
      case 'document': useIntent.getState().set({ documentsQ: h.title }); return go('notes')
      case 'device': case 'integration': return go('smart')
      case 'automation': return go('automations')
      case 'camera': return go('security')
    }
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(hits.length - 1, s + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
    else if (e.key === 'Enter' && hits[sel]) choose(hits[sel])
  }
  let lastType = ''
  return (
    <div className="modal-back palette-back" onClick={onClose}>
      <div className="palette glass" role="dialog" aria-label="Search" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="palette-input"><Search size={16} />
          <input ref={input} autoFocus aria-label="Search everything" placeholder="Search pages, objects, plants, tasks, documents, devices…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="palette-list" role="listbox">
          {hits.map((h, i) => {
            const head = h.type !== lastType ? <div className="palette-head">{TYPE_LABEL[h.type]}</div> : null
            lastType = h.type
            return (
              <div key={`${h.type}-${h.id}`}>
                {head}
                <button role="option" aria-selected={i === sel} className={`palette-item ${i === sel ? 'on' : ''}`} onMouseMove={() => setSel(i)} onClick={() => choose(h)}>
                  <b>{h.title}</b><small>{h.subtitle}</small>
                </button>
              </div>
            )
          })}
          {q.trim() && !hits.length && <p className="empty">Nothing found for “{q.trim()}”.</p>}
          {!q.trim() && <p className="empty">Type to search. Accents and capital letters do not matter. <kbd>↑</kbd> <kbd>↓</kbd> to move, <kbd>Enter</kbd> to open, <kbd>Esc</kbd> to close.</p>}
        </div>
      </div>
    </div>
  )
}
