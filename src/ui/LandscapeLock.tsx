import { useEffect, useState } from "react";

type OrientationLike = {
  type?: string;
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
};

function isPhoneViewport() {
  if (typeof window === "undefined") return false;
  return Math.min(window.innerWidth, window.innerHeight) < 600;
}

function isPortrait() {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(orientation: portrait)").matches) return true;
  return window.innerHeight > window.innerWidth;
}

function needsLandscapeGate() {
  return isPhoneViewport() && isPortrait();
}

async function tryLockLandscape() {
  const orientation = (screen as Screen & { orientation?: OrientationLike }).orientation;
  if (!orientation?.lock) return;
  try {
    await orientation.lock("landscape");
  } catch {
    try {
      await orientation.lock("landscape-primary");
    } catch {
      /* browsers often refuse until fullscreen / installed PWA */
    }
  }
}

/**
 * Phones must play in landscape. Shows a full-screen rotate prompt in portrait
 * and asks the Screen Orientation API to lock when the browser allows it.
 */
export function LandscapeLock() {
  const [blocked, setBlocked] = useState(needsLandscapeGate);

  useEffect(() => {
    const sync = () => setBlocked(needsLandscapeGate());
    sync();
    const mq = window.matchMedia?.("(orientation: portrait)");
    mq?.addEventListener?.("change", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      mq?.removeEventListener?.("change", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);

  useEffect(() => {
    if (!isPhoneViewport()) return;
    void tryLockLandscape();
    const onGesture = () => void tryLockLandscape();
    window.addEventListener("pointerdown", onGesture, { once: true, capture: true });
    window.addEventListener("fullscreenchange", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("fullscreenchange", onGesture);
    };
  }, []);

  if (!blocked) return null;

  return (
    <div className="landscape-lock" role="dialog" aria-modal="true" aria-label="Rotate your phone">
      <div className="landscape-lock-card">
        <span className="landscape-lock-icon" aria-hidden>
          ↻
        </span>
        <strong>Turn your phone sideways</strong>
        <p>This match needs landscape. Rotate the device to keep playing.</p>
        <button type="button" className="cta" onClick={() => void tryLockLandscape()}>
          Lock landscape
        </button>
      </div>
    </div>
  );
}
