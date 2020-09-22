// TODO(any): Finish this class (sort out constructor, fix errors etc)
import { EventEmitter } from "../events.ts";
import { Socket } from "../net.ts";

interface AgentOptions {
  path?: string | null;
  keepAliveMsecs?: number;
  keepAlive?: boolean;
  maxSockets?: number;
  maxFreeSockets?: number;
  scheduling?: "fifo" | "lifo";
  maxTotalSockets?: number;
}

interface ListenerOptions {
  host: string;
  port: number;
  socketPath: string;
  family: number;
  localAddress: string;
}

const kRequestOptions = Symbol("requestOptions");
const kOnKeylog = Symbol("onkeylog");
const kRequestAsyncResource = Symbol("requestAsyncResource");
export const asyncIdSymbol = Symbol("async_id"); // TODO(any) What is the value? Here's a link to where it's pulled from: https://github.com/nodejs/node/blob/59ca56eddefc78bab87d7e8e074b3af843ab1bc3/lib/internal/async_hooks.js#L97

// https://github.com/nodejs/node/blob/59ca56eddefc78bab87d7e8e074b3af843ab1bc3/lib/_http_agent.js#L63
class ReusedHandle {
  public type: unknown; // TODO(any) Low priority: Unsure what type this is
  public handle: unknown; // TODO(any) Low priority: What would the type be for `socket._handle`
  constructor(type: unknown, handle: unknown) { // TODO(any) Low priority: Add types, see above
    this.type = type;
    this.handle = handle;
  }
}

export class Agent extends EventEmitter {
  private readonly defaultPort = 80;

  private readonly protocol = "http:";

  private readonly options: AgentOptions;

  /* Requires streams to be typed */
  private requests: any = {}; // todo

  /* Requires streams to be typed */
  private sockets: Map<string, Socket> = []; // todo

  private freeSockets: any = {}; // todo(any): Would this actually be a number? eg free sockets = maxSockets - totalSocketCount

  private readonly keepAliveMsecs: number;

  private readonly keepAlive: boolean;

  private readonly maxSockets: number;

  private readonly maxFreeSockets: number;

  private readonly scheduling: string;

  private readonly maxTotalSockets: number;

  private totalSocketCount = 0;

  private [kOnKeylog]: (any) => void;

  constructor(options: AgentOptions = {}) {
    super(options);

    this.options = { ...options };

    // Don't confuse net and make it think that we're connecting to a pipe
    this.options.path = null;
    this.keepAliveMsecs = options.keepAliveMsecs
      ? options.keepAliveMsecs
      : 1000;
    this.keepAlive = options.keepAlive ? options.keepAlive : false;
    this.maxSockets = options.maxSockets ? options.maxSockets : Infinity;
    this.maxFreeSockets = options.maxFreeSockets ? options.maxFreeSockets : 256;
    this.scheduling = options.scheduling ? options.scheduling : "fifo";
    this.maxTotalSockets = options.maxTotalSockets
      ? options.maxTotalSockets
      : Infinity;

    if (this.maxTotalSockets !== undefined) {
      if (this.maxTotalSockets <= 0) {
        throw new RangeError(
          "maxTotalSockets must be > 0, but instead it is: " +
            this.maxTotalSockets,
        );
      }
    }

    this.on("free", (socket, options: ListenerOptions) => {
      const name = this.getName(options);

      if (!socket.writable) {
        try {
          socket.destroy();
        } catch (err) {
          // do nothing.. socket might have already been destroyed or closed
        }
        return;
      }

      const requests = this.requests[name];
      if (requests && requests.length) {
        const req = requests.shift();
        const reqAsyncRes = req[kRequestAsyncResource];
        if (reqAsyncRes) {
          // Run request within the original async context.
          reqAsyncRes.runInAsyncScope(() => {
            this.asyncResetHandle(socket);
            this.setRequestSocket(req, socket);
          });
          req[kRequestAsyncResource] = null;
        } else {
          this.setRequestSocket(req, socket);
        }
        if (requests.length === 0) {
          delete this.requests[name];
        }
        return;
      }

      // If there are no pending requests, then put it in
      // the freeSockets pool, but only if we're allowed to do so.
      const req = socket._httpMessage;
      if (!req || !req.shouldKeepAlive || !this.keepAlive) {
        socket.destroy();
        return;
      }

      const freeSockets = this.freeSockets[name] || [];
      const freeLen = freeSockets.length;
      let count = freeLen;
      if (this.sockets[name]) {
        count += this.sockets[name].length;
      }

      if (
        this.totalSocketCount > this.maxTotalSockets ||
        count > this.maxSockets ||
        freeLen >= this.maxFreeSockets ||
        !this.keepSocketAlive(socket)
      ) {
        socket.destroy();
        return;
      }

      this.freeSockets[name] = freeSockets;
      socket[asyncIdSymbol] = -1;
      socket._httpMessage = null;
      this.removeSocket(socket, options);

      socket.once("error", this.freeSocketErrorListener);
      freeSockets.push(socket);
    });

    // Don't emit keylog events unless there is a listener for them.
    this.on("newListener", this.maybeEnableKeylog);
  }

