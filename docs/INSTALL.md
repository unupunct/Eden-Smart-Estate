# Installation guide

EDEN runs as a small local web server (Python) that serves the web app (React). You open it in any browser. Everything stays on your computer.

## 1. Requirements

| | Needed for | Where to get it |
|---|---|---|
| Windows 11 (Windows 10 also works) | the provided installer and scripts | – |
| **Python 3.11 or newer** | running EDEN | <https://www.python.org/downloads/>: during setup tick **"Add python.exe to PATH"** |
| Node.js 20+ | *only* when building from source | <https://nodejs.org/> |
| Git | *only* when cloning | <https://git-scm.com/> |
| A modern browser (Edge, Chrome, Firefox) | using EDEN | – |
| Internet | the first install (Python packages), map imagery, place search, and the optional weather forecast | – |

Check Python: open PowerShell and run `py -3 --version` (or `python --version`). You should see 3.11 or higher.

## 2. Install (recommended: the installer)

1. Download `EdenSmartEstate-1.0.0.zip` from the project's **Releases** page.
2. Right-click → *Extract All…* (any temporary folder is fine, for example Downloads).
3. Double-click **`Install-EDEN.cmd`**.

It needs **no administrator rights**. It:

- copies the program to `%LOCALAPPDATA%\EDEN\app` and creates its private Python environment (internet needed this first time);
- keeps **your data in `%LOCALAPPDATA%\EDEN\data`**, separate from the program, so updates and re-installs never touch it;
- adds a Start Menu folder *EDEN Smart Estate* (start, data folder, uninstall) and an entry in Windows *Settings → Apps → Installed apps*;
- offers to start EDEN right away.

Options (run in PowerShell from the extracted folder):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -Autostart          # also start EDEN when you sign in
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -DesktopShortcut    # add a desktop icon
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -InstallDir D:\EDEN # another folder
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -Portable           # copy only: no shortcuts, no registry entries
```

> **Why `-ExecutionPolicy Bypass`?** Windows blocks unsigned scripts by default. This flag allows just that one run and changes no system setting. The scripts in `scripts\` are short: read them first if you like. `Install-EDEN.cmd` simply runs `scripts\setup.ps1` this way.

If you used EDEN straight from an unzipped folder before (data in its `data` folder), the installer copies that data into the new data folder once.

### Alternative: run from the folder, without installing

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1   # once: creates the Python environment (builds the web app too if you cloned the source)
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

From GitHub: `git clone https://github.com/unupunct/Eden-Smart-Estate.git`, then the same two commands (Node.js is needed for the build).

## 3. Start EDEN

From the Start Menu: **EDEN Smart Estate**. A small console window opens (minimised): it *is* the server, so leave it open while you use EDEN and close it to stop. The browser opens at **<http://127.0.0.1:8787>**.

Options for `start.ps1` / `EDEN.cmd`:

| Command | Effect |
|---|---|
| `-Port 9000` | use another port |
| `-NoBrowser` | do not open the browser |
| `-DataDir D:\EdenData` | keep your data in another folder (for example a synced or backed-up drive) |
| `-Password …` | protect the estate with a password, also on this computer only |
| `-Lan` | also reachable from phones/tablets/PCs on your network: **asks you for a password** (see section 6) |

## 4. First steps

1. Click **Explore the demo estate** to look around a fictional property, *or* **Create my property**.
2. For your own land: enter a village, address, or coordinates such as `46.0484, 24.0526`, choose the result, **Create and open editor**.
3. Zoom to your plot, pick **Property boundary** in the *Draw* tab and click the corners. Click the first point (or press Enter) to finish. The area appears instantly.
4. Continue with the [User guide](USER_GUIDE.md).

Delete the demo whenever you like: *Estate Overview → trash icon on the demo card*.

## 5. Where your data lives

