import type { VoiceShelfItem } from "./ShelfModels";

export interface VoicePayload {
  session_id?: string | null;
  sessionId?: string | null;
  transcript?: string | null;
  is_final?: boolean | null;
  isFinal?: boolean | null;
  muted?: boolean | null;
  state?: string | null;
  message?: string | null;
  text?: string | null;
  response?: string | null;
  toolName?: string | null;
  tool_name?: string | null;
  tool?: string | null;
  toolArguments?: Record<string, unknown> | null;
  tool_arguments?: Record<string, unknown> | null;
  result?: unknown;
  level?: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function isVoicePayload(value: unknown): value is VoicePayload {
  if (!isRecord(value)) return false;
  return (
    [
      "session_id",
      "sessionId",
      "transcript",
      "state",
      "message",
      "text",
      "response",
      "toolName",
      "tool_name",
      "tool",
    ].every((key) => value[key] == null || typeof value[key] === "string") &&
    ["is_final", "isFinal", "muted"].every(
      (key) => value[key] == null || typeof value[key] === "boolean",
    ) &&
    (value.level == null || typeof value.level === "number") &&
    ["toolArguments", "tool_arguments"].every(
      (key) => value[key] == null || isRecord(value[key]),
    )
  );
}

export interface VoiceResultHandler {
  normalize(result: unknown): VoiceShelfItem[];
  isEmpty(result: unknown): boolean;
}
export interface VoiceSessionState {
  asr: { transcript: string; isFinal: boolean };
  aiState: string;
  aiResponse: string;
  error: string | null;
  friendlyError: string;
  micPan: number;
  intent: string;
  action: string | undefined;
  showingVoiceConfirmation: boolean;
  volumeTarget: number | null;
}
