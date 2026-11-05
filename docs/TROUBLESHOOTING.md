# Troubleshooting

## Installing and starting

| Symptom | Fix |
|---|---|
| *"Python 3.11 or newer was not found"* | Install Python from python.org with **Add python.exe to PATH**, then open a **new** window and run the installer again. (`py -3 --version` should print 3.11+.) |
| *"running scripts is disabled on this system"* | Use `Install-EDEN.cmd`, or the `powershell -ExecutionPolicy Bypass -File …` form shown in the install guide. |
| *pip install failed* during setup | The first install downloads Python packages: check your internet connection (and any proxy), then run the installer again. |
| *"Port 8787 is already in use"* | EDEN may already be running: open <http://127.0.0.1:8787>. Otherwise start with `-Port 8788`. |
| *"Cannot reach the EDEN server"* in the browser | The server window was closed. Start EDEN again from the Start Menu. |
| The console window shows an error on start | Run `scripts\start.ps1` from PowerShell and read the message. A missing component usually means setup did not finish: run it again (your data is not affected). |
| Setup says *"This folder does not contain the built web app"* | You ran it from a source checkout. Use the release zip, or run `scripts\install.ps1` (needs Node.js 20+). |
| The browser warns about the certificate with `-Https` | Expected: the certificate is self-signed. Compare its SHA-256 fingerprint with the one printed in the console, then continue; or import `data\tls\eden-cert.pem` into the device's trusted certificates. After you add a new network address EDEN issues a new certificate (new fingerprint). |
| Python is missing and winget did not install it | Install Python 3.11+ from python.org (tick *Add python.exe to PATH*), open a new window and run the installer again. |
| Forgot the admin password | On the EDEN computer run `scripts\reset-admin.ps1` (also in the program folder of the installer version). It asks for a new password (at least 10 characters), signs everybody out, and does not touch your data. |

| *Windows protected your PC* / *Unknown publisher* when running the installer | The installer is signed, but with a self-signed certificate, which Windows does not know. Compare the file's SHA-256 with `SHA256SUMS.txt` on the release page and the signer thumbprint with `docs/SIGNING.md`; then *More info → Run anyway*. See `docs/SIGNING.md` for how a trusted signature is obtained. |
| The installer says another copy is running | It stops EDEN's own server itself. If it still complains, close the EDEN console window and run it again. |

## Notifications, OCR, cameras and terrain

| Symptom | Fix |
|---|---|
| *Turn on notifications* is greyed out / says "only on https or localhost" | Open EDEN on this computer as `http://127.0.0.1:8787`, or start it with `-Https` and accept the certificate warning on the other device. |
| Notifications were allowed but nothing arrives | Press *Send a test notification* and read the answer. The EDEN computer must be on and online. Remove the device and turn notifications on again. A browser that is fully closed, or a phone in battery saver, may delay delivery. |
| Photos and scans are not searchable ("no OCR engine installed") | Install Tesseract: `winget install UB-Mannheim.TesseractOCR` (or tick it in the installer), then press *Read text of documents that were not read yet* on the Documents page. |
| OCR reads Romanian badly | Run `scripts\get-ocr-language.ps1 ron`, then set the languages to `eng + ron` in Settings. Scans in low resolution or handwriting stay unreliable. |
| ONVIF search finds nothing | Multicast may be blocked (guest Wi-Fi, VLAN, some routers) or the camera has ONVIF switched off. Type its address by hand (`http://<ip>/onvif/device_service`). |
| ONVIF says the user name or password was rejected | Use an **ONVIF user** created in the camera's own settings; some cameras do not accept their web login for ONVIF. |
| Terrain says the service could not be reached | The elevation service needs internet. EDEN keeps showing the last real answer with its date. |

## Install, offline, neighbours, pictures and the library

