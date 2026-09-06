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
| `/` → `/baseline` | Onboarding — Shino's UI, wired to Pillar 3 | shared |
| `/home` | Home dashboard | Shino |
| `/recovery` | Recovery engine | Shino — **not built yet, tab 404s** |
| `/desk` | Desk Mode | Pillar 2 |
| `/session`, `/summary` | Active session, post-session summary | Pillar 2 |
| `/social` | Circles | Pillar 6 |
| `/add-friend` | Invite-code friend flow | Pillar 6 |
| `/recovery` | Recovery tab — breathing check, soundscape, circle recovery | Pillar 3/6 |
| `/calibrate` | Calibration hub. Not a tab: reached from Desk Mode, because it configures Desk Mode | Pillar 3 |
| `/my-challenges` | What you joined, finished and missed | Pillar 6 |
| `/questionnaire`, `/spot-check`, `/breathing` | Baseline, finger-PPG, breathing | Pillar 3 |
| `/challenge` | Challenge detail — join/leave, anonymous join count | Pillar 6 |
| `/new-challenge` | Create a challenge for your circle | Pillar 6 |

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
| Interval-sampled rPPG (12 s burst / 60 s) | ✅ `src/camera/config.ts`, camera fully off between bursts |
| Adaptive Pomodoro | ✅ Break slides ±2–5 min per reading, bounded 12–45 min; **break length is the user's choice** (3/5/10/15 min) — Wick decides *when*, never how long |
| Threshold escalation → enforced pause | ✅ Two consecutive *good-quality* High Stress reads; guided breathing; no skip |
| White Noise & Soundscapes | ✅ Rain / Ocean / Forest / Fan / Silent, generated loops, volume slider |
| Post-session calibration prompt | ✅ Spot on / Slightly off / Way off → rolling Personal Accuracy |
| Frames processed on-device and discarded | ✅ Each frame becomes one number inside the frame-output worklet, then is disposed |
| 3-second setup check | ✅ Requires a detected face, then three *consecutive* clean seconds |
| Person present | ✅ Skin-coverage heuristic on both platforms; VisionCamera's native face detector additionally on iOS (see below) |
| Secondary CV cues | ⚠️ **Movement/fidget index only** (see below) |

**Readings are gated on a person actually being there.** This is not cosmetic. Sensor noise off any
surface, once it has been through a 0.7–3.5 Hz bandpass, contains oscillations that peak detection
will turn into a plausible BPM — an earlier version happily reported a heart rate for an empty chair,
because the setup check tested only brightness. Now: nobody in frame, no reading; presence under 70%
of a burst, burst discarded. The user is told which happened.

**How presence is detected, and the platform split.** VisionCamera 5 exposes a face detector, but it
is **iOS only** — the Android implementation is literally
`throw Error("CameraObjectOutput is not available on Android!")`. So face detection is an
enhancement, never a dependency:

- **Both platforms:** skin coverage of the sampled region, using normalised rg-chromaticity. Dividing
  out total intensity makes it far less sensitive to lighting and to skin tone than an RGB threshold,
  and it runs inside the frame processor we already have. It answers "is a skin-coloured surface
  filling the sampling region" — a heuristic, not face recognition, and exactly the precondition
  rPPG needs.
- **iOS only:** the native detector additionally sharpens the ROI to the real face box and catches a
  second person in frame.

Multi-person detection is therefore **iOS-only today**. On Android the bystander protections are the
ROI restriction and the cropped preview, not detection.

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
- Circle Pulse: counts and averages only, suppressed below 3 friends.
- Anonymous support nudges — `sendCircleSupport()` takes no recipient.
- Shared challenges: create, edit, join, per-person completion.

**Where anonymity applies, and where it deliberately doesn't.** The rule is
about *distress*, not about people. The red-zone count and the support nudge are
nameless, because they reveal that someone is struggling. A challenge is the
opposite: a voluntary invitation between people already in your circle. So
participants are shown by name — you cannot safely turn up to a lakeside walk
without knowing who you are meeting, and hiding it drained the social value out
of the one social feature. Treating those two cases identically was a mistake in
the first cut.

