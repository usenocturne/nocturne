const CRC32_POLYNOMIAL = 0xedb88320;

export function crc32(data: Buffer | Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ CRC32_POLYNOMIAL;
      } else {
        crc >>>= 1;
      }
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ChunkEnvelope {
  messageId: string;
  index: number;
  total: number;
  checksum: number;
  payloadLength: number;
  headerLength: number;
}

export function createChunks(
  data: Buffer,
  messageId: string,
  chunkSize = 2000
): Buffer[] {
  const totalChunks = Math.ceil(data.length / chunkSize);
  const chunks: Buffer[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, data.length);
    const payload = data.subarray(start, end);
    const checksum = crc32(payload);

    const idBytes = Buffer.from(messageId, "utf-8");
    const headerLen = 1 + idBytes.length + 2 + 2 + 4 + 2;
    const chunk = Buffer.alloc(headerLen + payload.length);
    let offset = 0;

    chunk.writeUInt8(idBytes.length, offset);
    offset += 1;
    idBytes.copy(chunk, offset);
    offset += idBytes.length;
    chunk.writeUInt16BE(i, offset);
    offset += 2;
    chunk.writeUInt16BE(totalChunks, offset);
    offset += 2;
    chunk.writeUInt32BE(checksum, offset);
    offset += 4;
    chunk.writeUInt16BE(payload.length, offset);
    offset += 2;
    payload.copy(chunk, offset);

    chunks.push(chunk);
  }

  return chunks;
}

export type ChunkParseResult =
  | { status: "success"; envelope: ChunkEnvelope; payload: Buffer; consumed: number }
  | { status: "needMoreData" }
  | { status: "invalid"; reason: string; dropBytes: number };

export function parseChunk(
  buffer: Buffer,
  maxPayloadSize = 4096
): ChunkParseResult {
  if (buffer.length === 0) return { status: "needMoreData" };

  const idLength = buffer[0];
  if (idLength <= 0) return { status: "invalid", reason: "id length is zero", dropBytes: 1 };
  if (idLength > 64)
    return { status: "invalid", reason: `id length ${idLength} exceeds limit`, dropBytes: 1 };

  const headerLength = 1 + idLength + 2 + 2 + 4 + 2;
  if (buffer.length < headerLength) return { status: "needMoreData" };

  const messageId = buffer.subarray(1, 1 + idLength).toString("utf-8");
  if (messageId.length !== idLength)
    return { status: "invalid", reason: "id length mismatch", dropBytes: headerLength };

  if (idLength !== 36 || !isUUIDLike(messageId))
    return { status: "invalid", reason: "unexpected message id format", dropBytes: headerLength };

  const trailerOffset = 1 + idLength;
  const index = buffer.readUInt16BE(trailerOffset);
  const total = buffer.readUInt16BE(trailerOffset + 2);

  if (total === 0)
    return { status: "invalid", reason: "total is zero", dropBytes: headerLength };
  if (total > 1000)
    return { status: "invalid", reason: "total exceeds limit", dropBytes: headerLength };
  if (index >= total)
    return { status: "invalid", reason: `index ${index} out of bounds`, dropBytes: headerLength };

  const checksum = buffer.readUInt32BE(trailerOffset + 4);
  const payloadLength = buffer.readUInt16BE(trailerOffset + 8);

  if (payloadLength > maxPayloadSize)
    return { status: "invalid", reason: `payload too large: ${payloadLength}`, dropBytes: headerLength };

  const totalNeeded = headerLength + payloadLength;
  if (buffer.length < totalNeeded) return { status: "needMoreData" };

  const payload = buffer.subarray(headerLength, headerLength + payloadLength);
  const computedCrc = crc32(payload);
  if (computedCrc !== checksum)
    return { status: "invalid", reason: "checksum mismatch", dropBytes: 1 };

  return {
    status: "success",
    envelope: { messageId, index, total, checksum, payloadLength, headerLength },
    payload: Buffer.from(payload),
    consumed: totalNeeded,
  };
}

function isUUIDLike(value: string): boolean {
  if (value.length !== 36) return false;
  return [8, 13, 18, 23].every((pos) => value[pos] === "-");
}

export class ChunkedMessageAssembler {
  private pending = new Map<string, { total: number; chunks: Map<number, Buffer> }>();

  addChunk(messageId: string, index: number, total: number, payload: Buffer): Buffer | null {
    let msg = this.pending.get(messageId);
    if (!msg) {
      msg = { total, chunks: new Map() };
      this.pending.set(messageId, msg);
    }

    msg.chunks.set(index, payload);

    if (msg.chunks.size === msg.total) {
      this.pending.delete(messageId);
      const parts: Buffer[] = [];
      for (let i = 0; i < msg.total; i++) {
        const chunk = msg.chunks.get(i);
        if (!chunk) return null;
        parts.push(chunk);
      }
      return Buffer.concat(parts);
    }

    return null;
  }

  clear(): void {
    this.pending.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
