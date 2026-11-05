import { useEffect, useState } from 'react'
import { manageApi } from '../api/client'
import type { OcrStatus } from '../manage/types'

/** Settings → Reading text from documents (OCR). */
export function OcrCard() {
  const [st, setSt] = useState<OcrStatus | null>(null)
  const [langs, setLangs] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { manageApi.ocrStatus().then((s) => { setSt(s); setLangs(s.selected.join(' + ')) }).catch((e) => setErr((e as Error).message)) }, [])
  if (!st) return err ? <div className="notice err">{err}</div> : null
  const save = async () => {
    setErr('')
    try {
      const list = langs.split(/[+,\s]+/).filter(Boolean)
      const s = await manageApi.ocrLanguages(list)
      setSt(s)
      setLangs(s.selected.join(' + '))
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <section className="glass formcard" aria-labelledby="ocr-h">
      <h2 id="ocr-h">Reading text from documents (OCR)</h2>
      <p className="note">EDEN makes the text inside your documents searchable. Text files, Word, Excel and OpenDocument files and PDFs with a text layer work out of the box. Photos and scanned PDFs are read with the open-source Tesseract engine on this computer; nothing is uploaded. OCR is a machine reading: it can contain mistakes, so EDEN always labels it and never uses it as a verified value.</p>
      {err && <div className="notice err" role="alert">{err}</div>}
      <p>{st.available ? <>Engine: <strong>{st.version || 'Tesseract'}</strong> · languages installed: {st.installed.join(', ') || 'none'}</> : <strong>Tesseract is not installed.</strong>}</p>
      {st.hint && <div className="notice">{st.hint}</div>}
      <label>Languages to read (3-letter codes joined by +, for example <code>eng + ron</code>)
        <input value={langs} onChange={(e) => setLangs(e.target.value)} />
      </label>
      <button onClick={() => void save()}>Save languages</button>
    </section>
  )
}
