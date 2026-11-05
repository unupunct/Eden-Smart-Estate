# Security notes

EDEN is a **self-hosted, single-user** application. It is designed to run on your own computer, and it can control real devices (through Home Assistant or MQTT) and show camera pictures, so please read this.

## Defaults

- EDEN listens on **127.0.0.1** only: nothing else on your network can reach it.
- There is **no login** in that mode, because only programs on your computer can connect.
- All data stays in the data folder on your computer. The only outgoing requests are the ones you configure: map tiles (your browser asks the imagery provider), place search (only when you press Enter), the optional weather forecast (off until you enable it), and your own Home Assistant / MQTT broker / cameras.

## Network use (`-Lan`)

- `scripts\start.ps1 -Lan` makes EDEN reachable from your network and **requires a password** (`-NoPassword` overrides this: only for a network you fully trust).
- With a password every `/api` request needs a signed session cookie (HttpOnly, SameSite=Strict). Tokens are HMAC-signed with a key derived from the password, so changing the password signs everyone out. Five wrong passwords lock an address out for five minutes. Cross-site writes (a foreign `Origin`) are refused.
- **Encryption is optional: add `-Https`.** EDEN then serves TLS with a self-signed certificate created on your computer (`data\tls`, EC P-256, one year, renewed automatically, subject alternative names for localhost, the computer name and its LAN addresses) and the session cookie is marked `Secure`. Browsers warn once about the unknown issuer: compare the SHA-256 fingerprint printed at start-up. Without `-Https` the password and your data travel as plain HTTP and can be read by others on the network. Either way **never expose the port to the internet** and never port-forward it; for remote access use a VPN (for example WireGuard or Tailscale).
- Anyone who is signed in can do everything, including commanding devices marked *risky*: the confirmation is a precaution against mistakes, not a permission system. There are no separate users or roles.

## Credentials

- Home Assistant tokens, MQTT and camera passwords, imagery keys are stored in the local database (`secrets` table) and used **only by the server**. The API never returns them, they are never written to logs, and camera credentials typed into an address are moved out of it.
- They are not encrypted at rest. A **backup file contains them**; so does the data folder. Keep both private, and use a Home Assistant token with only the access you need (you can revoke it any time in Home Assistant).
- Uploaded JPEG and PNG photos are stripped of GPS position, camera and date details, XMP/IPTC data and comments by default (the image data is copied byte for byte; the orientation tag is kept). You can switch this off per upload. Other file types (WebP, GIF, PDF, Office files) are stored unchanged and may carry their own metadata.

## Uploads

Documents and photos are accepted by extension **and** content (magic bytes), limited to 40 MB, stored under generated names inside the data folder (no path from the file name), and served with `X-Content-Type-Options: nosniff` and a sandboxing Content-Security-Policy. HTML and executables are never accepted. Spreadsheet exports neutralise formula injection.

## Devices and automations

- Commands are limited to an allow-list per device type (on/off, lock/unlock, open/close). Risky devices need confirmation, and the state shown afterwards is read back from the integration.
- Automations are a convenience, **not a safety system**: they run only while EDEN runs, never act on unknown or offline states, and rules on risky devices need an explicit acknowledgement. Do not rely on them for anything where a failure could cause damage or harm.
- Camera pictures are fetched by the server; EDEN does not record video or expose cameras outside your network.

## Known limits

- Single user; no per-user accounts, two-factor login or audit trail beyond the automation log.
- The built-in certificate is self-signed (no certificate authority), so every new device must be told to trust it. For a properly trusted certificate put a reverse proxy in front. Do not use EDEN beyond a trusted LAN.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository, or contact the maintainer through GitHub, rather than posting details publicly. Include the version (`/api/health`) and steps to reproduce.
