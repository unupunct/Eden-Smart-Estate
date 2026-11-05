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

## 12. The plant library and “Add to property”

*Sidebar → Plants & Mushrooms.* Four tabs: **Plants & trees** (100 entries), **Mushrooms** (26), **Aquatic plants** (25) and **Pond fish** (10).

- **Filter** by name (common, Latin or Romanian), category (vegetables, herbs, fruit trees, nut trees, native, medicinal, toxic…), native status, sun, water, edibility, winter hardiness zone, flowering month, harvest month, mature height and wildlife value. **Companion of…** lists only the plants that have a recorded relationship with the plant you choose.
- Click a plant for its detail page: size, soil, spacing, sowing/flowering/harvest months, propagation, wildlife value, notes, pollination needs (fruit trees) and every companion relationship with its **evidence label**.
- **ADD TO PROPERTY** switches to the map with that species armed: each click places one specimen (trees, bushes or plants, named after the species, linked to the library). Press **Esc** to stop. Aquatic plants and invasive-species warnings work the same way (invasive aquatic plants cannot be added).
- Toxic plants ask for confirmation before they are placed.
- **Medicinal** entries describe *traditional* use only — not evidence, not medical advice. **Mushrooms** never claim that anything is safe because of a photo; no photos are bundled; poisonous and deadly species and look-alikes are called out first.

The data is a starter set (see the README). Where the library has no record it says so — that is *not* a statement that two plants are compatible.

## 13. Garden beds, companion planting and neighbour checks

1. Draw a **Garden bed** and select it. In the right panel *Plantings*: add each crop from the drop-down, then enter the number of plants, spacing (cm) and sowing date. EDEN shows the room for each crop at that spacing, warns when the plan is overcrowded, and lists the sowing and harvest months.
2. **Companion check** lists every pair of crops in the bed:
   - 🟢 **green** – documented compatibility or benefit;
   - 🟡 **yellow** – conditional, or only *mixed* or *traditional* evidence ("potentially compatible");
   - 🔴 **red** – known incompatibility.
   Each row shows the evidence label and the explanation (for example *tomato + potato: same family, shared late blight*).
3. Place individual plants from the library. Select one: the panel lists relationships with plants **near it** (within 6 m; 15 m around walnut trees because of juglone), and the map draws **green / yellow / red links** to those neighbours. *All known companions of …* lists everything the library knows, with a *place* button for good partners.
4. The **Garden & Permaculture** page lists all beds with their planting totals and worst companion result, and has a companion explorer for any plant.

## 14. Orchard

- Choose a **Species** for each tree in its panel (or place trees from the library). Enter **variety**, **planting year**, rootstock and expected yield. The panel shows **age**, **mature canopy** and **mature height** from the library, and keeps **pruning**, **fertilisation** and **pests and diseases** logs.
- **Show projected mature canopy** (chip at the top of the map or tick-box in the tree panel) draws a dashed ring per tree at its eventual size, so you can judge spacing.
- **Pollination:** for species that need a partner, EDEN looks for a *different named variety of the same species within 50 m*. It reports *partner nearby*, *no partner within 50 m*, *variety needed* or *self-fertile*. Real compatibility depends on each cultivar's pollination group and flowering time — confirm with your nursery.
- **Plant a grid:** select an **Orchard area** and use *Plant a grid of trees*: pick the species, spacing along and between rows, row angle and stagger; the button shows how many trees will be planted. One **Undo** removes the whole grid.
- The **Orchard** page shows statistics (trees, species, average age, mature canopy as a share of the orchard area) and a table of trees with pollination status.

## 15. Greenhouse

Draw a **Greenhouse** footprint, then draw its interior from the **Greenhouse** group: growing beds, shelving, doors, ventilation windows, heater, fan/cooling, grow lights, irrigation outlets and a water tank (add **sensors** and **smart outlets** from the Utilities group). The panel shows true length × width, floor area, the compass direction of the long axis, and how many items are inside. Fill in the **Target ranges** (temperature, humidity, soil moisture). Monitoring is marked *no sensors connected*: live readings, alerts and automation come with the smart-home integration.

