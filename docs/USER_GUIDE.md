# User guide — Property Editor

## The workspace

| Area | What it holds |
|---|---|
| **Top bar** | Property switcher · **New** · Undo/Redo · Save status · Import · Export · base map · 2D/3D · zoom to everything · search |
| **Left panel** | **Draw** (tools and object palette) · **Layers** · **Images** |
| **Centre** | The map. Floating bar at the top shows the active tool, its preset/shape options and **Snap**. A hint at the bottom says what to do next. |
| **Right panel** | Property summary when nothing is selected; the selected object's properties and measurements otherwise |
| **Bottom bar** | Cursor coordinates · zoom · selection · **property area** · map mode and imagery provider |

Changes are saved automatically (the pill in the top bar says *All changes saved*). **Ctrl+S** saves immediately.

## 1. Create a property and find your land

*Top bar → New* (or *Estate Overview → New property*). Type a place or coordinates (`46.0484, 24.0526` — latitude first). Pick the result and create. In the editor you can also use the search box (top right) any time to jump somewhere.

Use the mouse wheel to zoom, drag to pan. Switch the base map in the top bar: **Satellite**, **Hybrid**, **Streets**, **Terrain**, or **Blank grid** (useful with your own imported plan).

## 2. Draw the property boundary

1. *Draw* tab → **Property boundary**.
2. Click each corner of your plot. Corners snap to existing objects' corners and edges (hold **Alt** to switch snapping off).
3. Finish by clicking the **first point**, pressing **Enter**, or double-clicking.

The bottom bar and the right panel now show the **total property area** in m² and hectares, and the boundary perimeter. While drawing you see each edge length live.

Not satisfied? Select the boundary (click its outline) and drag corners — see *Editing* below.

## 3. Add things

Pick a tool in the *Draw* tab. Many tools have **presets** in the floating bar (for example Building → Main house / Workshop / Barn …; Tree → Apple / Walnut / …; Fence → Wooden / Concrete / …).

| Geometry | How |
|---|---|
| **Polygon** (boundary, zone, building, greenhouse, pond, garden bed…) | *polygon*: click corners · *rectangle*: click two opposite corners · *circle*: click centre, then a point on the edge |
| **Line** (fence, hedge, road, path, pipes, cable) | click points; double-click or **Enter** to finish |
| **Point** (tree, bush, plant, gate, camera, outlet, light, sensor, note…) | click to place; you stay in the tool to place more; **Esc** to stop |

**Backspace** removes the last point while drawing; **Esc** cancels. Right-click while drawing cancels the current shape.

Trees and bushes are drawn with their **true canopy size**; roads and paths with their **true width**.

## 4. Editing

Switch to **Select** (or press **Esc**) and click an object. Click on empty ground to deselect; **Shift-click** selects several.

| Action | How |
|---|---|
| Move | Drag the object |
| Reshape | Drag a white corner dot |
| Add a corner | Drag a faint dot on an edge |
| Remove a corner | Right-click it (or double-click it) |
| Rotate | Drag the green handle above the shape (**Shift** = 15° steps), or use *Transform* in the right panel |
| Scale | *Transform → shrink/grow 10%* |
| Duplicate | **Ctrl+D** or *Duplicate* button |
| Delete | **Delete** key or *Delete* button |
| Rename, colour, notes | Right panel |
| Move to another layer | *Layer* drop-down in the right panel |

Selected objects show their **edge lengths** and **area/perimeter** directly on the map.

### Object properties

The right panel adapts to the kind of object. A few examples:

- **Building** – type, floors, height, roof type, ridge bearing, exterior material, year built, doors, windows, entrances, electricity/water/heating/internet.
- **Fence** – type, height, colour, section length (the panel shows the resulting number of sections), construction notes. **Gate** objects store width and type.
- **Tree** – species, variety, category, planted year, height, canopy diameter, rootstock, harvest season.
- **Garden bed** – bed type, soil, rows, plant spacing, plant quantity, crops, mulch, irrigation, planting date, expected harvest.
- **Camera** – viewing direction and field of view are drawn as a coverage wedge on the map.
- Everything also has **Status**, **Description** and **Notes**.