**Two kinds of challenge**, because "Group Walk: Lakeside" and "Screen-Free Tea
Break" are not the same thing:

| Kind | Meaning | Shows |
| --- | --- | --- |
| `meetup` | Same place, same time | Location, who is coming, spots left |
| `solo` | Same window, your own space | No location; nobody gathers |

Capacity is optional and enforced server-side in `toggle_challenge`, so a client
that ignores the full state still can't squeeze in. Completion is **self-marked**
per person, showing "3 of 4 completed". That is honest about what it is: Wick can
verify a breathing break from your own vitals, but it cannot verify that four
friends walked round a lake, and inventing a proof would be worse than trusting
them. Pillar 5's geofence confirmation is the natural upgrade for meetups.

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

Continuous sensing is the default, and it costs more than the old duty cycle
did. That was a deliberate trade, made after the interval design turned out to
be measuring the wrong thing (see *Why continuous* below).

| Measure | Effect |
| --- | --- |
| Sensing mode is the user's choice | Continuous ~15%/hr, Battery saver ~4%/hr, stated on the screen where it is chosen |
| Camera off during breaks and enforced pauses | Nothing to measure, so nothing is spent |
| 320×240 @ 30 fps format request | A quarter of the pixels of the old 640×480 request. Every frame collapses to one channel mean, so resolution buys nothing and costs ISP throughput plus an RGB conversion of every pixel |
| Face-box ROI + pixel stride 2 | Only the sampled region is read at all |
| Frame → one float, on the camera thread | No bridge traffic per frame, no per-frame React render |
| `AppState` teardown | Camera stops the moment the app backgrounds |
| `useKeepAwake` scoped to the session screen only | The screen isn't held on outside a session |

### Why continuous, when a duty cycle is cheaper

The first design sampled 12 seconds a minute. Two things were wrong with it, and
neither could be fixed by adjusting the interval:

1. **12 seconds is too short for HRV.** It yields roughly 11-14 inter-beat
   intervals. RMSSD's own sampling error over that few intervals is wider than
   the 10% / 30% thresholds the stress classifier uses, so a reading could swing
   between *Normal* and *High Stress* on nothing but which beats happened to land
   in the window. `MIN_HRV_SECONDS` now gates this: below 30 seconds of clean
   signal Wick reports a heart rate and returns HRV as `null`, and the classifier
   says *Unknown* rather than guessing.
2. **Restlessness sampled 20% of the time is a coin flip.** Someone fidgeting
   throughout who happened to be still during the sampled burst read as perfectly
   steady, and nothing in the design would ever have surfaced the error.

Continuous mode keeps the camera open across the focus block and analyses a
rolling 40-second window every 15 seconds. Windows overlap, so the trend is a
curve rather than a scatter, and movement is measured for 100% of the block
instead of 20%. Battery saver keeps the old behaviour, made explicit and named
for what it costs.

There is a third accuracy limit worth naming: peak positions are quantised to
1/fps, which is 33 ms at 30 fps, against RMSSD values of 20-50 ms. `ppgService`
fits a parabola through each peak and its neighbours to recover the maximum to a
fraction of a sample, which puts the timing error well below the quantity being
measured.

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

1. **Preview cropped to your face.** `PREVIEW_MODE` in `src/camera/config.ts`. Desk Mode shows a small
   circular crop centred on the detected face box — the room around you is clipped away, not blurred
   over. Nothing outside your face is ever drawn, so a passer-by can't appear on screen or in a
   screenshot. An earlier version showed no preview at all; that was right about the risk and wrong
   about the cost, because it left the user with no way to tell whether they were framed.
2. **Sampling confined to the face box.** Pixels are read only from inside the detected face, inset
   18% to stay on skin. The doorway behind you is never sampled, so a passer-by cannot influence the
   signal even in principle.
3. **A second face voids the burst** (iOS, where the detector exists). The reading is dropped and the
   user told why, rather than quietly averaging two people's skin tones.
4. **The preview only exists while a burst runs.** For the other 48 seconds of each minute there is
   no camera and no image on screen at all.

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
