import { randomUUID } from "crypto";
import { encode, decode } from "./msgpack-codec";
import { createChunks, parseChunk, ChunkedMessageAssembler, crc32 } from "./chunking";
import type { RPCMessage, RPCCallMessage, RPCResultMessage, RPCErrorMessage, RPCEventMessage } from "./protocol";
import { createResult, createError, createEvent } from "./protocol";
import { createLogger } from "../utils/logger";

const log = createLogger("RPCClient");

export interface RPCClientDelegate {
  onCall(id: string, method: string, params: unknown): Promise<{ result?: unknown; error?: string }>;
  onEvent(topic: string, data: unknown): void;
  onError(error: Error): void;
  onDisconnect(): void;
}

export type WireFormat = "chunked" | "base64-newline" | "raw";

export class RPCClient {
  private socket: { write(data: Buffer | Uint8Array): void; end(): void } | null = null;
  private delegate: RPCClientDelegate | null = null;
  private pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  private inputBuffer = Buffer.alloc(0);
  private assembler = new ChunkedMessageAssembler();
  private sentChunks = new Map<string, Map<number, Buffer>>();
  private sendMutexQueue: (() => void)[] = [];
  private sendMutexLocked = false;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private connectionId: string;
  private wireFormat: WireFormat;

  constructor(connectionId: string, wireFormat: WireFormat = "chunked") {
    this.connectionId = connectionId;
    this.wireFormat = wireFormat;
    this.cleanupInterval = setInterval(() => this.periodicCleanup(), 30000);
  }

  get id(): string {
    return this.connectionId;
  }

  setSocket(socket: { write(data: Buffer | Uint8Array): void; end(): void }): void {
    this.socket = socket;
  }

  setDelegate(delegate: RPCClientDelegate): void {
    this.delegate = delegate;
  }

  async handleIncomingData(data: Buffer): Promise<void> {
    this.inputBuffer = Buffer.concat([this.inputBuffer, data]);
    await this.processInputBuffer();
  }

  private async processInputBuffer(): Promise<void> {
    if (this.wireFormat === "base64-newline") {
      await this.processBase64Lines();
    } else {
      await this.processChunked();
    }
  }

  private async processBase64Lines(): Promise<void> {
    while (true) {
      const newlineIdx = this.inputBuffer.indexOf(0x0a);
      if (newlineIdx === -1) break;

      const line = this.inputBuffer.subarray(0, newlineIdx).toString("utf-8").trim();
      this.inputBuffer = this.inputBuffer.subarray(newlineIdx + 1);

      if (!line) continue;

      let decoded: Buffer;
      try {
        decoded = Buffer.from(line, "base64");
      } catch {
        log.warn(`Invalid base64 line (${line.length} chars)`);
        continue;
      }

      try {
        const msg = decode(decoded);
        await this.handleMessage(msg);
        continue;
      } catch {
      }

      const result = parseChunk(decoded);
      if (result.status === "success") {
        if (result.envelope.total === 1) {
          try {
            const msg = decode(result.payload);
            await this.handleMessage(msg);
          } catch (err) {
            log.error(`Failed to decode chunk payload: ${err}`);
          }
        } else {
          const assembled = this.assembler.addChunk(
            result.envelope.messageId,
            result.envelope.index,
            result.envelope.total,
            result.payload
          );
          if (assembled) {
            try {
              const msg = decode(assembled);
              await this.handleMessage(msg);
            } catch (err) {
              log.error(`Failed to decode assembled message: ${err}`);
            }
          }
        }
      } else {
        log.warn(`Failed to parse base64 line (${decoded.length} bytes): not MsgPack or chunk`);
      }
    }
  }

  private async processChunked(): Promise<void> {
    while (this.inputBuffer.length > 0) {
      try {
        const msg = decode(this.inputBuffer);
        this.inputBuffer = Buffer.alloc(0);
        await this.handleMessage(msg);
        continue;
      } catch {
      }

      const result = parseChunk(this.inputBuffer);

      if (result.status === "needMoreData") break;

      if (result.status === "invalid") {
        const drop = Math.min(Math.max(result.dropBytes, 1), this.inputBuffer.length);
        this.inputBuffer = this.inputBuffer.subarray(drop);
        log.warn(`Discarding invalid chunk (dropped ${drop} bytes): ${result.reason}`);
        continue;
      }

      this.inputBuffer = this.inputBuffer.subarray(result.consumed);

      if (result.envelope.total === 1) {
        try {
          const msg = decode(result.payload);
          await this.handleMessage(msg);
        } catch (err) {
          log.error(`Failed to decode message: ${err}`);
        }
      } else {
        const assembled = this.assembler.addChunk(
          result.envelope.messageId,
          result.envelope.index,
          result.envelope.total,
          result.payload
        );
        if (assembled) {
          try {
            const msg = decode(assembled);
            await this.handleMessage(msg);
          } catch (err) {
            log.error(`Failed to decode assembled message: ${err}`);
          }
        }
      }
    }
  }