Smart-device objects (outlet, camera, light, sensor) are **positions only**: EDEN shows the notice *not connected* and never invents live values.

## 5. Layers

*Left panel → Layers.* Seventeen layers are created for every property.

- 👁 show/hide · 🔒 lock (locked layers cannot be selected or changed) · colour swatch · **double-click the name to rename** · arrows reorder (upper layers draw on top) · **Add layer** for your own.
- The colour of a layer applies to objects that have no colour of their own, so you can recolour a whole category at once.
- Hidden layers are removed from the map and from snapping.

## 6. Measuring

- Select objects to see their measurements, or
- use **Distance** (click points; double-click to finish; Σ shows the total) or **Area** (click an outline; shows area and perimeter). Measurements are geodesic and stay correct at any zoom or map layer. Press **Esc** to clear.

Whole-property figures (area, boundary perimeter, fence and path lengths, pond surface, bed area…) are on the right panel when nothing is selected, and on the **Estate Overview** page.

## 7. Undo, redo, autosave

**Ctrl+Z** undo · **Ctrl+Y** or **Ctrl+Shift+Z** redo (up to 200 steps). A whole drag is one step; typing in a field is grouped. Autosave writes only what changed, roughly one second after you stop. If a save fails the pill turns red and EDEN keeps retrying; your work stays on screen.

## 8. Your own aerial photo or plan

*Left panel → Images → Import and calibrate image.* Choose a PNG, JPEG or WebP, then one of:

1. **Two known points** – click two recognisable spots on the picture (e.g. two building corners), press *Next*, then click the same two spots on the map.
2. **Known distance** – click two points whose real distance you know, enter the distance and the compass bearing from point 1 to point 2 (0° north, 90° east), then click where point 1 is on the map.
3. **World file** – paste the six numbers of a `.jgw/.pgw/.wld` file and pick its coordinate system (EPSG:4326 degrees or EPSG:3857 metres).

The image is placed with its true scale and rotation (not stretched). Adjust **opacity**, hide or remove it in the *Images* tab. Tip: set the base map to *Blank grid* to work from your plan alone.

## 9. 2D and 3D

The **2D/3D** button tilts the camera and extrudes buildings (floors/height), greenhouses, tree crowns (height and canopy), fences and hedges from the *same* objects — there is no separate 3D data. Rotate and tilt with right-mouse drag (or two fingers on a touch screen), zoom as usual; the 3D button returns to the flat 2D view. Roofs are flat extrusions in this version.

## 10. Import, export, backup

- **Import → GeoJSON / KML** adds features to the current property (kinds are recognised by an EDEN `kind` attribute; other shapes become zones, paths or notes).
- **Export → GeoJSON, KML, CSV, EDEN project**. GeoJSON and CSV include area and length for each object. An EDEN project file (`.eden.json`) can be imported on another computer from *Import → EDEN project file* or *Estate Overview → Import project*.
- **Settings → Backup and restore** makes a complete .zip of database and images.

## 11. Search

The top-right box searches your objects by name, type and species (click a result to zoom to it and select it), jumps to `lat, lng`, and — on Enter — looks up places.

## Keyboard shortcuts

| Key | Action |
|---|---|
| Esc | Cancel drawing → leave tool → deselect |
| Enter | Finish line/polygon |
| Backspace | Remove last drawn point |
| Delete | Delete selection |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+D | Duplicate |
| Ctrl+S | Save now |
| Shift-click | Add to selection |
| Shift while rotating | 15° steps |
| Alt while drawing | Disable snapping |
| Right-click corner | Remove corner |

## Tips

- Trace the boundary first, then buildings, then everything else — snapping keeps fences exactly on the boundary.
- Draw one fence along the whole boundary and add **Gate** points where access is needed.
- Lock the *Property boundary* and *Zones* layers once they are right, so you cannot move them by accident while editing details.
- Use **Blank grid** + an imported plan for indoor-scale or off-grid sketches.
