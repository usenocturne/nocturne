import { useEffect, useRef } from "react";

const GRADIENT = `conic-gradient(from 0deg,
  rgba(240, 70, 180, 0.95) 0%,
  rgba(130, 90, 255, 0.92) 14%,
  rgba(80, 160, 255, 0.88) 28%,
  rgba(100, 210, 210, 0.88) 42%,
  rgba(255, 150, 90, 0.92) 56%,
  rgba(255, 80, 130, 0.95) 70%,
  rgba(255, 110, 170, 0.92) 84%,
  rgba(240, 70, 180, 0.95) 100%
)`;

const HIGHLIGHT_GRADIENT = `conic-gradient(from 0deg,
  rgba(248, 180, 230, 0.95) 0%,
  rgba(200, 180, 255, 0.92) 14%,
  rgba(180, 210, 255, 0.88) 28%,
  rgba(190, 235, 235, 0.88) 42%,
  rgba(255, 210, 180, 0.92) 56%,
  rgba(255, 180, 200, 0.95) 70%,
  rgba(255, 195, 220, 0.92) 84%,
  rgba(248, 180, 230, 0.95) 100%
)`;

const BORDER_MASK = {
  WebkitMask:
    "linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)",
  WebkitMaskComposite: "xor",
  mask: "linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)",
  maskComposite: "exclude",
};

const GLOW_DEPTH = 35;
const GLOW_MASK = [
  `linear-gradient(to bottom, black 0px, transparent ${GLOW_DEPTH}px, transparent calc(100% - ${GLOW_DEPTH}px), black 100%)`,
  `linear-gradient(to right, black 0px, transparent ${GLOW_DEPTH}px, transparent calc(100% - ${GLOW_DEPTH}px), black 100%)`,
].join(", ");

const ROTOR_BASE_STYLE = {
  position: "absolute",
  top: "50%",
  left: "50%",
  width: "160vmax",
  height: "160vmax",
  transform: "translate(-50%, -50%) rotate(0deg)",
  willChange: "transform",
  backfaceVisibility: "hidden",
  WebkitBackfaceVisibility: "hidden",
  pointerEvents: "none",
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export default function VoiceBorder({ active, intensity, phase, micLevelRef }) {
  const rootRef = useRef(null);
  const glowWrapRef = useRef(null);
  const bloomWrapRef = useRef(null);
  const highlightWrapRef = useRef(null);
  const glowRotorRef = useRef(null);
  const bloomRotorRef = useRef(null);
  const highlightRotorRef = useRef(null);
  const rafRef = useRef(null);
  const angleRef = useRef(0);
  const lastTimeRef = useRef(null);
  const intensityRef = useRef(intensity);
  const phaseRef = useRef(phase);
  intensityRef.current = intensity;
  phaseRef.current = phase;

  useEffect(() => {
    if (!active) return;
    const startTime = performance.now();
    lastTimeRef.current = startTime;
    angleRef.current = 0;

    const tick = (now) => {
      if (!rootRef.current) return;

      const dt = now - lastTimeRef.current;
      lastTimeRef.current = now;
      const elapsed = now - startTime;

      let cur;
      if (
        phaseRef.current === "listening" &&
        micLevelRef &&
        typeof micLevelRef.current === "number"
      ) {
        cur = clamp01(0.75 + 0.25 * micLevelRef.current);
      } else {
        cur = clamp01(intensityRef.current);
      }

      const speed = 0.1 + 0.08 * cur;
      angleRef.current = (angleRef.current + dt * speed) % 360;
      const transform = `translate(-50%, -50%) rotate(${angleRef.current}deg)`;
      const glowRotor = glowRotorRef.current;
      const bloomRotor = bloomRotorRef.current;
      const highlightRotor = highlightRotorRef.current;
      if (glowRotor) glowRotor.style.transform = transform;
      if (bloomRotor) bloomRotor.style.transform = transform;
      if (highlightRotor) highlightRotor.style.transform = transform;

      const bloomWrap = bloomWrapRef.current;
      const highlightWrap = highlightWrapRef.current;
      if (bloomWrap) bloomWrap.style.opacity = String(cur);
      if (highlightWrap) highlightWrap.style.opacity = String(cur * 0.7);

      const glowWrap = glowWrapRef.current;
      if (glowWrap) {
        const pulse = Math.sin((elapsed * Math.PI) / 1000);
        glowWrap.style.opacity = String(clamp01(cur * (0.5 + 0.15 * pulse)));
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [active]);

  return (
    <div
      ref={rootRef}
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        pointerEvents: "none",
        zIndex: 9999,
        opacity: active ? 1 : 0,
        transition: "opacity 300ms ease",
        overflow: "hidden",
        borderRadius: "16px",
        contain: "paint layout",
        isolation: "isolate",
      }}
    >
      <div
        ref={glowWrapRef}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          borderRadius: "16px",
          WebkitMaskImage: GLOW_MASK,
          maskImage: GLOW_MASK,
          opacity: 0,
          pointerEvents: "none",
        }}
      >
        <div
          ref={glowRotorRef}
          style={{ ...ROTOR_BASE_STYLE, background: GRADIENT }}
        />
      </div>

      <div
        ref={bloomWrapRef}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          border: "12px solid transparent",
          borderRadius: "28px",
          boxSizing: "border-box",
          ...BORDER_MASK,
          opacity: 0,
          pointerEvents: "none",
        }}
      >
        <div
          ref={bloomRotorRef}
          style={{ ...ROTOR_BASE_STYLE, background: GRADIENT }}
        />
      </div>

      <div
        ref={highlightWrapRef}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          border: "6px solid transparent",
          borderRadius: "22px",
          boxSizing: "border-box",
          ...BORDER_MASK,
          opacity: 0,
          pointerEvents: "none",
        }}
      >
        <div
          ref={highlightRotorRef}
          style={{ ...ROTOR_BASE_STYLE, background: HIGHLIGHT_GRADIENT }}
        />
      </div>
    </div>
  );
}
