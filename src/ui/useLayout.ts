import { useEffect, useState } from "react";

export type LayoutMode = "column" | "side";

export interface LayoutInfo {
  /** column = stage stacked between a top HUD bar and a bottom build strip (portrait phones/tablets). side = stage left, panel right. */
  layout: LayoutMode;
  /** Shortest viewport edge < 600px — phones in either orientation. */
  phone: boolean;
  /** Primary pointer is coarse (finger) or the device reports touch points. */
  touch: boolean;
  /** Android phone or tablet (user agent). */
  android: boolean;
  /** Show PUBG-style walk/look/fire instead of WASD + mouse lock. */
  fpsTouch: boolean;
  width: number;
  height: number;
}

function detectAndroid() {
  if (typeof navigator === "undefined") return false;
  if (/Android/i.test(navigator.userAgent)) return true;
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return !!data?.platform && /android/i.test(data.platform);
}

function detectIphone() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPod/i.test(navigator.userAgent);
}

function compute(): LayoutInfo {
  if (typeof window === "undefined") {
    return {
      layout: "column",
      phone: false,
      touch: false,
      android: false,
      fpsTouch: false,
      width: 480,
      height: 800,
    };
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  const landscape = width > height;
  const phone = Math.min(width, height) < 600;
  // Phones keep the valley clear for the keep bar. Stats and orders live in the side panel.
  const layout: LayoutMode = phone || (landscape && width >= 640) ? "side" : "column";
  const touch = (window.matchMedia?.("(pointer: coarse)").matches ?? false) || navigator.maxTouchPoints > 0;
  const android = detectAndroid();
  const fpsTouch = android || detectIphone() || (phone && touch);
  return { layout, phone, touch, android, fpsTouch, width, height };
}

/** Viewport-driven layout + input-capability info, re-evaluated on resize/orientation/pointer changes. */
export function useLayout(): LayoutInfo {
  const [info, setInfo] = useState<LayoutInfo>(compute);
  useEffect(() => {
    const update = () => {
      const next = compute();
      setInfo((prev) =>
        prev.layout === next.layout &&
        prev.phone === next.phone &&
        prev.touch === next.touch &&
        prev.android === next.android &&
        prev.fpsTouch === next.fpsTouch &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next,
      );
    };
    const queries = [
      window.matchMedia("(orientation: portrait)"),
      window.matchMedia("(pointer: coarse)"),
      window.matchMedia("(max-width: 639px)"),
    ];
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    for (const q of queries) q.addEventListener?.("change", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      for (const q of queries) q.removeEventListener?.("change", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
  return info;
}
