# Installation guide

EDEN runs as a small local web server (Python) that serves the web app (React). You open it in any browser. Everything stays on your computer.

## 1. Requirements

| | Needed for | Where to get it |
|---|---|---|
| Windows 11 (Windows 10 also works) | the provided installer and scripts | – |
| Python 3.11 or newer | only for the zip / script install (the `.exe` installer brings its own Python) | <https://www.python.org/downloads/>: during setup tick **"Add python.exe to PATH"** |
| Node.js 20+ | *only* when building from source | <https://nodejs.org/> |
| Git | *only* when cloning | <https://git-scm.com/> |
| A modern browser (Edge, Chrome, Firefox) | using EDEN | – |
| Internet | the first install (Python packages), map imagery, place search, and the optional weather forecast | – |

Check Python: open PowerShell and run `py -3 --version` (or `python --version`). You should see 3.11 or higher.

## 2. Install

### Option A (recommended): the installer, `EdenSmartEstate-Setup-1.3.0.exe`

1. Download `EdenSmartEstate-Setup-1.3.0.exe` and `SHA256SUMS.txt` from the project's **Releases** page, and compare the checksum (`Get-FileHash .\EdenSmartEstate-Setup-1.3.0.exe -Algorithm SHA256`).
2. Double-click it. It is signed, but with a **self-signed certificate**, so Windows says *Unknown publisher* / SmartScreen may say *Windows protected your PC*. Read [SIGNING.md](SIGNING.md) (what the signature does prove, the signer's fingerprint, and how a trusted one is obtained), then choose *More info → Run anyway* if you are satisfied.
3. Follow the wizard. It needs **no administrator rights** and **no Python**: it brings its own (the official embeddable Python, checked before it was bundled).

Optional wizard tasks: a desktop shortcut, *start EDEN when I sign in*, and the **OCR engine** (Tesseract, about 50 MB through winget; Windows asks permission) that lets EDEN read text in photos and scans.

Where things go: the program in `%LOCALAPPDATA%\EDEN\app`, **your data in `%LOCALAPPDATA%\EDEN\data`** (never touched by updates), Start Menu entries (EDEN Smart Estate, EDEN data folder, user guide) and an entry in *Settings → Apps → Installed apps*. You can choose another folder.

**Updating:** run the newer installer; it stops a running EDEN, replaces the program and keeps your data. It also takes over an installation made with the older zip route (same folder, same data).

**Uninstalling:** *Installed apps → EDEN Smart Estate → Uninstall*. It asks whether to also delete your data (default: keep). Silent forms: `unins000.exe /VERYSILENT` keeps the data, `unins000.exe /VERYSILENT /REMOVEDATA=1` removes it.

Silent install for scripts: `EdenSmartEstate-Setup-1.3.0.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR="D:\EDEN" /TASKS="autostart"`.

### Option B: zip + `Install-EDEN.cmd` (uses your own Python)

1. Download `EdenSmartEstate-1.3.0.zip` from the project's **Releases** page.
2. Right-click → *Extract All…* (any temporary folder is fine, for example Downloads).
3. Double-click **`Install-EDEN.cmd`**.

It needs **no administrator rights**. If Python is missing and Windows Package Manager (winget) is available, it offers to install Python 3.12 for you first. It:

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
| `-Https` | serve over HTTPS with a self-signed certificate (section 6) |

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

**Encrypt it with `-Https` (recommended on any shared network):**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Lan -Https
```

EDEN creates a self-signed certificate on your computer (in `data\tls`, valid for a year, renewed automatically, covering `localhost`, the computer's name and its network addresses) and prints its **fingerprint**. The first time a device opens `https://…` the browser warns that the certificate is not from a known authority: compare the fingerprint shown in the browser's certificate details with the one in the console, then continue. To avoid the warning, import `data\tls\eden-cert.pem` into the device's trusted certificates.

- LAN mode lets other devices **operate your connected devices**, so a password is required. `-NoPassword` skips it: only for a network you fully trust.
- The password protects the app and its API (cookie sessions, lock-out after repeated wrong tries). Without `-Https` it travels **unencrypted over your network (plain HTTP)**: add `-Https`, or use it at home only, never on public Wi-Fi. **Never forward the port to the internet**; for remote access use a VPN.
- To set a password permanently without typing it each time, set the `EDEN_PASSWORD` environment variable before starting.
- Windows Firewall asks whether to allow Python on private networks: allow **private** only.
- See [SECURITY.md](../SECURITY.md) for the details and limits.

### Install on a phone or tablet as an app

Browsers do not allow installing or offline use over plain `http` on the network, and over `https` they require a certificate the device **trusts** (clicking through the warning is not enough). Browsers refuse to install an app or keep an offline copy over a certificate they do not trust, even after you click through the warning. EDEN's own certificate (`data\tls\eden-cert.pem`) is self-signed, so on a phone or tablet either install it on the device as a trusted certificate first, or put EDEN behind something with a real certificate (a reverse proxy, or a private network service that provides one). On the same computer, `http://localhost:8787` needs nothing. Not tested on a real phone. Then open EDEN on the device and use *Settings → Install as an app and use offline* (Android: menu → *Install app*; iPhone: Safari → *Share* → *Add to Home Screen*).

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
