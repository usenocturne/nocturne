export type RPCMessageType = "call" | "result" | "error" | "event";

export interface RPCCallMessage {
  type: "call";
  id: string;
  method: string;
  params: unknown;
}

export interface RPCResultMessage {
  type: "result";
  id: string;
  result: unknown;
}

export interface RPCErrorMessage {
  type: "error";
  id: string;
  error: string;
}

export interface RPCEventMessage {
  type: "event";
  topic: string;
  data: unknown;
}

export type RPCMessage =
  | RPCCallMessage
  | RPCResultMessage
  | RPCErrorMessage
  | RPCEventMessage;

export function createCall(
  id: string,
  method: string,
  params: unknown
): RPCCallMessage {
  return { type: "call", id, method, params };
}

export function createResult(id: string, result: unknown): RPCResultMessage {
  return { type: "result", id, result };
}

export function createError(id: string, error: string): RPCErrorMessage {
  return { type: "error", id, error };
}

export function createEvent(topic: string, data: unknown): RPCEventMessage {
  return { type: "event", topic, data };
}
