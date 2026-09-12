import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

/**
 * WebPhoneShell — a decorative iPhone frame for the web build only.
 *
 * WHY THIS EXISTS
 * ---------------
 * Wick is a phone app; `expo start --web` renders it full-bleed in a laptop
 * browser, which makes a 390pt-wide layout stretch to 1920px and misrepresents
 * what the product looks like. This puts the *real* running application inside
 * a phone-shaped viewport instead of changing the app to fit the browser.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 *  - It does not render on native. `_layout.tsx` only wraps children on
 *    `Platform.OS === 'web'`; Android and iOS get `children` untouched.
 *  - It does not fake a screen. The child subtree is the actual Expo Router
 *    `<Stack>`, so navigation, state and data are the real ones — this is a
 *    picture frame, not a screenshot.
 *  - It does not intercept input. Nothing here is pressable; the frame is
 *    `pointerEvents="none"` chrome plus one plain container, so every control
 *    inside the app stays reachable by touch and by keyboard.
 *
 * HOW THE FIT WORKS
 * -----------------
 * The phone is always *laid out* at the logical phone size (390 x 884) and the
 * frame shrinks to fit the browser. Crucially, the shrink is applied by
 * publishing a smaller VIEWPORT SIZE to the app, not by scaling the rendered
 * pixels (see `PhoneViewportContext` below): the app believes it is running on a
 * 390 x 884 phone and lays itself out against that, while CSS is free to draw
 * the frame at whatever size the browser can afford.
 *
 * WHY NOT A CSS TRANSFORM
 * -----------------------
 * The first version of this shell rendered the app absolutely inside the phone
 * and applied `transform: [{ scale }]` to the whole device. That scales the
 *pixels*, and it broke the two things a preview shell must never break:
 *
 *   1. Anything the app renders outside its own tree — and a React Native Web
 *      `<Modal>` does exactly that, mounting into a portal on `document.body` —
 *      was positioned against the browser viewport and painted at browser scale.
 *      The overlay covered the whole page and the dialog appeared beside the
 *      phone, not inside it.
 *   2. Every translation the app makes in its own coordinate space (a
 *      `position: fixed` layer, a `transform-origin: bottom` sheet, the
 *      viewport-relative clamping in the stress chart) was off by the scale
 *      factor, so the further a control sat from the shell's top-left the more
 *      it drifted from where it was meant to be.
 *
 * Measuring into a plain, unscaled container and letting the app lay itself out
 * natively removes the whole class of problem: there is no scale factor for
 * anything to be wrong by. The cost is that the app reflows slightly at very
 * small window sizes instead of shrinking uniformly, which is the correct
 * trade — a reflowed preview is still an accurate picture of the layout, a
 * mispositioned modal is not.
 */

/** Logical phone viewport requested for the web preview, in points. */
const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 884;

/**
 * The chrome's own insets, in points.
 *
 * These match the decorative status bar (54pt tall) and the home indicator
 * (which sits 9pt from the bottom), so the real app's `SafeAreaView` and
 * `useSafeAreaInsets()` consumers reserve exactly the space the shell's chrome
 * occupies. Without them the app lays out from y=0 and its top bar is drawn
 * straight under the fake status bar and Dynamic Island.
 */
const SHELL_INSETS = { top: 54, bottom: 34, left: 0, right: 0 } as const;

/** Bezel thickness between the frame and the glass. */
const DEVICE_PADDING = 12;


/**
 * Empty margin reserved around the frame so the device shadow has somewhere to
 * fall. It is dropped (to a token 8pt) when the window is too small to spare it.
 */
const SHADOW_BLEED = 40;

