import { encode as msgpackEncode, decode as msgpackDecode } from "@msgpack/msgpack";
import type { RPCMessage } from "./protocol";

export function encode(msg: RPCMessage): Buffer {
  return Buffer.from(msgpackEncode(msg));
}

export function decode(data: Buffer | Uint8Array): RPCMessage {
  return msgpackDecode(data) as RPCMessage;
}
