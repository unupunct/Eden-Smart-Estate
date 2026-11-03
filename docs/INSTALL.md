# Installation guide

EDEN runs as a small local web server (Python) that serves the web app (React). You open it in any browser. Everything stays on your computer.

## 1. Requirements

| | Needed for | Where to get it |
|---|---|---|
| Windows 11 (Windows 10 also works) | the provided scripts | – |
| **Python 3.11 or newer** | running EDEN | <https://www.python.org/downloads/> — during setup tick **"Add python.exe to PATH"** |
| Node.js 20+ | *only* when building from source | <https://nodejs.org/> |
| Git | *only* when cloning | <https://git-scm.com/> |
| A modern browser (Edge, Chrome, Firefox) | using EDEN | – |
| Internet | map imagery and place search (editing stored data works offline) | – |

Check Python: open PowerShell and run `py -3 --version` (or `python --version`). You should see 3.11 or higher.

## 2. Install

### Option A — from GitHub (source)

```powershell
git clone https://github.com/unupunct/Eden-Smart-Estate.git
cd Eden-Smart-Estate
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

`install.ps1` creates a private Python environment in `backend\.venv`, installs the backend dependencies, and builds the web app (needs Node.js; takes about a minute).

### Option B — release zip (no Node.js needed)

1. Download `EdenSmartEstate-0.2.0.zip` from the project's **Releases** page.
2. Right-click → *Extract All…* into a folder you will keep, for example `C:\Eden`.
3. Open PowerShell in that folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

The zip already contains the built web app, so only Python is required.

> **Why `-ExecutionPolicy Bypass`?** Windows blocks unsigned scripts by default. This flag allows just that one run; it changes no system setting. You can read the scripts in `scripts\` first — they are short.

## 3. Start EDEN

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

Your browser opens at **<http://127.0.0.1:8787>**. Leave the PowerShell window open while you use EDEN; press **Ctrl+C** in it to stop.

Options:

| Command | Effect |
|---|---|
| `scripts\start.ps1 -Port 9000` | use another port |
| `scripts\start.ps1 -NoBrowser` | do not open the browser |
| `scripts\start.ps1 -DataDir D:\EdenData` | keep your data in another folder (for example a synced or backed-up drive) |
| `scripts\start.ps1 -Lan` | also reachable from phones/tablets/PCs on your network (see below) |

## 4. First steps

1. Click **Explore the demo estate** to look around a fictional property, *or* **Create my property**.
2. For your own land: enter a village, address, or coordinates such as `46.0484, 24.0526`, choose the result, **Create and open editor**.
3. Zoom to your plot, pick **Property boundary** in the *Draw* tab and click the corners. Click the first point (or press Enter) to finish. The area appears instantly.
4. Continue with the [User guide](USER_GUIDE.md).

Delete the demo whenever you like: *Estate Overview → trash icon on the demo card*.

## 5. Where your data lives

By default in the `data` folder inside the EDEN folder:

```
data/
  eden.db        your whole model (SQLite)
  uploads/       images you imported
  backups/       automatic safety copies made before a restore
```

Updating EDEN never touches `data/`. Database changes are applied automatically at start-up by numbered migrations, and your existing data is kept.

**Back up** from *Settings → Backup and restore → Download full backup* (one .zip with the database and every image), or simply copy the `data` folder while EDEN is stopped. **Restore** from the same screen; a safety copy of the current state is saved first.

## 6. Use from a tablet or another computer (LAN)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Lan
```

The script prints addresses such as `http://192.168.1.20:8787`; open one on the other device (same Wi-Fi/network).

- **EDEN has no login yet.** In LAN mode anyone on your network can view *and change* your estate. Use only at home on a trusted network, never on public Wi-Fi, and never forward the port to the internet.
- Windows Firewall asks whether to allow Python on private networks — allow **private** only.
- Stop LAN mode by closing the window and starting normally without `-Lan`.

## 7. Start automatically at sign-in (optional)

Create a scheduled task that runs EDEN hidden when you log in (adjust the path):

```powershell
$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Eden\scripts\start.ps1" -NoBrowser'
$t = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName 'EDEN Smart Estate' -Action $a -Trigger $t -Description 'Starts the EDEN server'
```

Then open <http://127.0.0.1:8787> any time. Remove it with `Unregister-ScheduledTask -TaskName 'EDEN Smart Estate' -Confirm:$false`.

## 8. Choose your imagery provider (optional)

Out of the box EDEN uses **Esri World Imagery** with attribution and needs no key. Under *Settings* you can:

- Add a **MapTiler** key (free tier at maptiler.com) for higher zoom levels and your own usage quota. The key is stored in the local database and used only by the server.
- Use any **custom XYZ tile server** (for example your own drone imagery host).
- Lower Esri's *deepest zoom level* if you see grey “Map data not yet available” tiles (coverage depth varies by region).

If no suitable imagery exists, import your own aerial photo or plan and calibrate it — see the user guide.

## 9. Update

Source install:

```powershell
git pull
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

Release zip: extract the new version into a *new* folder, run `install.ps1`, then copy your old `data` folder into the new one (or start with `-DataDir` pointing at it). Your data is migrated automatically on first start.

## 10. Uninstall

Close EDEN, make a backup if you want to keep your work, then delete the EDEN folder (and the scheduled task if you created one). EDEN installs nothing system-wide.

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| *"Python 3.11 or newer was not found"* | Install Python from python.org with *Add to PATH*, then open a **new** PowerShell window. |
| *"running scripts is disabled on this system"* | Use the `powershell -ExecutionPolicy Bypass -File …` form shown above. |
| *"Cannot reach the EDEN server"* in the browser | The server window was closed. Run `scripts\start.ps1` again. |
| Port already in use | `scripts\start.ps1 -Port 8788` |
| Grey tiles with "Map data not yet available" | Settings → lower the Esri deepest zoom (e.g. 16 or 17), or add a MapTiler key. |
| Map is blank / dark | You are offline or the provider blocked the request. Switch to *Blank grid* in the layer menu and use an imported image, or check your connection. |
| Place search says "Geocoder unavailable" | Enter coordinates as `lat, lng` instead. |
| `npm ci` fails | Use Node.js 20 or newer. |
| Want to see errors | Start with `scripts\start.ps1` and read the PowerShell window; the browser console (F12) shows front-end errors. |

## 12. macOS / Linux (manual, untested by the author)

The Windows scripts are conveniences; EDEN itself is cross-platform Python + Node.

```bash
git clone https://github.com/unupunct/Eden-Smart-Estate.git && cd Eden-Smart-Estate
python3 -m venv backend/.venv && backend/.venv/bin/pip install -r backend/requirements.txt
(cd frontend && npm ci && npm run build)
cd backend && .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8787
```

Then open <http://127.0.0.1:8787>.
