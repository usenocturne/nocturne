import React from "react";
import VoiceBorder from "./VoiceBorder";
import VoicePill from "./VoicePill";
import VoiceConfirmation from "./VoiceConfirmation";
import VolumeConfirmation from "./VolumeConfirmation";
import { useVoice } from "../../../../contexts/VoiceContext";
import { INTENT_TO_CONFIRMATION_TEXT, NO_ICON_INTENTS } from "./constants";

function deriveIntensity(state) {
  switch (state.phase) {
    case "listening":
      return 0.75;
    case "thinking":
      return 0.55;
    case "speaking":
      return 0.65;
    case "confirmation":
    case "volume":
    case "error":
      return 0.55;
    case "idle":
      return 0.55;
    case "closing":
      return 0.55;
    default:
      return 0;
  }
}

function firstLetterUpperCase(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function VoiceOverlay() {
  const { state, isError, micLevelRef, actions } = useVoice();

  const handleStreamComplete = React.useCallback(() => {
    if (actions?.streamComplete) {
      actions.streamComplete();
    }
  }, [actions]);

  let pillContent;
  if (isError) {
    pillContent = state.friendlyError || "Sorry, something went wrong.";
  } else if (state.confirmationText) {
    pillContent = (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "4px",
        }}
      >
        <span>{state.confirmationText.title}</span>
        {state.confirmationText.subtitle && (
          <span style={{ fontSize: "20px", opacity: 0.7 }}>
            {state.confirmationText.subtitle}
          </span>
        )}
      </div>
    );
  } else if (state.phase === "volume") {
    pillContent = <VolumeConfirmation volumeTarget={state.volumeTarget} />;
  } else if (state.phase === "confirmation" && state.intent) {
    if (NO_ICON_INTENTS.has(state.intent)) {
      pillContent = state.aiResponse || "Playing";
    } else {
      pillContent = (
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <VoiceConfirmation intent={state.intent} action={state.action} />
          <span>{INTENT_TO_CONFIRMATION_TEXT[state.intent] || ""}</span>
        </div>
      );
    }
  } else if (state.aiResponse && !isError) {
    pillContent = state.aiResponse;
  } else if (state.transcript && !isError) {
    pillContent = firstLetterUpperCase(state.transcript);
  } else {
    pillContent = "Listening\u2026";
  }

  return (
    <>
      <VoiceBorder
        active={state.isOpen}
        intensity={deriveIntensity(state)}
        phase={state.phase}
        micLevelRef={micLevelRef}
      />
      <VoicePill
        visible={state.isOpen}
        phase={state.phase}
        aiResponse={state.aiResponse}
        transcript={state.transcript}
        onStreamComplete={handleStreamComplete}
      >
        {pillContent}
      </VoicePill>
    </>
  );
}