## 16. Natural swimming pond

Draw the **Pond**, depth zones (**Pond zone**: swimming, regeneration, plant filtration, deep) and equipment (pump, filter, skimmer, waterfall, entry steps, stones, stream; pipes from the Water group). In the pond's panel:

- surface and **volume estimate** (zone areas × depths, remaining surface at half the maximum depth — a planning figure, not a survey);
- **Fish:** add species and numbers. Each gets a verdict for natural swimming ponds — *suitable*, *caution* (conditional) or *not suitable* (koi, goldfish, grass carp, mosquitofish…) — with reasons, including size, non-native and overstocking warnings. Many pond designers recommend no fish at all; check local rules.
- **Aquatic plants:** place them from the library into the pond area; any invasive species is flagged.
- **Water-quality log:** enter temperature, pH, dissolved oxygen, ammonia, nitrite and nitrate by hand. EDEN charts the trend and warns when the latest reading is outside general ranges. The ranges are general guidance and no sensor is connected.

## 17. Sun & Shadows

Open **Sun & Shadows** in the menu. The map shows the shadows cast by every **visible** building, greenhouse, solar installation, fence, hedge, tree and bush (hide a layer and its shadows disappear). The same **Shadows** switch and a time slider are in the Property Editor's floating bar.

**Controls (right panel)**
- **Date** and **time of day** (slider, with the daylight part highlighted), a **play** button that sweeps through the day, **Now**, and quick jumps to the March and September equinox and June and December solstice.
- **Time zone:** defaults to your browser's zone and is remembered per property. Change it if the property is somewhere else.
- **Tree and hedge foliage:** *automatic by month* (leaves May–September in the northern hemisphere, half in April and October, reversed in the south), or force *leaves on* / *leaves off*. Evergreens in the library (spruce, fir, Scots pine, yew) keep shading in winter.
- **Sun-hours map:** colours the whole property by the hours of direct sun on the selected date (purple/blue = shade, green = part sun, orange/red = long hours).

**Readouts:** azimuth and elevation, the shadow length of a 1 m post, sunrise, solar noon (with its altitude), sunset, day length and civil twilight. Where the sun never rises or never sets (polar night, midnight sun) EDEN says so instead of showing times.

**Sun path:** a plan view with north up. The white arc is the selected day with local hours marked, the coloured arcs are the four season days, and the yellow dot is the sun now.

**Direct sun table:** for each garden bed, greenhouse, greenhouse bed, orchard area and pond: average hours of direct sun on the selected date and on the four season days, and a *growing season* figure (the three seasons without the winter solstice). The bar colour shows full sun (6 h+), part sun (4–6), part shade (2–4) or shade (under 2); hover for the range across the area. Click a row to select it on the map.

**Light needs vs. what the beds get:** if a bed lists library plants, EDEN warns when a plant's light need (full sun 6 h+, full/part 4 h+, part sun 3 h+) is above the bed's growing-season average, or when a shade-lover sits in strong sun.

**How to use it:** to place a new bed, switch on the sun-hours map on a June date and on a March date: sites that are bright in both are good for sun-lovers; spots that are shaded in March but bright in June suit late crops. Drag a building, hedge or tree in the map and watch the numbers update.

**Roofs:** a building with a **gable, hip or mansard** roof casts the shape of its walls plus the sloping roof. *Height* is to the ridge; give the optional **wall (eave) height** for an exact roof rise, otherwise a rise of about a quarter of the building's width is assumed. The ridge follows *Roof ridge bearing* if set, otherwise the long side. A **shed** roof is modelled only when its bearing is set (otherwise the building stays a box, which overstates the shadow). Flat roofs, greenhouses and solar panels are boxes; the 3D view still draws every building as a box.

