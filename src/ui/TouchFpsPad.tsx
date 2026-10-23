import { useCallback, useEffect, useRef, useState } from "react";

export type StickKeys = { w: boolean; a: boolean; s: boolean; d: boolean };

const STICK_R = 56;
const DEAD = 0.28;
const IDLE: StickKeys = { w: false, a: false, s: false, d: false };

function keysFromPad(nx: number, ny: number): StickKeys {
  return {
    w: ny < -DEAD,
    s: ny > DEAD,
    a: nx < -DEAD,
    d: nx > DEAD,
  };
}

function sameKeys(a: StickKeys, b: StickKeys) {
  return a.w === b.w && a.a === b.a && a.s === b.s && a.d === b.d;
}

interface TouchFpsPadProps {
  fireLabel: string;
  onMove: (keys: StickKeys) => void;
  onLook: (dx: number, dy: number) => void;
  onFire: () => void;
  onLeave: () => void;
}

/**
 * PUBG-style mobile first-person: left stick walks, right drag looks, fire on the right.
 */
export function TouchFpsPad({ fireLabel, onMove, onLook, onFire, onLeave }: TouchFpsPadProps) {
  const moveRef = useRef<HTMLDivElement | null>(null);
  const keysRef = useRef<StickKeys>(IDLE);
  const lookPtr = useRef<number | null>(null);
  const lookLast = useRef<{ x: number; y: number } | null>(null);
  const stickPtr = useRef<number | null>(null);
  const originRef = useRef({ x: 0, y: 0 });
  const fireHold = useRef(0);
  const onMoveRef = useRef(onMove);
  const onLookRef = useRef(onLook);
  const onFireRef = useRef(onFire);
  onMoveRef.current = onMove;
  onLookRef.current = onLook;
  onFireRef.current = onFire;

  const [stick, setStick] = useState({
    active: false,
    ox: 0,
    oy: 0,
    tx: 0,
    ty: 0,
  });

  const emitKeys = useCallback((next: StickKeys) => {
    if (sameKeys(keysRef.current, next)) return;
    keysRef.current = next;
    onMoveRef.current(next);
  }, []);

  const stopStick = useCallback(() => {
    stickPtr.current = null;
    setStick((s) => ({ ...s, active: false, tx: 0, ty: 0 }));
    emitKeys(IDLE);
  }, [emitKeys]);

  useEffect(() => {
    return () => {
      window.clearInterval(fireHold.current);
      emitKeys(IDLE);
    };
  }, [emitKeys]);

  const onStickDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    const box = moveRef.current?.getBoundingClientRect();
    if (!box) return;
    ev.preventDefault();
    ev.stopPropagation();
    stickPtr.current = ev.pointerId;
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
    const ox = ev.clientX - box.left;
    const oy = ev.clientY - box.top;
    originRef.current = { x: ox, y: oy };
    setStick({ active: true, ox, oy, tx: 0, ty: 0 });
    emitKeys(IDLE);
  };

  const onStickMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (stickPtr.current !== ev.pointerId) return;
    const box = moveRef.current?.getBoundingClientRect();
    if (!box) return;
    ev.preventDefault();
    const dx = ev.clientX - box.left - originRef.current.x;
    const dy = ev.clientY - box.top - originRef.current.y;
    const mag = Math.hypot(dx, dy);
    const scale = mag > STICK_R ? STICK_R / mag : 1;
    const tx = dx * scale;
    const ty = dy * scale;
    setStick((s) => ({ ...s, tx, ty }));
    emitKeys(keysFromPad(tx / STICK_R, ty / STICK_R));
  };

  const onLookDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    ev.preventDefault();
    lookPtr.current = ev.pointerId;
    lookLast.current = { x: ev.clientX, y: ev.clientY };
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
  };

  const onLookMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (lookPtr.current !== ev.pointerId || !lookLast.current) return;
    ev.preventDefault();
    const dx = ev.clientX - lookLast.current.x;
    const dy = ev.clientY - lookLast.current.y;
    lookLast.current = { x: ev.clientX, y: ev.clientY };
    onLookRef.current(dx, dy);
  };

  const onLookUp = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (lookPtr.current !== ev.pointerId) return;
    lookPtr.current = null;
    lookLast.current = null;
  };

  const startFire = (ev: React.PointerEvent<HTMLButtonElement>) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    onFireRef.current();
    window.clearInterval(fireHold.current);
    fireHold.current = window.setInterval(() => onFireRef.current(), 160);
  };

  const stopFire = (ev: React.PointerEvent<HTMLButtonElement>) => {
    ev.stopPropagation();
    window.clearInterval(fireHold.current);
    fireHold.current = 0;
  };

  return (
    <div className="touch-fps" aria-label="Phone movement">
      <div
        className="touch-look"
        onPointerDown={onLookDown}
        onPointerMove={onLookMove}
        onPointerUp={onLookUp}
        onPointerCancel={onLookUp}
      />
      <div
        ref={moveRef}
        className="touch-move"
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
        onPointerUp={stopStick}
        onPointerCancel={stopStick}
      >
        <div
          className={`touch-stick${stick.active ? " live" : ""}`}
          style={
            stick.active
              ? { left: stick.ox, top: stick.oy, transform: "translate(-50%, -50%)" }
              : undefined
          }
        >
          <i className="touch-stick-nub" style={{ transform: `translate(${stick.tx}px, ${stick.ty}px)` }} />
        </div>
        <span className="touch-stick-hint">Move</span>
      </div>
      <button
        type="button"
        className="touch-fire"
        aria-label={fireLabel}
        onPointerDown={startFire}
        onPointerUp={stopFire}
        onPointerCancel={stopFire}
        onPointerLeave={stopFire}
      >
        {fireLabel}
      </button>
      <button type="button" className="ghost leave-body touch-leave" onClick={onLeave}>
        Leave body
      </button>
    </div>
  );
}
