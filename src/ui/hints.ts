import { useCallback, useEffect, useRef, useState } from "react";

const HINT_KEY = "roadkeep.hints.v1";

export interface Hint {
  id: string;
  text: string;
}

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(HINT_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* ignore */
  }
  return new Set();
}

function saveSeen(seen: Set<string>) {
  try {
    localStorage.setItem(HINT_KEY, JSON.stringify([...seen]));
  } catch {
    /* ignore */
  }
}

/**
 * One-shot contextual tips. Each hint id is shown once per device; only one hint is on
 * screen at a time and later requests queue behind it.
 */
export function useHints(ttlMs = 5600) {
  const seenRef = useRef<Set<string> | null>(null);
  const queueRef = useRef<Hint[]>([]);
  const timerRef = useRef(0);
  const [hint, setHint] = useState<Hint | null>(null);
  const hintRef = useRef<Hint | null>(null);

  const seen = () => (seenRef.current ??= loadSeen());

  const dismiss = useCallback(() => {
    window.clearTimeout(timerRef.current);
    const next = queueRef.current.shift() ?? null;
    hintRef.current = next;
    setHint(next);
    if (next) timerRef.current = window.setTimeout(dismiss, ttlMs);
  }, [ttlMs]);

  const show = useCallback(
    (id: string, text: string) => {
      const s = seen();
      if (s.has(id)) return;
      s.add(id);
      saveSeen(s);
      if (hintRef.current) {
        queueRef.current.push({ id, text });
        return;
      }
      hintRef.current = { id, text };
      setHint(hintRef.current);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(dismiss, ttlMs);
    },
    [dismiss, ttlMs],
  );

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return { hint, show, dismiss };
}