**What it does not know:** terrain (a hill or a neighbour's house outside your drawing casts no shade), roof details such as dormers and chimneys, exact crown shapes (cylinders from 30 % of the height up) and real leaf density. Foliage is assumed to block about 75 % of light in leaf, 20 % bare and 85 % for evergreens; greenhouse glazing is assumed to pass 60 %. Treat results as planning estimates.

## 18. Night Sky

Open **Night Sky**. The chart looks straight up from the property: the **zenith is in the centre, north at the top and east on the left** (as when you hold a star map over your head), with rings at 30° and 60°.

- **Sky colour** follows the sun: daylight, civil, nautical and astronomical twilight, night. Stars fade in through twilight; tick *Show stars in daylight* to see them anyway.
- **Stars:** about 100 of the brightest, with simplified constellation figures (Big Dipper, Cassiopeia, Orion, Cygnus, Lyra, the Summer Triangle, Scorpius, Leo, the Southern Cross, the Great Square, Andromeda, Gemini). Switch figures and names off if you like. Hover a star, planet, the Moon or the Sun for its name and altitude.
- **Planets:** Mercury, Venus, Mars, Jupiter and Saturn, accurate to roughly 1°. The table says whether each is above the horizon and whether it is likely visible (not in twilight or daylight).
- **Moon:** phase and percentage lit, position, moonrise and moonset for the date, distance, and the next full and new moon. The moon icon shows the lit fraction; its orientation is simplified.
- **Dark window with no moon:** the longest stretch between astronomical dusk and dawn with the moon below the horizon, a good time for faint objects. If there is none EDEN says why.
- Time controls are shared with the Sun page; the animation speed goes from 1 minute to 6 hours per second.

EDEN does not know the **cloud cover** or your local **light pollution**, and does not draw deep-sky objects, comets or satellites. The sky chart has no connection to weather data yet (Phase 6).

## 19. Smart Home

Open **Smart Home**. With nothing connected EDEN shows **no device status at all**; outlets, lights and sensors you drew on the map are simply marked *not connected*.

**Connect Home Assistant**
1. In Home Assistant open your profile and create a **long-lived access token**.
2. In EDEN choose *Add an integration → Home Assistant*, enter the address (for example `http://homeassistant.local:8123`) and the token, and press *Save & test*.
3. EDEN reads the entities of the supported types (switches, lights, sensors, binary sensors, locks, covers, climate, fans, humidifiers, valves, water heaters, cameras). A wrong token, a wrong address or an unreachable server is reported in plain words on the integration's card.

The token is stored on this computer, never shown again and never returned by the API (use *Change token* to replace it). EDEN refreshes states every few seconds while the server runs.

**MQTT:** add the broker (host, port, optional user name and password, TLS), then add each device as one exact state topic (and optionally a command topic; EDEN publishes `ON` / `OFF`). A device shows **no data** until its first message arrives. Needs the `paho-mqtt` package (installed by `install.ps1`).

**Devices table:** rename a device by editing its name; **link it to a map object** (outlet, light, sensor, camera…) so the object's panel in the editor shows the live state; tick **risky** for anything that could cause damage or harm if switched wrongly (heaters, pumps, door locks). Locks, covers, climate, valves and water heaters are risky by default. Risky devices ask *“Really send…?”* before every command. Read-only devices (sensors) have no buttons.

**What the state means:** the value is exactly what Home Assistant (or the MQTT message) reported, with its unit and *changed … ago*. `unavailable` / `unknown` are Home Assistant's own answers for an offline device. **no data** means nothing was ever reported. If the integration itself goes offline the card turns red, the values are marked *integration offline: last known value* and the control buttons are disabled.

After a command EDEN reads the state back from Home Assistant, so what you see afterwards is what Home Assistant says happened, not what EDEN hoped for.

## 20. Security & Cameras

*Add camera* and choose the type:
- **Snapshot URL (JPEG):** an address that returns the current picture (most IP cameras have one). Refreshed every 2–30 seconds, your choice; pause and full-screen are available.
- **MJPEG stream:** shown as a live stream.
- **RTSP stream:** needs **ffmpeg** on the EDEN computer; EDEN grabs a frame every few seconds (not smooth video). The page says if ffmpeg is missing.
- **Home Assistant camera:** a `camera.…` entity of your connected Home Assistant.

User name and password can be typed into the address (`http://user:pass@192.168.1.20/snap.jpg`); EDEN moves them into hidden storage and keeps a clean address. Pictures are fetched by the EDEN server, so camera credentials never reach the browser. You can link a camera to its position on the map.

If a camera cannot be reached EDEN shows the reason (*Cannot reach the camera*, *rejected the user name/password (401)*, *ffmpeg not found*), never an old or invented picture. Every picture shows when it was taken.

Not included: automatic ONVIF discovery (use the snapshot or RTSP address your camera publishes), recording, motion detection and cloud access.

## 21. Automations

*New automation*:
- **When:** a device *becomes* a value (`on`), *rises above* or *falls below* a number, or simply *changes*; or it is a **time of day** (optionally only on some weekdays, on the EDEN computer's clock). State triggers fire on a **change that EDEN observes**: never at start-up and never from an unknown or `unavailable` reading.
- **Only if (optional):** device conditions (is / is not / above / below) and a time window (which may span midnight). An unknown state never satisfies a condition.
- **Then:** control devices (on, off, lock, unlock, open, close) and/or write a message to the log.

Safeguards: *Dry run* shows what would happen and sends nothing; every command and every skipped trigger is written to the **activity log**; a rule cannot run more than once a minute; a rule is skipped when its integration is offline. A rule that controls a **risky** device can only be **enabled** after you tick the acknowledgement that it will operate that device without asking (a disabled draft needs none), and *Run now* asks for confirmation.

Rules run on the EDEN server **only while it is running**. Automations are a convenience, **not a safety system**: do not rely on them for frost protection, flood prevention, heating or locks.

## 22. Tasks & Maintenance

*New task*: what needs doing, a due date, a priority, a category, optionally the **object it is about** (a tree, bed, fence, building…), and optionally a repeat.

- **Views:** *Overdue*, *Today*, *Next 7 days*, *Later*, *No date*; switch to *Done* to see finished ones; filter by category. The Overview shows how many are overdue or due today.
- **Completing** a task ticks it off and writes a line to the **maintenance history** (with the day it was really done). A one-off task moves to *Done* (you can reopen it); a **repeating** task jumps to its next date.
- **Repeats:** every N days / weeks / months / years. *Keeping the original rhythm*: a task due every Monday stays on Mondays even if you did it on Wednesday, and occurrences you missed are skipped. *Counted from when I finish*: "3 weeks after each feeding". Month arithmetic keeps the day of the month (31 January → 28 February → 31 March).
- **On an object:** select a tree or bed in the Property Editor and its panel shows the open tasks, when it was last maintained, a quick *Add a task* box and its attachments.
- **Export:** *Export CSV* for a spreadsheet (text that starts with `=`, `+`, `-` or `@` is neutralised so it cannot run as a formula).

**Reminders:** tick *Browser notifications* to get one notification a day for overdue and due-today tasks while EDEN is open in a browser tab (the browser asks for permission once). *Calendar file (.ics)* downloads your open dated tasks as all-day events with a 09:00 alarm and, for tasks that repeat on their due date, the repeat rule: open it with your calendar app (Outlook, Google Calendar, Apple Calendar…) to see them on your phone. It is a snapshot, not a live feed: download it again after changes. There is no push to a closed browser and no e-mail.

## 23. Notes & Documents

*Add files* (JPG, PNG, WebP, GIF, PDF, TXT, CSV, MD, DOCX, XLSX, ODT, ODS, up to 40 MB). Choose first whether the files belong to the **whole property** or to a specific object. For each file you can set a title, **tags**, a note and a date (when the photo was taken or the document is dated), change which object it belongs to, download it or delete it. Photos open in a viewer; other files download or open in the browser's own viewer. **Remove location data from photos** (on by default) strips the GPS position, camera and date details, XMP/IPTC data and comments from JPEG and PNG photos as they are uploaded: the picture itself is copied unchanged and its orientation is kept, and the page tells you what was removed. Untick it to keep a file exactly as it is. Other file types are stored unchanged.

*Search* looks at title, tags, note, file name and the object's name; *Show* limits the list to photos or documents. Map notes pinned in the Property Editor are listed below the files.

Safety: files are accepted by extension **and** by content (a `.pdf` that is not a PDF is refused; HTML and executables are never accepted), are stored under generated names, and are served with `nosniff` and a sandbox policy. They are part of every **backup** and restore. Photos keep their own metadata (including GPS position, if the camera recorded it) — remove it before sharing a file or backup.

## 24. Weather

Weather is **off until you enable it** on the Weather page, because it sends the property's coordinates (rounded to 4 decimals) and your IP address to the free **Open-Meteo** service. You can switch it off again at any time.

Once on, you see current conditions, a modelled soil-surface temperature, a 48-hour chart (temperature and rain), a 7-day table and a short list of **facts derived from the forecast numbers**: frost is likely on a day with a forecast minimum of 0 °C or less (ground frost possible at 0–2 °C), rain total for the week, strong wind, hot days. *Add a reminder* turns a frost warning into a task.

Everything shows **when it was fetched**. The forecast is cached for 20 minutes. If the service cannot be reached EDEN shows the **last real forecast marked as old**, or an error if there is none — never an estimate. It is a model forecast for a grid cell, not a measurement at your garden: frost pockets and microclimates are not captured. Data: Open-Meteo.com, CC BY 4.0.

## 25. Reports

Open **Reports**, tick the sections you want (summary, inventory, beds and plantings with the companion check, orchard, ponds, tasks, documents, weather) and press **Print / save as PDF**: the menu is hidden in the printout. The weather section appears only when weather is on and loaded. The page also links the task CSV, the object CSV and the GeoJSON export. A report built from the demo estate says **DEMO DATA** at the top.

## 26. Buildings

*Buildings* lists every building and greenhouse: footprint area, floors and height, **floor area** (footprint × floors), roof, services (electricity, water, heating, internet), how many smart devices, lights, sensors or cameras are placed inside the outline and how many of them report live data, open tasks and attached files. *Show on map* selects the building; edit its details in the properties panel. The totals are planning figures from the drawn outlines.

## 27. Password, sign-in and sign-out

When EDEN is started with a password (`start.ps1 -Lan`, `-Password …`, or the `EDEN_PASSWORD` variable) the app shows a **sign-in screen**. Sessions last 30 days on that browser; *Sign out* is at the bottom of the menu. After five wrong passwords the address is locked out for five minutes. Changing the password signs everybody out. The password protects the app and everything it can control, but the connection is plain HTTP: use it on a trusted network or behind a VPN, and read [SECURITY.md](../SECURITY.md).

## 28. Keyboard, zoom and screen readers

Menus, forms, tables and dialogs can be used with the keyboard (a visible outline shows where you are); `Esc` leaves the current tool; the shortcuts are listed below. Drawing and editing shapes on the map needs a mouse or touch. You can zoom the whole page with the browser. Pages have headings and labelled regions, and the information on the map or in the sky chart is also available as text in the panels and tables. If you find something you cannot use, please report it.

## 29. Search everything (Ctrl+K)

Press **Ctrl+K** (or click *Search* at the top of the menu) from any page. One box searches pages, map objects, plants, trees, fish and mushrooms of the library, tasks, documents and photos, devices, automations, cameras and integrations. Every word you type has to match; capital letters and accents do not matter, so `ceapa` finds *Ceapă* and `rosie` finds *Roșie*. Results are grouped by kind with the best title matches first. Use **↑ ↓** and **Enter** (or click) to open one: an object is selected on the map, a plant opens the library filtered to it, a document opens the documents page filtered to it, other results open their page. **Esc** closes the search.

## 30. Secure connections (HTTPS)

`start.ps1 -Lan -Https` serves EDEN over an encrypted connection. The first time a device opens it the browser warns about an unknown certificate issuer, because the certificate is made by EDEN on your computer. Compare the fingerprint in the browser's certificate details with the one printed in the console, then continue; or import `data\tls\eden-cert.pem` into the device's trusted certificates to stop the warning. See [SECURITY.md](../SECURITY.md).

## Keyboard shortcuts

| Key | Action |
|---|---|
| **Ctrl+K** | Search everything |
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