With the installer: `%LOCALAPPDATA%\EDEN\data` (Start Menu → *EDEN data folder*). Running from a folder: the `data` folder inside it.

```
data/
  eden.db        your whole model: properties, objects, tasks, devices, automations, settings (SQLite)
  uploads/       imported images, photos and documents
  backups/       automatic safety copies made before a restore
```

Database changes are applied automatically at start-up by numbered migrations; your data is kept.

**Back up** from *Settings → Backup and restore → Download full backup* (one .zip with the database and every file), or copy the `data` folder while EDEN is stopped. **Restore** from the same screen; a safety copy of the current state is saved first.

> A backup contains everything, **including stored credentials** (Home Assistant token, MQTT and camera passwords, imagery keys). Keep backups private.

## 6. Use from a tablet or another computer (LAN)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Lan
```

EDEN asks you to choose a **password** (at least 8 characters) and prints addresses such as `http://192.168.1.20:8787`. Open one on the other device (same Wi-Fi/network) and sign in. Without `-Lan`, EDEN listens on this computer only.

- LAN mode lets other devices **operate your connected devices**, so a password is required. `-NoPassword` skips it: only for a network you fully trust.
- The password protects the app and its API (cookie sessions, lock-out after repeated wrong tries). It travels **unencrypted over your network (plain HTTP)**: use it at home, never on public Wi-Fi, and **never forward the port to the internet**. For remote access use a VPN.
- To set a password permanently without typing it each time, set the `EDEN_PASSWORD` environment variable before starting.
- Windows Firewall asks whether to allow Python on private networks: allow **private** only.
- See [SECURITY.md](../SECURITY.md) for the details and limits.

## 7. Start automatically at sign-in

Install with `-Autostart` (section 2), or re-run setup with it later: it only adds a Startup shortcut. To stop autostarting, run setup again without `-Autostart`.

## 8. Choose your imagery provider (optional)

Out of the box EDEN uses **Esri World Imagery** with attribution and needs no key. Under *Settings* you can:

- Add a **MapTiler** key (free tier at maptiler.com) for higher zoom levels and your own usage quota. The key is stored in the local database and used only by the server.
- Use any **custom XYZ tile server** (for example your own drone imagery host).
- Lower Esri's *deepest zoom level* if you see grey "Map data not yet available" tiles (coverage depth varies by region).

If no suitable imagery exists, import your own aerial photo or plan and calibrate it: see the user guide.

## 9. Update

**Installed version:** extract the new zip and double-click `Install-EDEN.cmd` again. It stops EDEN if it is running, replaces the program, keeps the Python environment and **all your data**, and runs database migrations at the next start.

**Run-from-folder / source:** `git pull` (or extract the new zip into a *new* folder), run `scripts\install.ps1`, and start with `-DataDir` pointing at your old data folder (or copy `data` across).

## 10. Uninstall

Start Menu → *EDEN Smart Estate → Uninstall EDEN* (or *Installed apps → EDEN Smart Estate → Uninstall*). It removes the program, shortcuts and registry entry, and asks whether to delete your data as well (default: **keep**; deleting needs you to type `DELETE`). Make a backup first if you are unsure. EDEN installs nothing system-wide and needs no administrator rights to remove.

## 11. Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for symptoms and fixes (Python not found, scripts blocked, port in use, grey map tiles, devices that do not connect, and more).

## 12. macOS / Linux (manual, untested by the author)

The Windows scripts are conveniences; EDEN itself is cross-platform Python + Node.

```bash
git clone https://github.com/unupunct/Eden-Smart-Estate.git && cd Eden-Smart-Estate
python3 -m venv backend/.venv && backend/.venv/bin/pip install -r backend/requirements.txt
(cd frontend && npm ci && npm run build)
cd backend && EDEN_PASSWORD='choose-a-password' .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8787
```

Then open <http://127.0.0.1:8787>. (Omit `EDEN_PASSWORD` to run without a login on this computer only.)
