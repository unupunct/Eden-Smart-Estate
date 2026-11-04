import { useEffect } from 'react'
import { CalibrationFinisher } from '../panels/ImageImport'
import { LeftPanel } from '../panels/LeftPanel'
import { MapView } from '../panels/MapView'
import { PropertiesPanel } from '../panels/PropertiesPanel'
import { StatusBar } from '../panels/StatusBar'
import { TopBar } from '../panels/TopBar'
import { useApp } from '../model/app'
import { useEditor } from '../model/store'

export function EditorPage() {
  const property = useEditor((s) => s.property)
  const tool = useEditor((s) => s.tool)
  const cal = useEditor((s) => s.calibration)
  const setCal = useEditor((s) => s.setCalibration)
  const setDialog = useApp((s) => s.setDialog)
  // leaving the calibrate tool (Esc) abandons a half-finished image placement
  useEffect(() => {
    if (cal && cal.phase === 'pick-map' && tool.type !== 'calibrate') setCal(null)
  }, [tool, cal, setCal])

  if (!property) {
    return (
      <div className="emptystate">
        <h2>No property open</h2>
        <p>Create a property to start designing, or load the demo estate from the Estate Overview.</p>
        <button className="primary" onClick={() => setDialog('new-property')}>New property</button>
      </div>
    )
  }
  return (
    <div className="editor">
      <h1 className="sr-only">Property editor: {property.name}</h1>
      <TopBar />
      <div className="editor-body">
        <LeftPanel />
        <div className="center">
          <MapView key={property.id} property={property} />
          <StatusBar />
        </div>
        <PropertiesPanel />
      </div>
      <CalibrationFinisher />
    </div>
  )
}
