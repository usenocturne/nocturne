import { dlopen, ptr } from "bun:ffi";
import { read as fsRead, writeSync, closeSync } from "fs";
import { createLogger } from "../utils/logger";

const log = createLogger("RFCOMMClient");

const AF_BLUETOOTH = 31;
const SOCK_STREAM = 1;
const BTPROTO_RFCOMM = 3;

const libc = dlopen("libc.so.6", {
  socket: { args: ["i32", "i32", "i32"], returns: "i32" },
  connect: { args: ["i32", "ptr", "i32"], returns: "i32" },
  close: { args: ["i32"], returns: "i32" },
});

function parseAddress(address: string): Uint8Array {
  const sockaddr = new Uint8Array(10);
  new DataView(sockaddr.buffer).setUint16(0, AF_BLUETOOTH, true);
  const parts = address.split(":").map((h) => parseInt(h, 16));
  for (let i = 0; i < 6; i++) sockaddr[2 + i] = parts[5 - i];
  return sockaddr;
}

export type ClientDataHandler = (data: Buffer) => void;
export type ClientDisconnectHandler = () => void;

export class RFCOMMClient {
  private fd: number = -1;
  private onData: ClientDataHandler | null = null;
  private onDisconnect: ClientDisconnectHandler | null = null;
  private _connected = false;
  private _address = "";
  private _generation = 0;

  setDataHandler(handler: ClientDataHandler): void {
    this.onData = handler;
  }

  setDisconnectHandler(handler: ClientDisconnectHandler): void {
    this.onDisconnect = handler;
  }

  get connected(): boolean {
    return this._connected;
  }

  get address(): string {
    return this._address;
  }

  async connect(address: string, channel?: number): Promise<void> {
    if (this._connected) {
      log.warn("Already connected, disconnecting first");
      this.disconnect();
    }

    this._generation++;
    const targetChannel = channel ?? 2;
    this._address = address;

    log.info(`Connecting RFCOMM to ${address} channel ${targetChannel}`);

    const fd = libc.symbols.socket(AF_BLUETOOTH, SOCK_STREAM, BTPROTO_RFCOMM);
    if (fd < 0) {
      throw new Error(`Failed to create Bluetooth socket (returned ${fd})`);
    }

    const sockaddr = parseAddress(address);
    sockaddr[8] = targetChannel;

    const ret = libc.symbols.connect(fd, ptr(sockaddr), 10);
    if (ret < 0) {
      libc.symbols.close(fd);
      throw new Error(`RFCOMM connect to ${address} channel ${targetChannel} failed (returned ${ret})`);
    }

    this.fd = fd;
    this._connected = true;
    log.info(`RFCOMM connected to ${address} channel ${targetChannel}, fd=${fd}`);

    this.startReadLoop(fd);
  }

  private startReadLoop(fd: number): void {
    const gen = this._generation;
    const buf = Buffer.alloc(4096);

    const doRead = () => {
      if (gen !== this._generation) return;

      fsRead(fd, buf, 0, buf.length, null, (err, bytesRead) => {
        if (gen !== this._generation) return;

        if (err) {
          log.warn(`RFCOMM read error for ${this._address}: ${err.message}`);
          this._connected = false;
          this.fd = -1;
          this.onDisconnect?.();
          return;
        }

        if (!bytesRead) {
          log.info(`RFCOMM read loop ended for ${this._address}`);
          this._connected = false;
          this.fd = -1;
          this.onDisconnect?.();
          return;
        }

        this.onData?.(Buffer.from(buf.subarray(0, bytesRead)));
        doRead();
      });
    };

    doRead();
  }

  write(data: Buffer | Uint8Array): void {
    if (this.fd < 0 || !this._connected) {
      throw new Error("Not connected");
    }
    writeSync(this.fd, data);
  }

  disconnect(): void {
    if (this.fd >= 0) {
      try {
        closeSync(this.fd);
      } catch {}
      this.fd = -1;
    }
    this._connected = false;
  }
}