const styles = StyleSheet.create({
  /** Full-viewport backdrop. The gradient and the label live in global.css. */
  stage: {
    flex: 1,
    minHeight: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    // RN 0.86 accepts multiple backgrounds; this is the CSS backdrop under it.
    backgroundColor: 'transparent',
    // A short browser viewport must scroll to the full shell rather than
    // clipping its top or bottom.
    overflowY: 'auto',
    overflowX: 'hidden',
  },

  /** The phone body: bezel, radius, border, shadow. */
  device: {
    borderRadius: 55,
    padding: DEVICE_PADDING,
    backgroundColor: '#0B0B0D',
    // A hairline highlight reads as the polished chamfer on a real titanium band.
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 60,
    shadowOffset: { width: 0, height: 32 },
    elevation: 24,
  },

  /** Inner side-button nubs. Purely decorative. */
  buttonRight: {
    position: 'absolute',
    right: -2.5,
    top: 210,
    width: 3,
    height: 92,
    borderRadius: 2,
    backgroundColor: '#26262A',
  },
  buttonLeft: {
    position: 'absolute',
    left: -2.5,
    top: 150,
    width: 3,
    height: 58,
    borderRadius: 2,
    backgroundColor: '#26262A',
  },
  buttonLeftLower: {
    position: 'absolute',
    left: -2.5,
    top: 224,
    width: 3,
    height: 58,
    borderRadius: 2,
    backgroundColor: '#26262A',
  },

  /** The glass. `overflow: hidden` is what clips the app to the rounded corners. */
  screen: {
    flex: 1,
    borderRadius: 43,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
    // No transform anywhere in this subtree: a transformed ancestor becomes the
    // containing block for `position: fixed`, which is how the app's modals get
    // painted outside the frame.
  },

  /**
   * The app itself.
   *
   * A flex child, not an absolutely positioned layer, for one explicit reason:
   * React Native Web portals (which `<Modal>` uses) mount `position: fixed`
   * overlays into `document.body`, and a `fixed` element is positioned against
   * the nearest ancestor that has a transform. Giving this container a size
   * instead of a transform is what keeps the app's modals inside the phone.
   *
   * Its height is set at render time: a real 884pt when the glass can hold one,
    * otherwise the glass height, with the app's own document scrolling the
   * remainder. `overflow: hidden` is what clips that rounded corners.
   */
  appLayer: {
    flex: 1,
    width: '100%',
    overflowY: 'auto',
    overflowX: 'hidden',
  },

  /** Chrome sits above the app but never takes pointer events. */
  chrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none',
  },

  statusBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 30,
  },
  statusTime: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
    // Status-bar glyphs are always white on a black status area, matching how
    // iOS draws them over the app's content.
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowRadius: 3,
  },
  statusRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 4,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 11,
  },
  battery: {
    width: 24,
    height: 12,
    borderRadius: 3.5,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    padding: 1.5,
    justifyContent: 'center',
  },
  batteryFill: {
    flex: 1,
    borderRadius: 1.5,
    backgroundColor: '#FFFFFF',
  },
  batteryCap: {
    position: 'absolute',
    right: -3,
    width: 1.6,
    height: 4.5,
    borderRadius: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },

  /** The Dynamic Island. Decorative — it is a black pill, nothing more. */
  island: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    width: 122,
    height: 35,
    borderRadius: 20,
    backgroundColor: '#000',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: 11,
  },
  islandCamera: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0E1420',
    borderWidth: 0.5,
    borderColor: '#1B2434',
  },

  /** Home indicator. */
  homeBar: {
    position: 'absolute',
    bottom: 9,
    alignSelf: 'center',
    width: 140,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
  },
});

/**
 * The logical size the app is told it is running on, in points.
 *
 * This is the shell's whole trick. The frame measures whatever space the browser
 * actually offers (it can be 1280x700 on a laptop, or 390x700 when the window is
 * short), and publishes *that* as the app's viewport. Every `useWindowDimensions()`
 * consumer in the app — the stress chart's width measurement, the responsive
 * layout maths — therefore lays out against a phone, inside a phone, and the
 * numbers it reads are the numbers the user is looking at.
 */
export const PhoneViewportContext = React.createContext<{
  width: number;
  height: number;
}>({ width: PHONE_WIDTH, height: PHONE_HEIGHT });

/** The app's viewport as the phone shell sees it (real window size on native). */
export function usePhoneViewport() {
  return React.useContext(PhoneViewportContext);
}

function StatusBar({ time }: { time: string }) {
  return (
    <View style={styles.statusBar}>
      <Text style={styles.statusTime}>{time}</Text>
      <View style={styles.statusRight}>
        {/* Signal strength: four ascending bars. */}
        <View style={styles.bars}>
          {[4, 6, 8, 10].map((h, i) => (
            <View
              key={i}
              style={{
                width: 3,
                height: h,
                borderRadius: 1,
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
              }}
            />
          ))}
        </View>
        {/* Wi-Fi: three nested arcs drawn with borders. */}
        <View style={{ width: 16, height: 12, alignItems: 'center', justifyContent: 'flex-end' }}>
          {[13, 9, 5].map((size, i) => (
            <View
              key={i}
              style={{
                position: 'absolute',
                bottom: 0,
                width: size,
                height: size,
                borderTopLeftRadius: size,
                borderTopRightRadius: size,
                borderWidth: 1.6,
                borderBottomWidth: 0,
                borderColor: 'rgba(255, 255, 255, 0.95)',
              }}
            />
          ))}
          <View
            style={{
              position: 'absolute',
              bottom: -1,
              width: 2.4,
              height: 2.4,
              borderRadius: 1.2,
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
            }}
          />
        </View>
        {/* Battery. */}
        <View style={styles.battery}>
          <View style={styles.batteryFill} />
          <View style={styles.batteryCap} />
        </View>
      </View>
    </View>
  );
}