| Symptom | Fix |
|---|---|
| No *Install EDEN* button, or Settings says the offline copy could not be prepared | Installing needs `localhost` on this computer, or https **with a certificate the device trusts**: EDEN's own `-Https` certificate is self-signed, which browsers refuse for installing and offline use even after you accept the warning. Install `data\tls\eden-cert.pem` on the device as a trusted certificate, or put EDEN behind a real certificate (untested on a phone). Some browsers only offer the button after you have used the page for a while; the browser's own menu (*Install app*) works too. On iPhone use Safari → *Share* → *Add to Home Screen*. |
| EDEN does not open offline | Open it once with a connection after installing or updating, and look at the pages you need so they are saved. The card in Settings says whether the offline copy is ready. After signing out the saved data is wiped on purpose. |
| *Find neighbouring buildings* says OpenStreetMap could not be reached | The public Overpass servers are often busy; EDEN tries three. Wait a few minutes and try again, or set `EDEN_OVERPASS_URL` to your own server. Nothing is added on an error. |
| A neighbour's height looks wrong | OpenStreetMap heights are often missing. The list says which are *assumed*; select the building and correct *Height* and *Roof type*. |
| No picture for a plant | Pictures are off until you tick the box; only freely licensed Wikimedia Commons pictures are used, and some plants have none ("No freely licensed picture found"). *Wikipedia could not be reached* is temporary. |
| The library says a name is a synonym | GBIF uses another accepted name (for example pea is *Lathyrus oleraceus*); the library keeps the name gardeners know and shows both. |
| Beds show no slope note | Terrain must be on, *Tilt beds…* ticked, and the ground flat to under 0.5° gives no note. Ponds are never tilted. |

## Map and imagery

| Symptom | Fix |
|---|---|
| Grey tiles with "Map data not yet available" | Settings → lower the Esri deepest zoom (16 or 17), or add a MapTiler key. |
| Map is blank or dark | You are offline or the provider refused the request. Switch to *Blank grid* in the layer menu and use an imported image, or check your connection. |
| Place search says "Geocoder unavailable" | Enter coordinates as `lat, lng` instead. |
| Shadows or sun hours look wrong | Check the **time zone** on the Sun & Shadows page and that the heights of buildings, trees and fences are filled in. The model ignores terrain unless you turn it on, and neighbours' buildings (see the user guide). |

## Smart home, cameras, automations

| Symptom | Fix |
|---|---|
| Integration card says *problem: rejected the access token (401)* | Create a new long-lived access token in your Home Assistant profile and use *Change token*. |
| *Cannot reach Home Assistant* | Check the address (include `http://` and the port, usually 8123), that EDEN's computer can open it in a browser, and the firewall. |
| A device shows **no data** | The integration has not reported a value for it (yet). Press *Test & sync*; for MQTT, check the topic and that something publishes to it. |
| Devices show "integration offline: last known value" | The last refresh failed. Controls stay disabled until the integration is reachable again: this is deliberate. |
| MQTT card says paho-mqtt is not installed | Run the installer again (it installs it), or `backend\.venv\Scripts\pip install paho-mqtt`. |
| Camera says *ffmpeg not found* | RTSP cameras need ffmpeg on the EDEN computer (install it and make it available on PATH), or use the camera's snapshot URL, MJPEG stream or Home Assistant. |
| Camera says *rejected the user name/password (401)* | Re-enter the credentials (*Add camera* again; the old password is never shown). |
| An automation did not run | Open *Automations → Activity log*: every skipped trigger says why (cooldown, condition not met, offline, risky rule not acknowledged). State triggers fire only on a change EDEN observes, never from an unknown reading. |

## Weather and data

| Symptom | Fix |
|---|---|
| Weather page says it is switched off | Weather is opt-in (it sends the rounded coordinates to Open-Meteo). Enable it on the Weather page. |
| Weather shows "last real forecast … old" | The service could not be reached; EDEN keeps showing the last real answer with its time instead of guessing. |
| A photo still shows its location somewhere | Only JPEG and PNG are cleaned, and only when *Remove location data from photos* was ticked at upload. Upload the photo again with it ticked (delete the old copy), or remove the metadata with another tool. |
| An upload is refused | Only the listed file types are accepted, and the content must match the extension (a renamed file is rejected). Maximum 40 MB. |
| I want to move my data to another computer | Download a full backup (*Settings*), install EDEN there, and restore it in *Settings*. |
| I want to start over | Delete the properties from the Overview, or stop EDEN and delete the `data` folder (make a backup first). |

## Accessibility and display

EDEN is checked automatically for serious accessibility problems (names, labels, contrast, landmarks) on every page. You can zoom the page with the browser (Ctrl +/−). The map and the night-sky chart are graphical: the same information is available as text in the panels and tables.

## Reporting a problem

Note what you did, the message on the screen (a crashed page shows its message and a *Reload* button), and the browser console output (F12 → Console). Remove personal data from screenshots and backups before sharing them.