  // TODO(any) Add types and docblock
  private setRequestSocket(req, socket) {
    req.onSocket(socket);
    const agentTimeout = this.options.timeout || 0;
    if (req.timeout === undefined || req.timeout === agentTimeout) {
      return;
    }
    socket.setTimeout(req.timeout);
  }

  // TODO(any) complete, and add docblocks
  private keepSocketAlive(socket) {
    socket.setKeepAlive(true, this.keepAliveMsecs);
    socket.unref();

    const agentTimeout = this.options.timeout || 0;
    if (socket.timeout !== agentTimeout) {
      socket.setTimeout(agentTimeout);
    }

    return true;
  } // TODO(any) Add docblock, add type to param

  private asyncResetHandle(socket) {
    // Guard against an uninitialized or user supplied Socket.
    const handle = socket._handle;
    if (handle && typeof handle.asyncReset === "function") {
      // Assign the handle a new asyncId and run any destroy()/init() hooks.
      handle.asyncReset(new ReusedHandle(handle.getProviderType(), handle));
      socket[asyncIdSymbol] = handle.getAsyncId();
    }
  }

  // https://github.com/nodejs/node/blob/fe293e914c3b9a65d2024971ebbefcf8a93dc549/lib/_http_agent.js#L407
  // TODO(any) Copied from Node, just needs adjusting for deno
  private removeSocket(s, options) {
    const name = this.getName(options);
    debug("removeSocket", name, "writable:", s.writable);
    const sets = [this.sockets];

    // If the socket was destroyed, remove it from the free buffers too.
    if (!s.writable) {
      sets.push(this.freeSockets);
    }

    for (const sockets of sets) {
      if (sockets[name]) {
        const index = sockets[name].indexOf(s);
        if (index !== -1) {
          sockets[name].splice(index, 1);
          // Don't leak
          if (sockets[name].length === 0) {
            delete sockets[name];
          }
          this.totalSocketCount--;
        }
      }
    }

    let req;
    if (this.requests[name] && this.requests[name].length) {
      debug("removeSocket, have a request, make a socket");
      req = this.requests[name][0];
    } else {
      // TODO(rickyes): this logic will not be FIFO across origins.
      // There might be older requests in a different origin, but
      // if the origin which releases the socket has pending requests
      // that will be prioritized.
      for (const prop in this.requests) {
        // Check whether this specific origin is already at maxSockets
        if (this.sockets[prop] && this.sockets[prop].length) break;
        debug(
          "removeSocket, have a request with different origin," +
            " make a socket",
        );
        req = this.requests[prop][0];
        options = req[kRequestOptions];
        break;
      }
    }

    if (req && options) {
      req[kRequestOptions] = undefined;
      // If we have pending requests and a socket gets closed make a new one
      this.createSocket(req, options, (err, socket) => {
        if (err) {
          req.onSocket(socket, err);
        } else {
          socket.emit("free");
        }
      });
    }
  }

  // TODO(any) This method was copied word for word. We need to adjust it to fit this implementation. Also need to add docblock
  private freeSocketErrorListener(err) {
    const socket = this;
    debug("SOCKET ERROR on FREE socket:", err.message, err.stack);
    socket.destroy();
    socket.emit("agentRemove");
  }

  /**
   * TODO(any) Unsure how to describe this method
   *
   * @param eventName - Name of the event
   */
  private maybeEnableKeylog(eventName: string): void {
    if (eventName === "keylog") {
      this.off("newListener", this.maybeEnableKeylog);
      // Future sockets will listen on keylog at creation.
      this[kOnKeylog] = function onkeylog(keylog: any) {
        this.emit("keylog", keylog, this);
      };
      // Existing sockets will start listening on keylog now.
      for (const socket of (Object.values(this.sockets) as any[])) { // TODO(change) Maybe need to remove .values, based on how this.sockets is constructed
        socket.on("keylog", this[kOnKeylog]);
      }
    }
  }

  /**
   * Get connection string from the connection configs
   *
   * @param options
   *
   * @returns The connection string
   */
  private getName(options: ListenerOptions): string {
    let name = options.host || "localhost";

    name += ":";
    if (options.port) {
      name += options.port;
    }

    name += ":";
    if (options.localAddress) {
      name += options.localAddress;
    }

    // Pacify parallel/test-http-agent-getname by only appending
    // the ':' when options.family is set.
    if (options.family === 4 || options.family === 6) {
      name += `:${options.family}`;
    }

    if (options.socketPath) {
      name += `:${options.socketPath}`;
    }

    return name;
  }
}

export const globalAgent = new Agent();
