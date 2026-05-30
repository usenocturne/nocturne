import React, { useEffect, useRef, useState } from "react";
import {
  DOT_PULSE_MS,
  PILL_CROSS_FADE_MS,
  STREAM_WORD_MS,
  THINKING_DIM_OPACITY,
} from "./constants";

export default function VoicePill({
  visible,
  children,
  phase,
  aiResponse,
  transcript,
  onStreamComplete,
}) {
  const [streamedWords, setStreamedWords] = useState([]);
  const [streamingActive, setStreamingActive] = useState(false);
  const lastStreamedResponseRef = useRef("");
  const rafIdRef = useRef(null);

  useEffect(() => {
    if (phase !== "speaking" || !aiResponse) {
      return;
    }
    if (aiResponse === lastStreamedResponseRef.current) {
      return;
    }

    const words = aiResponse.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      onStreamComplete?.();
      return;
    }

    setStreamedWords([]);
    setStreamingActive(true);

    let lastTick = performance.now();
    let cursor = 0;
    let cancelled = false;

    function tick(now) {
      if (cancelled) return;
      if (now - lastTick >= STREAM_WORD_MS) {
        cursor += 1;
        setStreamedWords(words.slice(0, cursor));
        lastTick = now;
        if (cursor >= words.length) {
          setStreamingActive(false);
          lastStreamedResponseRef.current = aiResponse;
          onStreamComplete?.();
          return;
        }
      }
      rafIdRef.current = requestAnimationFrame(tick);
    }
    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [aiResponse, phase]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  const isListeningEmpty = phase === "listening" && !transcript;
  const isThinking = phase === "thinking" && transcript;
  const isSpeaking = phase === "speaking" && aiResponse;

  let pillContent;
  let ariaLive = "polite";

  if (isListeningEmpty) {
    pillContent = (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span className="voice-pill-dot" />
        <span className="voice-pill-dot voice-pill-dot-2" />
        <span className="voice-pill-dot voice-pill-dot-3" />
      </div>
    );
  } else if (isThinking) {
    pillContent = (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <span
          style={{
            opacity: THINKING_DIM_OPACITY,
            fontSize: "28px",
            fontWeight: 600,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {transcript.charAt(0).toUpperCase() + transcript.slice(1)}
        </span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginTop: "16px",
          }}
        >
          <span className="voice-pill-dot" />
          <span className="voice-pill-dot voice-pill-dot-2" />
          <span className="voice-pill-dot voice-pill-dot-3" />
        </div>
      </div>
    );
  } else if (isSpeaking) {
    ariaLive = streamingActive ? "off" : "polite";
    const displayText = streamedWords.length > 0 ? streamedWords.join(" ") : "";
    pillContent = (
      <span
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {displayText}
      </span>
    );
  } else if (typeof children === "string") {
    pillContent = (
      <span
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {children}
      </span>
    );
  } else {
    pillContent = <div>{children}</div>;
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        left: "50%",
        zIndex: 10000,
        backgroundColor: "#121218",
        borderRadius: "30px",
        padding: "18px 40px",
        minHeight: "72px",
        minWidth: "180px",
        fontSize: "24px",
        fontWeight: 600,
        color: "#FFFFFF",
        textAlign: "center",
        boxShadow:
          "0 12px 40px rgba(0,0,0,0.55), 0 0 1px rgba(255,255,255,0.08) inset",
        transition: "opacity 280ms ease, transform 280ms ease",
        opacity: visible ? 1 : 0,
        transform: `translate(-50%, ${visible ? 0 : 12}px)`,
        pointerEvents: visible ? "auto" : "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div role="status" aria-live={ariaLive}>
        {pillContent}
      </div>
    </div>
  );
}
