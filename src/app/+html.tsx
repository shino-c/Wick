import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * Root HTML document for web.
 *
 * This file only runs in Node during static rendering / on the web platform; it
 * is never part of a native build. It exists for the iPhone preview shell
 * (src/components/WebPhoneShell.tsx), which needs two things the app itself
 * cannot express:
 *
 *   1. A stylesheet for the shell <head> — the shell's cell borders.
 *   2. The "WICK PROTOTYPE" label, which must sit *outside* the phone and
 *      therefore outside the application UI by definition. Putting it here
 *      guarantees that: it is a sibling of the app root, not a component inside
 *      it, so it can never be picked up by the app's own layout or navigation.
 *
 * Nothing here touches Supabase, auth, or any app state.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/*
          `viewport-fit=cover` is what lets the phone shell use the full browser
          height without the mobile-URL-bar inset fighting it.
        */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />

        {/*
          Disable body scrolling on web. Keeps ScrollView components behaving like
          they do on native, and stops the phone shell from producing page scroll.
        */}
        <ScrollViewStyleReset />

        <meta name="theme-color" content="#e7e3da" />
        <meta
          name="description"
          content="Wick — a stress-aware focus companion. Web prototype preview."
        />

        {/*
          Inline style, not a linked stylesheet: this is a single rule and it has
          to be present in the statically rendered HTML before first paint, or the
          phone would flash unstyled.
        */}
        <style
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `
              html, body { background-color: #e7e3da; height: 100%; }
              html { -webkit-text-size-adjust: 100%; }
              body { overflow: hidden; }
            `,
          }}
        />
      </head>
      <body>
        {children}
        {/* Decorative, off-device, and inert to pointer and screen-reader input. */}
        <div className="wick-preview-label" aria-hidden="true">
          WICK PROTOTYPE
        </div>
      </body>
    </html>
  );
}
