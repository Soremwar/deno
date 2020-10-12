import type { Buffer } from "https://deno.land/std@0.69.0/node/buffer.ts";
import { EventEmitter } from "https://deno.land/std@0.69.0/node/events.ts";

interface ConnectOptions {
  /**
  * If specified, incoming data is stored in a single buffer and passed to the supplied callback when data arrives on the socket
  */
  onRead?: {
    buffer: Buffer | Uint8Array | (() => Buffer | Uint8Array);
    /**
     * This function is called for every chunk of incoming data
     * 
     * Return false to `pause()` the socket
     * */
    callback: (nread: number, buf: Buffer) => false | undefined;
  };
}

interface IPCConnectOptions extends ConnectOptions {
  path?: string;
}

interface LookupOptions {
  family?: number;
  hints?: number;
  all?: boolean;
  verbatim?: boolean;
}

interface LookupOneOptions extends LookupOptions {
  all?: false;
}

type LookupFunction = (
  hostname: string,
  options: LookupOneOptions,
  callback: (err: Error, address: string, family: number) => void,
) => void;

interface TCPConnectOptions extends ConnectOptions {
  port: number;
  host: string;
  localAddress: string;
  localPort: number;
  family: number;
  hints: number;
  lookup: LookupFunction;
}

export default class Socket extends EventEmitter {
  public bytesRead = 0;
  public bytesWritten = 0;
  public connecting = false;
  public destroyed = false;
  public localAddress: string;
  public localPort: number;
  public pending = false;
  public remoteAddress?: string;
  public remoteFamily?: string;
  public remotePort?: number;

  constructor(
    fd: number,
    allowHalfOpen: boolean,
    readable: true,
    writable: true,
  ) {
    super();
    this.addListener("close", function close() {});
    this.addListener("connect", function connect() {});
    this.addListener("data", function data() {});
    this.addListener("drain", function drain() {});
    this.addListener("end", function end() {});
    this.addListener("error", function error() {});
    this.addListener("lookup", function close() {});
    this.addListener("ready", function ready() {});
    this.addListener("timeout", function timeout() {});

    //TODO
    //This should be the IP of the person using the socket
    this.localAddress = "0.0.0.0";
    //TODO
    //This should be the port of the person using the socket
    this.localPort = 8000;
  }

  //TODO
  //Returns address, family and
  address() {
    return {
      address: "127.0.0.1",
      family: "IPv4",
      port: 12346,
    };
  }

  connect(
    options: TCPConnectOptions | IPCConnectOptions,
    connectionListener?: () => void,
  ): this;
  /** Connect through IPC */
  connect(path: string, connectionListener?: () => void): this;
  /** Connect through TCP */
  connect(port: number, host: string, connectionListener?: () => void): this;

  connect(
    x: TCPConnectOptions | IPCConnectOptions | string | number,
    y?: string | (() => void),
    z?: () => void,
  ) {
    //TODO
    //Do something with all this
    return this;
  }

  destroy(err?: Error) {
    //TODO
    //Burn it all
    return this;
  }

  end(callback?: () => void): void;
  end(buffer: Uint8Array | string, callback?: () => void): void;
  //TODO
  //encoding should be the available encodings for the buffer
  //not just any string
  end(string: Uint8Array | string, encoding?: string, cb?: () => void): void;

  /** Half-closes the socket */
  end(
    x?: Uint8Array | string | (() => void),
    y?: string | (() => void),
    z?: () => void,
  ) {
    //TODO
    //Anything
  }

  ref() {
    return this;
  }

  resume() {
    return this;
  }

  //TODO
  //encoding should be the available encodings for the buffer
  //not just any string
  setEncoding(encoding: string) {
    return this;
  }

  setKeepAlive(enable = false, initial_delay = 0) {
    return this;
  }

  setNoDelay(no_delay = true) {
    return this;
  }

  setTimeout(timeout: number, callback?: () => void) {
    return this;
  }

  unref() {
    return this;
  }

  write(buffer: Uint8Array | string, cb?: (err?: Error) => void): boolean;
  write(
    str: Uint8Array | string,
    encoding?: string,
    cb?: (err?: Error) => void,
  ): boolean;

  write(
    x: Buffer | Uint8Array | string,
    y?: string | ((err?: Error) => void),
  ): boolean {
    return false;
  }
}
