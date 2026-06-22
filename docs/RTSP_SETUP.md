# Connecting screens & sources (RTSP)

## Point a TV's decoder at a screen

1. In **Settings**, set *this server's network address* to the LAN IP of the computer running OpenMasjidOS
   (e.g. `192.168.1.50`) and **Save**. (On most systems: `ip addr` / `hostname -I` on Linux.)
2. On the **Screens** page, add a screen and **Copy link**. It looks like:
   `rtsp://192.168.1.50:8554/tv_a1b2c3`
3. In your RTSP-to-HDMI decoder box (or a Raspberry Pi / VLC / mpv acting as one), paste that link and set
   the **transport to TCP**.
4. Choose what the screen shows from the Screens page.

> **Why TCP?** Commodity decoders are most reliable over RTSP/TCP, and it passes firewalls/NAT without extra
> ports. The server only publishes `8554/tcp`.

### Test a link from a computer

```bash
ffplay -rtsp_transport tcp rtsp://192.168.1.50:8554/tv_a1b2c3
# or
vlc --rtsp-tcp rtsp://192.168.1.50:8554/tv_a1b2c3
```

A Raspberry Pi makes a fine decoder in kiosk mode:

```bash
mpv --rtsp-transport=tcp --fs --no-osc rtsp://192.168.1.50:8554/tv_a1b2c3
```

## Add a camera or HDMI source

In **Sources**, add the device's RTSP or secure RTSPS URL, for example:

- Camera (RTSP): `rtsp://user:pass@192.168.1.80:554/stream1`
- Camera (secure RTSPS): `rtsps://192.168.1.1:7441/abcd1234?enableSrtp`
- HDMI encoder: `rtsp://192.168.1.81:554/hdmi`

Both `rtsp://` and the secure `rtsps://` are supported.

**UniFi cameras:** RTSP is off by default in UniFi Protect. Open the camera's
settings → **RTSP**, enable a stream, and paste the link it shows (UniFi gives a
secure `rtsps://…` link). If a secure link won't connect on **Direct** mode (some
UniFi consoles present a self-signed certificate), switch the source to **Most
compatible (re-encode)** — that path connects over TLS without certificate
verification and also handles UniFi's `?enableSrtp` (SRTP) streams.

Credentials in the URL are stored but never displayed in the panel.

**Compatibility mode:**

- **Direct (lightest)** — MediaMTX relays the source as-is. Best on a Raspberry Pi. The screen must be able
  to play the camera's codec (many cameras are H.265).
- **Most compatible (re-encode)** — we transcode the source to a fixed-size H.264 stream so it plays on more
  decoders, and so switching to/from a timetable doesn't change resolution. Uses more CPU — best on a mini-PC.

## Off-site screens (over SD-WAN / VPN / the internet)

A screen at another building reaches this server over your SD-WAN or VPN, so the
**RTSP link stays the same** — `rtsp://<server>:8554/tv_xxxx` — as long as that
address is routable from the remote site (point the decoder at the server's SD-WAN
address, or the LAN IP if the tunnel bridges subnets). RTSP is forced to **TCP**,
which is what you want across a WAN (firewall/NAT-friendly and reliable); latency of
~100 ms only adds a small start-up delay, and a little jitter is fine.

The thing that matters on a slow remote link is **bitrate**. A normal timetable
stream is ~1.8 Mbps (720p) / 3.5 Mbps (1080p) — too much for, say, a 1.5 Mbps
remote line. So for any timetable shown on an off-site screen, turn on
**Low bandwidth (off-site screen)** in the timetable editor. Because a timetable is
nearly a still image, the saver stream peaks around **0.45 Mbps at 720p**
(≈0.9 Mbps at 1080p) and in practice averages far less — it fits comfortably on a
slow link with no visible quality loss. (If a timetable is shown both on-site and
off-site, the on-site copies use the same lighter stream; on a LAN that's invisible.)

Notes:
- Give the remote decoder a small **network/jitter buffer** (most have a "buffer" or
  "latency" setting — 500–1000 ms) so brief WAN hiccups don't stutter.
- **Cameras** are full-motion video and stay bandwidth-heavy — sending a camera to a
  far site over ~1–2 Mbps usually isn't practical. Off-site screens are best used for
  **timetables** (and announcements/ticker), which are light. If you must, use
  **Most compatible (re-encode)** at **720p** and expect it to use most of the link.
- If the remote link is very slow, prefer **720p** over 1080p for the off-site
  timetable — half the pixels, roughly half the bits.

## Troubleshooting

| Symptom | Try |
|---|---|
| **Black screen / no video** | Set the decoder transport to **TCP**. Confirm the server address in Settings is reachable from the TV's network. |
| **Camera shows on a computer but not on the cheap box** | Switch that source to **Most compatible (re-encode)**. |
| **Brief freeze when switching** | Expected — the decoder re-reads the new stream. It recovers within a second or two. |
| **Stream never starts** | Check the camera URL/credentials. Avoid `@ : / %` in passwords, or URL-encode them. |
| **Wrong RTSP port** | If `8554` was already in use, OpenMasjidOS may have remapped it — update the port in Settings to match the published host port. |
| **No "Copy link" on a screen** | Set the server's network address in Settings first. |

## Networking notes

- Cameras, the server, and the TV decoders should be on the same LAN (or routable to each other).
- Sources are pulled **on demand** — a camera is only contacted while a screen is actually showing it.
- Audio is stripped from relayed video to avoid confusing decoders.