  private async handleMessage(msg: RPCMessage): Promise<void> {
    switch (msg.type) {
      case "result": {
        const m = msg as RPCResultMessage;
        const pending = this.pendingRequests.get(m.id);
        if (pending) {
          this.pendingRequests.delete(m.id);
          clearTimeout(pending.timeout);
          pending.resolve(m.result);
        }
        break;
      }
      case "error": {
        const m = msg as RPCErrorMessage;
        const pending = this.pendingRequests.get(m.id);
        if (pending) {
          this.pendingRequests.delete(m.id);
          clearTimeout(pending.timeout);
          pending.reject(new Error(m.error));
        }
        break;
      }
      case "event": {
        const m = msg as RPCEventMessage;
        this.delegate?.onEvent(m.topic, m.data);
        break;
      }
      case "call": {
        const m = msg as RPCCallMessage;
        if (this.delegate) {
          const response = await this.delegate.onCall(m.id, m.method, m.params);
          if (response.error) {
            await this.sendMessage(createError(m.id, response.error));
          } else {
            await this.sendMessage(createResult(m.id, response.result));
          }
        } else {
          await this.sendMessage(createError(m.id, "No handler available"));
        }
        break;
      }
    }
  }

  async call(method: string, params: unknown, timeoutMs = 30000): Promise<unknown> {
    const id = randomUUID();
    const msg: RPCCallMessage = { type: "call", id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC call timeout: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.sendMessage(msg).catch((err) => {
        this.pendingRequests.delete(id);
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  async sendEvent(topic: string, data: unknown): Promise<void> {
    await this.sendMessage(createEvent(topic, data));
  }

  private async sendMessage(msg: RPCMessage): Promise<void> {
    const messageId = (msg as any).id || randomUUID();
    const encoded = encode(msg);
    if (this.wireFormat === "base64-newline") {
      const chunks = createChunks(encoded, messageId);
      for (const chunk of chunks) {
        const b64 = chunk.toString("base64") + "\n";
        this.writeToSocket(Buffer.from(b64));
      }
    } else if (this.wireFormat === "raw") {
      this.writeToSocket(encoded);
    } else {
      await this.sendChunked(encoded, messageId);
    }
  }

  private async sendChunked(data: Buffer, messageId: string): Promise<void> {
    await this.acquireMutex();
    try {
      const chunks = createChunks(data, messageId);

      const chunkMap = new Map<number, Buffer>();
      chunks.forEach((chunk, i) => chunkMap.set(i, chunk));
      this.sentChunks.set(messageId, chunkMap);

      for (let i = 0; i < chunks.length; i++) {
        this.writeToSocket(chunks[i]);
        if (i < chunks.length - 1) {
          await new Promise((r) => setTimeout(r, 5));
        }
      }
    } finally {
      this.releaseMutex();
    }
  }

  async retransmitChunk(messageId: string, chunkIndex: number): Promise<void> {
    const chunks = this.sentChunks.get(messageId);
    const chunk = chunks?.get(chunkIndex);
    if (!chunk) {
      log.error(`Cannot retransmit chunk ${chunkIndex} for ${messageId}: not found`);
      return;
    }
    log.warn(`Retransmitting chunk ${chunkIndex + 1} for ${messageId}`);
    this.writeToSocket(chunk);
  }

  private writeToSocket(data: Buffer): void {
    if (!this.socket) {
      log.warn("Write attempted on closed connection, dropping");
      return;
    }
    this.socket.write(data);
  }

  private async acquireMutex(): Promise<void> {
    if (!this.sendMutexLocked) {
      this.sendMutexLocked = true;
      return;
    }
    return new Promise((resolve) => {
      this.sendMutexQueue.push(resolve);
    });
  }

  private releaseMutex(): void {
    const next = this.sendMutexQueue.shift();
    if (next) {
      next();
    } else {
      this.sendMutexLocked = false;
    }
  }

  private periodicCleanup(): void {
    if (this.sentChunks.size > 10) {
      const keys = Array.from(this.sentChunks.keys());
      const toRemove = keys.slice(0, keys.length - 5);
      for (const key of toRemove) {
        this.sentChunks.delete(key);
      }
    }
    if (this.assembler.pendingCount > 5) {
      this.assembler.clear();
      log.warn("Cleared stale pending chunks");
    }
  }

  cleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Connection closed"));
    }
    this.pendingRequests.clear();
    this.inputBuffer = Buffer.alloc(0);
    this.assembler.clear();
    this.sentChunks.clear();
    this.socket = null;
  }
}
