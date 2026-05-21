---
Last updated: 2026-05-20
Last change: Initial draft — remote-printer testing setup via Tailscale for the v0 CLI agent
Owner: @phildaponte
Status: current
---

# Testing v0 with Tailscale (remote printer)

> Step-by-step guide for testing the v0 CLI agent against a BOCA Lemur printer that is **not on your local network**. Required when the developer (you) and the printer (at the client's venue) are on different LANs.

This is the recommended dev loop for the v0 phase. It is **not** how production v1 will work — production uses a locally-installed Tauri agent on the box-office laptop. This guide is purely for the developer-iteration phase.

## The problem this solves

- The BOCA Lemur has a private LAN IP (e.g. `192.168.1.47`) that is only reachable from devices on the same Wi-Fi as the printer.
- You are not on that Wi-Fi. You are across the country.
- Without a tunnel, `npm run smoke` from your Mac times out — the IP simply doesn't route over the public internet.

[Tailscale](https://tailscale.com) creates a **virtual private network** between your devices using WireGuard. Once both your Mac and a machine at the client's venue are on the same Tailscale network ("tailnet"), they can talk to each other as if they were on the same LAN — and your Mac can reach the printer's IP.

## Topology

```
       Your house                                  Client's venue
   ┌─────────────────┐                       ┌────────────────────────┐
   │  Your Mac       │  Tailscale (WireGuard)│  Client's Mac          │
   │                 │ ◀──────────────────▶ │  (any always-on device)│
   │  Tailscale: on  │   end-to-end encrypted│  Tailscale: on         │
   └────────┬────────┘                       └─────────────┬──────────┘
            │                                              │
            │ (logical: same network)                      │ same LAN
            └──────────────────────────────────────────────┤
                                                           │
                                                           ▼
                                                  ┌─────────────────┐
                                                  │  BOCA Lemur-S   │
                                                  │ 192.168.1.47    │
                                                  └─────────────────┘
```

## Prerequisites

- A free Tailscale account (sign up with Google/GitHub at <https://login.tailscale.com>).
- macOS 11+ or Windows 10+ on **both** ends.
- One device at the client's venue that:
  - Is **on the same Wi-Fi as the printer**.
  - Stays **powered on** while you're testing (sleep is fine — it'll wake).
  - Has a user willing to install one app and click "OK" a few times.

Their Mac/laptop is ideal. A `$35` Raspberry Pi works too if you want a permanent always-on bridge later.

## Step-by-step setup

### Step 1 — Install Tailscale on your Mac

1. Go to <https://tailscale.com/download/mac> → Download.
2. Open the `.pkg`, follow the installer.
3. Click the Tailscale icon in the menu bar → **Log in**.
4. Sign in with Google or GitHub.
5. You should now see your Mac listed in the Tailscale admin console at <https://login.tailscale.com/admin/machines>.

Note your Mac's Tailscale IP — something like `100.x.x.x`. You don't need it for this guide but it's good to know it exists.

### Step 2 — Get your client to install Tailscale

The lowest-friction option: **share your tailnet with them via user-invite.**

1. In the Tailscale admin console go to **Users → Invite users**.
2. Enter the client's email. Send the invite.
3. They receive an email like "Phil invited you to join their Tailscale network."
4. They click → sign up with Google/GitHub (the email you used or any) → install Tailscale on their Mac (same `.pkg` download).
5. Once they're logged in, **their Mac appears in your admin console** under the same tailnet.

Total time on their end: ~5 minutes. Zero terminal commands.

### Step 3 — Find the client's machine + printer on the tailnet

In the Tailscale admin console you should now see two machines:

- `phil-mbp` (you)
- `client-mbp` (them) → has a Tailscale IP like `100.95.12.34`

**The printer is NOT on the tailnet** (it's just a printer, can't run Tailscale). That's fine — we use **subnet routing** to make the client's Mac forward traffic to the printer's LAN IP for us.

### Step 4 — Enable subnet routing on the client's Mac

This is the one slightly-technical step. It tells Tailscale "when Phil tries to reach `192.168.1.0/24`, route it through the client's Mac."

On the **client's** Mac, in Terminal (you can paste this for them):

```bash
sudo tailscale up --advertise-routes=192.168.1.0/24
```

Adjust `192.168.1.0/24` to match the client's actual subnet (it's almost always `192.168.1.0/24` or `192.168.0.0/24` — they can check by running `ipconfig getifaddr en0` and using the first three octets).

Then in **your** Tailscale admin console:

1. Go to **Machines → client-mbp → Edit route settings**.
2. Toggle on the advertised route `192.168.1.0/24`.
3. Save.

That's it. Now any time your Mac tries to reach `192.168.1.x`, Tailscale silently routes it through the client's Mac onto their LAN.

### Step 5 — Get the printer's IP from your client

Tell your client to do this once:

> Hold the **TEST** button on the side of the BOCA Lemur for ~3 seconds, then release. A test/self-test ticket will print. It shows the printer's IP address (something like `192.168.1.47`). Send me that IP.

If the printer hasn't been on the LAN before, the test ticket may show "No IP" — in that case it needs to be plugged into the venue's router via Ethernet and given a moment to grab a DHCP lease.

### Step 6 — Verify connectivity from your Mac

From your Mac terminal:

```bash
# Should respond (printer pings respond on port 9100 only — use nc to test)
nc -zv 192.168.1.47 9100
```

Expected output:

```
Connection to 192.168.1.47 port 9100 [tcp/*] succeeded!
```

If you get **succeeded**: you're golden. Tailscale is forwarding correctly.

If you get **timed out**:
- Confirm the client's Mac shows the subnet route as "approved" in your admin console.
- Confirm Tailscale is running on both machines (menu-bar icon should be a solid arrow, not greyed out).
- Confirm the IP is actually correct (have client reprint the self-test).

### Step 7 — Configure your `.env`

In `/Users/philippe_master/seatfun-print-agent/.env`:

```bash
SEATFUN_AGENT_HOST=127.0.0.1
SEATFUN_AGENT_PORT=9787
SEATFUN_AGENT_TOKEN=any-long-random-string-for-dev
PRINTER_IP=192.168.1.47        # ← the client's printer IP
PRINTER_PORT=9100
LOG_LEVEL=info
```

### Step 8 — Print your first remote ticket

```bash
cd /Users/philippe_master/seatfun-print-agent
npm install        # only needed once
npm test           # confirm FGL renderer is correct (no network needed)
npm run smoke      # prints a real ticket at the client's venue
```

Expected output:

```
Rendered 478 bytes of FGL. Connecting to 192.168.1.47:9100...
✓ Printed. Check the printer.
```

**Call/text your client to confirm the ticket actually came out** of their printer. First time, you want eyes on the hardware.

### Step 9 — Iterate

Now the magic part. Edit `src/fgl/template.ts` — change a font size, move a field, whatever. Save. Then:

```bash
npm run smoke
```

A new ticket prints at the client's venue in ~2 seconds. You can adjust the layout from your couch.

Run a full HTTP test (closer to what the dashboard will do):

```bash
npm run dev                                                    # in terminal A
# In terminal B:
curl -X POST http://127.0.0.1:9787/v1/print \
  -H "Authorization: Bearer $(grep SEATFUN_AGENT_TOKEN .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d @fixtures/sample-job.json
```

Ticket prints, agent logs the job, results JSON returns.

## What to validate on the first real print

Don't just check "did paper come out." Check:

- [ ] **Layout matches the PRD §5 mock.** Event name top, QR centered, footer at the bottom.
- [ ] **QR scans.** Open the Seatfun check-in scanner (or any QR app on phone) and confirm it reads the `qr_payload`.
- [ ] **QR is the right size.** Too small → scanner struggles. Too big → other content gets squeezed. We use `<QR8>` in v0 — adjust if needed.
- [ ] **Tear line is in the right place.** The Lemur-S tears at a fixed position; verify the bottom of the ticket is clean.
- [ ] **Text isn't cropped at edges.** 2" stock = ~400 dots wide. Anything past column ~390 gets clipped.
- [ ] **Accented characters render correctly.** "Montréal" should show the é, not garbage. If garbage → we need an FGL `<U>` Unicode command or a different font.
- [ ] **No ghost characters from FGL injection.** If you see literal `<RC10,20>` text on the ticket, something's wrong with the renderer's escaping.

Snap photos of the first few prints and we'll iterate from those.

## Troubleshooting

**Tailscale shows both machines but `nc` times out.**
- Did you both **enable** the advertised route in the admin console (Step 4)?
- On the client's Mac: `sudo tailscale status` should show "Routes: 192.168.1.0/24 (advertised)".
- Firewall on the client's Mac might be blocking IP forwarding. Run `sudo sysctl -w net.inet.ip.forwarding=1` on their Mac (Tailscale should set this automatically but it's worth verifying).

