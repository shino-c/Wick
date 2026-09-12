/**
 * webModal.ts — keeps React Native `<Modal>` inside the phone on web.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * <Modal> has no DOM of its own on the web: react-native-web renders it into a
 * portal that is appended to `document.body`, so it escapes the app's element
 * tree entirely. It then stamps `position: fixed; top: 0; right: 0; bottom: 0;
 * left: 0` on the portal's wrapper, on the dialog itself, AND on an inner
 * container (ModalPortal → ModalAnimation → ModalContent in RNW's source).
 *
 * Outside the phone shell that is exactly right: a modal should cover the
 * viewport. Inside it, those values are measured against the *browser* viewport
 * rather than the phone, so a popup opened in the 390x844 preview draws itself
 * over the whole browser — visibly outside the device it belongs to.
 *
 * WHAT THIS DOES
 * --------------
 * Neutralises those fixed overlays, inside the phone only:
 *
 *   1. The portal is re-parented under the phone's own app layer, so it is
 *      clipped by the glass and moves with it.
 *   2. `position` is forced to `absolute` and the offsets are unset, which makes
 *      an overlay resolve against its nearest positioned ancestor — the phone.
 *   3. An internal scroll is allowed, so a dialog taller than the glass can
 *      still be read rather than being chopped off.
 *
 * It is driven from `WebPhoneShell` and does nothing when the shell is not
 * mounted, so native and a browser running the app without the preview frame
 * are both untouched.
 */

/** Marks an element this module has already re-parented. */
const MOVED_ATTR = 'data-wick-in-phone';

/** Marks an element whose fixed positioning has been neutralised. */
const STYLE_ATTR = 'data-wick-contain';

/**
 * The styles RNW hardcodes onto the three modal layers, and what replaces them.
 *
 * `position: absolute` plus `inset: auto` is the whole trick: an absolutely
 * positioned box with no offsets is placed exactly where it would have been in
 * normal flow, but its containing block becomes the nearest positioned
 * ancestor — the phone — instead of the browser viewport.
 */
const CSS = `
[${STYLE_ATTR}] {
  position: absolute !important;
  top: auto !important;
  right: auto !important;
  bottom: auto !important;
  left: auto !important;
  /*
   * Sized in pixels that are stamped on per element at containment time, not in
   * percentages. React Native Web hardcodes a 100% width on the modal wrapper,
   * and a percentage resolves against the *viewport* here, which is the whole
   * bug: the overlay covers the browser no matter what its parent is. Explicit
   * dimensions taken from the app layer are the only way to say "the phone".
   */
  overflow-y: auto !important;
  overflow-x: hidden !important;
  overscroll-behavior: contain !important;
}
`;

/**
 * Starts watching for modals and containing them inside `host`.
 *
 * ── Why a permanent watcher, not a mount-time fix ──────────────────
 * The portal appears whenever a screen happens to set `visible`, which can be
 * long after the shell mounted (a notification tapped on the dashboard) or
 * before it laid out (the onboarding modal on first paint). There is no hook on
 * RNW's modal to hang this off, so the two mechanisms below cover both ends:
 *
 *   · a MutationObserver, which catches the portal the instant it is attached;
 *   · a slow interval, which catches the case where RNW re-applies its style
 *     object on a later render and undoes the containment.
 *
 * @returns a teardown function.
 */