export function WebPhoneShell({ children }: { children: React.ReactNode }) {
  const { width: browserWidth, height: browserHeight } = useWindowDimensions();

  /**
   * The clock is rendered client-side only.
   *
   * SSR would freeze whatever time the build machine had, and — more
   * importantly — the server render must agree with the first client render or
   * React logs a hydration mismatch. Starting at the iOS marketing time "9:41"
   * and swapping in the real time after mount avoids both.
   */
  const [time, setTime] = React.useState('9:41');

  React.useEffect(() => {
    const tick = () => {
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes().toString().padStart(2, '0');
      setTime(`${h % 12 === 0 ? 12 : h % 12}:${m}`);
    };

    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  /**
   * Keep the app's logical viewport at 390 × 884, but scale the decorative
   * device only when the browser is shorter than the phone. This makes the full
   * shell visible in a normal 720px-tall desktop window without changing the
   * phone layout or forcing the user to scroll to see the bottom bezel.
   */
  const frameWidth = PHONE_WIDTH;
  const frameHeight = PHONE_HEIGHT;
  const shellLayoutWidth = frameWidth + SHADOW_BLEED;
  const shellLayoutHeight = frameHeight + 20;
  const scale = Math.min(
    1,
    Math.max(0.25, (browserWidth - 24) / shellLayoutWidth),
    Math.max(0.25, (browserHeight - 24) / shellLayoutHeight)
  );

  /**
   * What the app is told its viewport is: the glass, minus the bezel padding.
   * Measured from the frame that actually fits, so `useWindowDimensions()` inside
   * the app always agrees with the pixels on screen.
   */
  const viewport = {
    // The app is always told it is on a 390pt-wide phone. When the frame is
    // narrower the app viewport keeps `minHeight: PHONE_HEIGHT` and the app's own
    // document scrolls, which is a reflow we can see rather than a scale we
    // cannot reason about.
    width: PHONE_WIDTH,
    height: PHONE_HEIGHT,
  };

  return (
    <View style={styles.stage}>
      <View
        style={{
          width: shellLayoutWidth * scale,
          height: shellLayoutHeight * scale,
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          overflow: 'visible',
        }}
      >
        <View
          style={[
            styles.device,
            { width: frameWidth, height: frameHeight },
            scale !== 1 && { transform: [{ scale }] },
          ]}
        >
          <View style={styles.buttonLeft} />
          <View style={styles.buttonLeftLower} />
          <View style={styles.buttonRight} />

          <View style={styles.screen}>
            {/*
              The real application. Deliberately not memoised or keyed: this is
              the same element tree Expo Router would have rendered without the
              shell, only laid out into the phone.

              Two contexts are overridden, and both exist to make the app agree
              with the frame around it. The app layer supplies the 54pt top
              offset once, so the safe-area context reports no additional top
              inset and screens do not double-pad their headers.

                · SafeAreaInsets — bottom consumers still reserve the home
                  indicator area, while the top offset is owned by appLayer.
                  · PhoneViewport — the app is told it is on a 390pt-wide, 884pt
                    tall phone, so every responsive calculation inside it (the
                    stress chart's width check, the layout maths) is measuring a
                    phone rather than a laptop window.

              This only exists on web; native never mounts this subtree.
            */}
            <SafeAreaInsetsContext.Provider value={{ ...SHELL_INSETS, top: 0 }}>
              <PhoneViewportContext.Provider value={viewport}>
                <View
                  style={[
                    styles.appLayer,
                    // The decorative status bar is outside the app tree. Keep
                    // every route's real header below it; relying on web
                    // SafeAreaView alone allowed top bars to render underneath
                    // the black shell chrome.
                    { paddingTop: SHELL_INSETS.top },
                  ]}
                >
                  {children}
                </View>
              </PhoneViewportContext.Provider>
            </SafeAreaInsetsContext.Provider>

            <View style={styles.chrome}>
              <View style={styles.island}>
                <View style={styles.islandCamera} />
              </View>
              <StatusBar time={time} />
              <View style={styles.homeBar} />
 </View>
          </View>
        </View>
      </View>
    </View>
  );
}

export default WebPhoneShell;