**Printer connects but nothing prints.**
- Verify with `printf '<RC10,20><F3>HELLO<p>' | nc 192.168.1.47 9100` — a bare-minimum FGL stream. If that prints, our renderer is at fault. If not, the FGL syntax doesn't match the firmware.

**Printer prints garbage / random characters.**
- Usually means the printer is in a mode other than FGL (BOCA has multiple emulations). Have client check the self-test ticket — it should say "FGL46" near the top. If it says something else, they need to switch the printer to FGL via the front-panel buttons (BOCA's "Lemur Configuration Manager" or holding TEST + CHOICE).

**"timed out after 5000ms" error.**
- Printer is off, sleeping, or the IP changed (DHCP lease expired). Have client print a fresh self-test to confirm the IP.

## When to retire Tailscale

You don't have to. Tailscale is genuinely useful in production too — for emergency remote support of a paired box-office Mac that's having issues. But once **v1 (Tauri agent + dashboard pairing)** is live, you stop needing Tailscale for *iteration* because the production flow is:

```
Dashboard → localhost agent on client's Mac → printer
```

No tunnel needed for the production flow. Tailscale becomes a "break glass in case of emergency" tool.

## Cost summary

- Tailscale: **$0** (free tier covers up to 100 devices, more than enough).
- Time: **~30 minutes one-time setup**, ~5 of which is your client's effort.
- Recurring effort: **0**. Once it's set up, it just works.

## Related

- [`./protocol.md`](./protocol.md) — what the agent expects over HTTP.
- [`./architecture.md`](./architecture.md) — how the agent talks to the printer.
- [`./distribution.md`](./distribution.md) — how v1 production distribution works (no Tailscale needed).
- Tailscale subnet router docs: <https://tailscale.com/kb/1019/subnets/>.
- BOCA FGL46 reference: <https://www.bocasystems.com/documents/fgl46_rev16_7.pdf>.