export function containModalsInPhone(host: HTMLElement): () => void {
  if (typeof document === 'undefined' || !host.isConnected) return () => {};
  void host;

  const style = document.createElement('style');
  style.setAttribute('data-wick-modal-css', '');
  style.textContent = CSS;
  document.head.appendChild(style);

  /**
   * RNW's modal portal is a `div` holding a single full-viewport wrapper, and it
   * is appended to `document.body` — but *where* under `body` differs by version
   * and by what else the page has mounted, so this matches on structure ("a div
   * whose only child is a fixed box") rather than on being a direct child.
   *
   * Anything already inside the phone is skipped, which is what stops this from
   * re-parenting its own output on the next mutation.
   */
  const isModalPortal = (node: Element): node is HTMLElement => {
    if (!(node instanceof HTMLElement)) return false;
    if (node.hasAttribute(MOVED_ATTR)) return false;
    if (host.contains(node)) return false;
    const child = node.firstElementChild;
    if (!child) return false;
    if (child.children.length > 1) return false;
    // `position` alone is not a reliable tell: RNW declares these on a style
    // object, and a modal that is animating can read as `relative` on the very
    // tick it is attached. Size is the steadier signal — the wrapper is a
    // full-viewport box on an otherwise static page.
    const r = child.getBoundingClientRect();
    const fullWidth = r.width >= document.documentElement.clientWidth - 2;
    return fullWidth || getComputedStyle(child).position === 'fixed';
  };

  /**
   * The phone's own box, in viewport pixels.
   *
   * Read fresh on every pass rather than cached: the frame is resizable, and a
   * stale size would leave an overlay that is subtly the wrong shape after the
   * window changes.
   */
  const hostBox = () => {
    const r = host.getBoundingClientRect();
    return { x: `${Math.round(r.left)}px`, y: `${Math.round(r.top)}px`, w: `${Math.round(r.width)}px`, h: `${Math.round(r.height)}px` };
  };

  const contain = (portal: HTMLElement) => {
    /**
     * Marked, and never re-parented.
     *
     * The first version of this moved the portal into the phone with
     * `host.appendChild(portal)`. React owns that node, so yanking it out of the
     * tree it rendered into made the next commit throw and took the whole app
     * down — a white screen on every launch, not a misplaced dialog.
     *
     * Resizing in place is the fix, and it turns out to be enough on its own: the
     * portal is already a sibling of the app root inside a full-height layout, so
     * making its wrapper `absolute` with no offsets drops it into the phone's
     * box — clipped by the glass, positioned against the phone rather than the
     * browser — without React ever noticing we touched anything.
     */
    portal.setAttribute(MOVED_ATTR, '');

    // `getComputedStyle` is not enough on its own: RNW leaves an *inline* `top`
    // and `left` on the wrapper, and those are re-applied on every re-render —
    // so a layer can read as `relative` at the moment this runs and still carry
    // offsets that pin it to the viewport a moment later. The inline values are
    // therefore cleared on the fixed layers *and* on the dialog, which is the
    // one that still measured 1280x720 with the card already inside the phone.
    const dialog = portal.querySelector('[aria-modal="true"], [role="dialog"]');
    const layers = dialog ? [portal, dialog] : [portal];

    for (const layer of layers) {
      if (!(layer instanceof HTMLElement)) continue;
      // RNW's own style objects are declared `!important` for `top/right/bottom/
      // left`, so a stylesheet cannot win against them and an inline value
      // outranks both anyway. `priority: 'important'` on the inline value is what
      // actually takes effect.
      for (const prop of ['position', 'top', 'right', 'bottom', 'left'] as const) {
        layer.style.setProperty(prop, prop === 'position' ? 'absolute' : 'auto', 'important');
      }
      layer.style.setProperty('width', 'auto', 'important');
      layer.style.setProperty('height', 'auto', 'important');
      layer.setAttribute(STYLE_ATTR, '');
    }

    // The overlay itself is the box that has to match the phone. RNW's wrapper,
    // the portal and the dialog sit on top of each other, so giving each of them
    // the phone's exact pixel box makes the whole stack agree with the glass —
    // no matter which layer a given RNW version decides to size.
    const { x, y, w, h } = hostBox();
    for (const el of [portal, portal.firstElementChild, dialog]) {
      if (!(el instanceof HTMLElement)) continue;
      el.style.setProperty('position', 'absolute', 'important');
      el.style.setProperty('top', y, 'important');
      el.style.setProperty('left', x, 'important');
      el.style.setProperty('right', 'auto', 'important');
      el.style.setProperty('bottom', 'auto', 'important');
      el.style.setProperty('width', w, 'important');
      el.style.setProperty('height', h, 'important');
      el.style.setProperty('max-height', '100%', 'important');
      el.style.setProperty('overflow-y', 'auto', 'important');
      el.style.setProperty('overflow-x', 'hidden', 'important');
      el.setAttribute(STYLE_ATTR, '');
    }
  };

  const scan = () => {
    for (const node of Array.from(document.querySelectorAll('body div'))) {
      if (isModalPortal(node)) contain(node);
    }
    // Never leave a contained portal un-contained: RNW re-stamps its style
    // object whenever the modal re-renders.
    for (const el of Array.from(document.querySelectorAll(`[${MOVED_ATTR}]`))) {
      contain(el as HTMLElement);
    }
  };

  // A slow safety net for the one case the observers cannot see: RNW writing its
  // style object inline on a render that changes nothing else in the DOM.
  const guard = window.setInterval(scan, 400);

  scan();
  const observer = new MutationObserver(() => scan());
  // `subtree` as well as `childList`: the portal's wrapper is often attached and
  // then filled on a later tick, so the row that matters can be a grandchild of
  // what changed.
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

  return () => {
    observer.disconnect();
    window.clearInterval(guard);
    style.remove();
  };
}
