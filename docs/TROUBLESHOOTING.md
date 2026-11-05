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
| Forgot the password | Stop EDEN and start it without `-Password`/`EDEN_PASSWORD` (this computer only), or with a new password: the password is never stored in the data. Your data is not affected. |

## Map and imagery

| Symptom | Fix |
|---|---|
| Grey tiles with "Map data not yet available" | Settings → lower the Esri deepest zoom (16 or 17), or add a MapTiler key. |
| Map is blank or dark | You are offline or the provider refused the request. Switch to *Blank grid* in the layer menu and use an imported image, or check your connection. |
| Place search says "Geocoder unavailable" | Enter coordinates as `lat, lng` instead. |
| Shadows or sun hours look wrong | Check the **time zone** on the Sun & Shadows page and that the heights of buildings, trees and fences are filled in. The model ignores terrain and neighbours' buildings (see the user guide). |

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
