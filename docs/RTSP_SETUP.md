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

In **Sources**, add the device's RTSP URL, for example:

- Camera: `rtsp://user:pass@192.168.1.80:554/stream1`
- HDMI encoder: `rtsp://192.168.1.81:554/hdmi`

Credentials in the URL are stored but never displayed in the panel.

**Compatibility mode:**

- **Direct (lightest)** — MediaMTX relays the source as-is. Best on a Raspberry Pi. The screen must be able
  to play the camera's codec (many cameras are H.265).
- **Most compatible (re-encode)** — we transcode the source to a fixed-size H.264 stream so it plays on more
  decoders, and so switching to/from a timetable doesn't change resolution. Uses more CPU — best on a mini-PC.

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
