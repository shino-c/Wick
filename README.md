# Wick

Ambient stress detection and recovery for students. CodeNection hackathon.

This repo currently contains **Pillar 2 (Desk Mode)**, **Pillar 3 (Calibration & Ground Truth)**
and **Pillar 6 (Circles)** — Weiru's scope. Pillars 1, 4 and 5 (Passive Load Engine, the fused Total
Score, Recovery Engine) are Shino's; see [Handoff points](#handoff-points-for-shino) for where they plug in.

Stack: **React Native (Expo SDK 57) + expo-router + Supabase**, TypeScript.
Design: [Figma](https://www.figma.com/design/nf1GnV3taHAzKsXJrElETy/CodeNection)

---

## Quick start

```bash
npm install
npm start           # Expo Go / web — simulated biometrics
npm run start:dev   # dev client — real camera
```

**Wick runs with zero configuration.** With no `.env` and no native camera, it falls back to a local
on-device store and a synthetic pulse signal, and every screen still works end to end. A small dark
banner tells you when it is doing that, so nothing is ever mistaken for a live read.

To get the real thing, do the two sections below.

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query →** paste all of [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
   It is idempotent, so re-running after a change is safe.
3. **Authentication → Providers → Anonymous sign-ins → enable.**
   Wick has no sign-up screen: nothing in the product needs an email address, so first launch
   creates an anonymous auth user, which is all RLS needs to key on.
4. **Project Settings → API**, then:

```bash
cp .env.example .env
```

and fill in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Restart Metro with
`npm start -- --clear` — Expo inlines `EXPO_PUBLIC_*` at bundle time, so a running server won't
pick them up.

The anon key is meant to be public; every table is RLS-locked and the two functions that could leak
another person's data (`get_circle_summary`, `accept_friend_request`) check `auth.uid()` themselves.

### 2. Camera (a dev build — Expo Go can't do this)

The rPPG and finger-PPG pipelines use `react-native-vision-camera` frame outputs, which are native
code (VisionCamera 5 runs on Nitro modules). Expo Go cannot load them, so you need a **development
build** on a physical phone:

```bash
npm run prebuild
npm run build:android    # or: npm run build:ios   (macOS + Xcode)
```

Then `npm run start:dev` and open the app you just installed, not Expo Go.

Everything else — schema, services, all UI — is framework-agnostic and works without this.
Android is the easier target: you need a Mac and a paid Apple account to put a dev build on an iPhone.

Note that VisionCamera 5 ships **no Expo config plugin**, so the camera usage description and the
Android permission are declared directly in [`app.config.js`](app.config.js) rather than through
plugin props. Don't add `react-native-vision-camera` to the `plugins` array — prebuild will fail.

### Other commands

| Command | What it does |
| --- | --- |
| `npm run verify:ppg` | Checks the SciPy port against synthetic pulses of known BPM. **Run this before trusting the enforced-break lock.** |
| `npm run gen:sounds` | Regenerates the soundscape WAVs (already committed). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run start:dev` | Dev-client mode, for a build with the camera native modules. |
| `npm run web` | Runs in a browser. Camera paths simulate; everything else works. |

Set `EXPO_PUBLIC_WICK_FORCE_SIMULATION=1` in `.env` to force simulated biometrics even on a dev build —
useful for practising the demo.

---

## Routes

Navigation is expo-router; the file tree under `src/app/` *is* the route table. The four tabs in
`src/components/bottombar.tsx` match the Figma.

| Route | Screen | Owner |
| --- | --- | --- |
| `/` → `/baseline` | Onboarding | Shino |
| `/home` | Home dashboard | Shino |
| `/recovery` | Recovery engine | Shino — **not built yet, tab 404s** |
| `/desk` | Desk Mode | Pillar 2 |
| `/session`, `/summary` | Active session, post-session summary | Pillar 2 |
| `/social` | Circles | Pillar 6 |
| `/add-friend` | Invite-code friend flow | Pillar 6 |
| `/calibrate` | Calibration hub (reached from Desk) | Pillar 3 |
| `/questionnaire`, `/spot-check`, `/breathing` | Baseline, finger-PPG, breathing | Pillar 3 |
| `/onboarding` | My baseline screen — **duplicates `/baseline`** | see below |

Route files are one-liners that re-export from `src/features/**`, so screens stay plain components
and are testable without a router.

`/session` → `/summary` passes a `SessionSummary` object through
`src/features/desk/sessionHandoff.ts` rather than URL params: the summary contains an array of
readings, which would be lossy and fragile as a query string. The slot is consumed on read, so
refreshing `/summary` shows an empty state rather than a stale session.

---

## Demo script (about 3 minutes)

1. **Calibrate tab → Start Spot Check.** Finger on the rear camera + flash. Real heart rate and RMSSD
   come back in under a minute. Do this three times — the progress bar is explicit that stress
   detection unlocks at 3 scans, so the cold start is visible rather than mysterious.
2. **Answer "Did that feel accurate?"** Personal Accuracy starts moving.
3. **Desk tab → leave *Demo cadence* on → Start Focus Session.** The 3-second setup check runs, then
   the dark session screen. In demo cadence it samples every 20 s instead of every 3 min.
4. **Wait ~90 seconds.** The stress trend falls, the break time moves on its own, and after two
   consecutive high readings the timer **locks** and forces a minute of guided breathing. There is no
   skip button, and hardware back is disabled during it.
5. **End Session** → summary with the stress curve, the enforced-break marker, and the accuracy prompt.
6. **Circles tab** → with fewer than 3 friends the pulse is suppressed and says exactly why. Add
   friends by invite code to switch it on.

---

## What's actually implemented

### Pillar 2 — Desk Mode

| Spec | Status |
| --- | --- |
| Front camera with visible on-screen indicator | ✅ Indicator shows camera **on** only during a burst |
| Interval-sampled rPPG (12 s burst / 3 min) | ✅ `src/camera/config.ts`, camera fully off between bursts |
| Adaptive Pomodoro | ✅ Break slides ±2–5 min per reading, bounded 12–45 min |
| Threshold escalation → enforced pause | ✅ Two consecutive *good-quality* High Stress reads; guided breathing; no skip |
| White Noise & Soundscapes | ✅ Rain / Ocean / Forest / Fan / Silent, generated loops, volume slider |
| Post-session calibration prompt | ✅ Spot on / Slightly off / Way off → rolling Personal Accuracy |
| Frames processed on-device and discarded | ✅ Each frame becomes one number inside the frame-output worklet, then is disposed |
| 3-second setup check | ✅ Restarts on bad framing, so it's three *consecutive* clean seconds |
| Secondary CV cues | ⚠️ **Movement/fidget index only** (see below) |

**The one honest gap:** posture angle, face-touching and jaw tension need a real pose/landmark model.
Rather than fake them, Desk Mode ships a genuine *movement index* derived from the same ROI signal —
when your head shifts, the sampled patch slides off skin and the mean jumps far more than a heartbeat
ever does. That is the "fidgeting frequency" cue from the spec, computed honestly. Posture and jaw
tension are a stretch goal, not a claim.

### Pillar 3 — Calibration & Ground Truth

- 5-item perceived-stress questionnaire, two items reverse-scored, normalised to 0–100.
- Finger-PPG spot check (rear camera + flash, **red** channel) — the accuracy-critical reading.
- 1-tap quick stress flag feeding the same calibration loop.
- **Trend Velocity Alert with an actual definition** (see `src/services/trendService.ts`): the
  least-squares slope of `deviation_pct` over the last 4 scans, compared against the 80th percentile
  of *that user's own* historical slope distribution. Not a population norm; not a vibes label. Until
  there's enough history the card says so instead of inventing a threshold.
- 1-Minute Breathing at 5.5 breaths/min (4 s in, 2 s hold, 5 s out), longer exhale than inhale.
- Baseline cold-start is surfaced as `2/3 scans — one more to unlock stress detection`, not a
  generic "Recalibrate".

### Pillar 6 — Circles

- Invite-code friend flow (share sheet or typed code) → request → accept. No contact sync, ever.
- Friendship rows are written **only** by `accept_friend_request()`, a `SECURITY DEFINER` function.
  There is no insert policy on `friendships`, so a malicious client cannot forge a one-way link.
- Circle Pulse: counts and averages only.
- Shared challenges with join counts.
- Anonymous support nudges.

---

## The three design decisions that were open

**1. The "Sarah" card → anonymised.** The mockup's "Reach Out to a Friend" named a specific friend and
showed her status, which contradicts *"never raw individual scores"*. It is now
*"Someone in your circle is overloaded"*, and `sendCircleSupport()` deliberately takes **no recipient
parameter** — the server picks who is flagged and returns only a count. The sender is never told who
is struggling, and the recipient is never told Wick prompted the message. One principle, no carve-out
to explain on stage.

**2. "Differential privacy" → relabelled, with a real safeguard.** The UI never implemented DP
(calibrated noise + a privacy budget); it implemented aggregation. The copy now reads *"anonymised
signals only"*, and `get_circle_summary()` returns NULLs below **3 friends**. With two friends,
"1 of 2 in the red zone" plus one glance at who looks tired is a re-identification. The app explains
the suppression rather than silently showing an empty card.

**3. The domain-breakdown card on the Desk screen → dropped from this scope.** Academic/Social/
Physical/Mental split is Pillar 4's fusion output; Desk Mode's biometric signal has no visibility
into it. Desk Mode's Stress Trend card now shows what it actually measures: HRV deviation from
baseline. See the handoff below.

---

## Battery, privacy, and the person walking past behind you

These were explicit requirements, so here is exactly how each is handled.

### Battery

| Measure | Effect |
| --- | --- |
| 12 s burst every 180 s | ~7% duty cycle instead of a continuous 25-minute capture |
| `isActive={false}` between bursts | The camera hardware is genuinely off, not idling on a hidden preview |
| ROI + pixel stride 4 | ~16× fewer pixels read per frame than a full-frame mean |
| 640×480 @ 30 fps format request | Smallest workable format — least power and least heat |
| Frame → one float, on the camera thread | No bridge traffic per frame, no per-frame React render |
| `AppState` teardown | Camera stops the moment the app backgrounds |
| `useKeepAwake` scoped to the session screen only | The screen isn't held on outside a session |

### Privacy of the video itself

`src/camera/frameSampling.ts` is the only code in the app that touches pixels. It runs inside the
frame output worklet, reduces the frame to `{mean, brightness, variance}`, and disposes the frame
immediately. There is no capture API in use — the camera is configured with a frame output and
nothing else: no photo output, no video output, no recorder. No file is ever written, no buffer is
copied out, nothing is encoded. `ppg_scans` has no column for a waveform or an IBI list, so
even the derived signal has nowhere to be uploaded to. Microphone permission is blocked outright in
`app.config.js`, along with media-library permissions.

### Bystanders

Three layers, all structural rather than policy:

1. **No preview during a session.** `PREVIEW_HIDDEN` in `src/camera/config.ts`. Desk Mode never draws
   a camera feed — a live view of the room is the single most likely way somebody behind you ends up
   in a screenshot or seen over your shoulder. You get a status indicator instead: the same
   information, none of the exposure. The finger spot check is the exception, and there the lens is
   pressed against a fingertip.
2. **A small centred ROI.** Only a 36%×34% patch is ever read. The doorway behind you is never sampled,
   so a passer-by cannot influence the signal even in principle.
3. **A stability gate.** The setup check rejects a frame whose ROI mean swings wildly, which is what
   people moving through the frame looks like.

A face-detector plugin that hard-fails a burst when it sees more than one face is the obvious next
layer. It's deliberately not in the dependency list: ML Kit is a heavy, brittle dependency to add
under hackathon time pressure, and the three layers above cover the actual risk.

---

## Signal-processing notes

`src/services/dsp.ts` is a **from-scratch port of `scipy.signal.butter`, `filtfilt` and `find_peaks`**,
not a wrapper over `fili`. The original plan used `fili`, whose bandpass is parameterised by centre
frequency + bandwidth — only an approximation of `butter(4, [low, high], 'band')`. Since the enforced-
break lock fires off these numbers, an approximate filter was the wrong trade. `npm run verify:ppg`
checks the port against synthetic pulses from 55–120 BPM, clean and noisy, and asserts ±3 BPM:

```
  ok      55       55.1    0.1     27.0     28   30s clean
  ok      72       72.1    0.1     18.1     36   30s clean
  ok      95       95.4    0.4     18.4     48   30s clean
  ok     120      120.2    0.2     12.1     40   20s clean
  ok      72       72.1    0.1     37.5     36   30s {"noise":0.5}
  ok      72       72.4    0.4     30.7     15   12s clean   <- one rPPG burst
  ok   0.1 Hz drift attenuated to 0.0163
```

One documented deviation: SciPy's `filtfilt` seeds each pass with `lfilter_zi` initial conditions;
this port relies on the same odd padding alone to absorb the start-up transient. Interior samples —
the only ones peak detection cares about — are unaffected, and `verify:ppg` guards it.

**Channel choice is the only real difference between the two capture modes.** Finger-PPG under torch
light samples the **red** channel; face rPPG samples **green**, which is least sensitive to skin tone
and ambient colour temperature. Everything downstream is channel-agnostic and identical.

**Measured, not requested, frame rate.** Both capture paths divide sample count by actual elapsed
time. Trusting the requested 30 fps would silently scale every BPM by whatever the device delivered.

### Simulation is not a fake answer

`src/camera/simulator.ts` fakes the *input*, not the output: it generates a raw per-frame intensity
series with realistic pulse shape, respiratory drift and sensor noise, and that goes through the exact
same filter and peak detector. Every number on screen in simulation mode was genuinely computed.
The `ramp` arc walks HRV down across a session so the two-consecutive-reads escalation fires on real
logic at a predictable moment — which is what makes it demoable on stage.

---

## Handoff points for Shino

Three seams, all typed, none requiring changes to my code:

**1. Load score into the fusion.** `recomputeFusedScore(loadScore?: number)` in
`src/services/repository.ts` already accepts Pillar 1's weekly-capacity number (0–100). Pass it and
confidence rises to High; omit it and the app fuses two signals and says so. There is no placeholder
value faking a third signal.

**2. Biometric score out.** Desk Mode hands off the **continuous** `deviation_pct`, never a bucketed
label — `PPGService.biometricScore()` clamps it to 0–100. Reading it from the DB:

```sql
select deviation_pct from ppg_scans
where user_id = $1 and signal_quality = 'good'
order by created_at desc limit 1;
```

**3. Weights.** `BASE_WEIGHTS = { biometric: 0.4, selfReport: 0.3, load: 0.3 }` in
`src/services/fusionService.ts` is a starting guess and **still needs agreeing** — the fused Total
Score is formally Pillar 4's territory. Half-life for recency decay is 12 h.

Also note `fuseStressScore()` returns `spread` (std-dev between signals). A high spread is a
demoable insight in its own right — *"your body reads calm, but you're reporting high strain"* — and
`note` already phrases it. Worth surfacing on the dashboard.

**Still open with you:**

- Final fusion weights.
- Where the Academic/Social/Physical/Mental domain-breakdown card lives now that it's off the Desk
  screen — Home dashboard, presumably.

---

## Layout

```
src/
  app/             expo-router route table — thin re-exports of the screens below
  camera/          Capture policy, frame sampling, the two capture hooks, simulator
    config.ts        Burst cadence, ROI, escalation + Pomodoro constants — start here
    frameSampling.ts The ONLY code that touches pixels
    useDeskSession.ts   Pillar 2 engine: setup check, bursts, adaptive break, escalation
    useFingerScan.ts    Pillar 3 spot check
  services/
    dsp.ts           SciPy port (butter / filtfilt / find_peaks)
    ppgService.ts    FYP pipeline port: HR, RMSSD, stress classification, baseline
    fusionService.ts Triangulated score + confidence  <- Pillar 4 seam
    trendService.ts  "Rising faster than usual", defined precisely
    repository.ts    Supabase-or-local routing. Screens only ever call this.
  features/
    onboarding/  calibration/  desk/  circles/
  screens/         Shino's baseline + home
  components/bottombar.tsx, topbar.tsx   Shino's shared chrome
  data/            Types + the offline demo store
  components/      Themed primitives, charts, breathing pacer
  theme/           Colours, type scale, spacing — nothing hardcodes a hex
supabase/schema.sql
scripts/           verify-ppg, generate-sounds
```

## Known constraints

- **The phone must stay propped and awake** for a whole session — iOS suspends the camera on lock.
  Pitch it as "prop it like a desk companion"; don't design UX that assumes the phone can lock.
- **Face rPPG under desk lighting is a low-precision trend signal**, not a lab instrument. The
  accuracy-critical number is the finger spot check, which is why it's what the enforced-break
  baseline is built from and what a judge should be pointed at.
- Onboarding completion is stored per-device, so reinstalling replays it.
