// TODO(any): Make this file scalable for HTTPS, so abstract most of the logic into a separate file (./_util/ or ./_http/ ?)

import {
  ServerRequest,
  serve,
  Server as DenoServer,
} from "../http/server.ts";
import type {
  HTTPOptions,
} from "../http/server.ts";
import {
  EventEmitter,
} from "./events.ts";
import type {
  Buffer,
} from "./buffer.ts";
import type { Socket } from "./net.ts";

const kOnKeylog = Symbol("onkeylog");
const kRequestOptions = Symbol("requestOptions");
const kRequestAsyncResource = Symbol("requestAsyncResource");
const asyncIdSymbol = Symbol("async_id"); // TODO(any) What is the value? Here's a link to where it's pulled from: https://github.com/nodejs/node/blob/59ca56eddefc78bab87d7e8e074b3af843ab1bc3/lib/internal/async_hooks.js#L97

const tokenRegExp = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/;
const headerCharRegex = /[^\t\x20-\x7e\x80-\xff]/;

//TODO:Soremwar
//NodeJS allows to set this property through a cli option
//Find a way to mimic this behavior
const MAX_HEADER_SIZE = 80 * 1024;

// https://github.com/nodejs/node/blob/59ca56eddefc78bab87d7e8e074b3af843ab1bc3/lib/_http_agent.js#L63
class ReusedHandle {
  public type: unknown; // TODO(any) Low priority: Unsure what type this is
  public handle: unknown; // TODO(any) Low priority: What would the type be for `socket._handle`
  constructor(type: unknown, handle: unknown) { // TODO(any) Low priority: Add types, see above
    this.type = type;
    this.handle = handle;
  }
}

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

// TODO(any): Finish this class (sort out constructor, fix errors etc)
class Agent extends EventEmitter {
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

const globalAgent = new Agent();

class Response {
  private headers: Headers;
  //TODO
  //Do something with this
  public headersSent = false;
  private request: ServerRequest;
  //TODO
  //This should add the date header when true
  public sendDate = true;
  //TODO
  //This should be a duplex stream or stream equivalent
  public socket: any = null;
  public statusCode = 200;
  public statusMessage?: string;
  public writableEnded = false;
  public writableFinished = false;

  constructor(request: ServerRequest) {
    this.headers = new Headers();
    this.request = request;
  }

  //TODO
  //Header types must have a type specified somewhere
  public getHeader(name: string): any {
    return this.headers.get(name.toLowerCase());
  }

  public getHeaderNames() {
    return Array.from(this.headers.keys());
  }

  public getHeaders(): { [name: string]: any } {
    return Object.fromEntries(this.headers);
  }

  public hasHeader(name: string): boolean {
    return this.headers.has(name.toLowerCase());
  }

  public removeHeader(name: string): void {
    this.headers.delete(name.toLowerCase());
  }

  public setHeader(name: string, value: any): void {
    this.headers.append(name, value);
  }

  //TODO
  //This should set a timeout for the sockets
  //If a callback is provided, it will be executed when the sockets timeout
  public setTimeout(
    msecs: number,
    callback?: () => void,
  ): Response {
    return this;
  }

  public uncork() {
    throw new Error("Not implemented");
  }

  //TODO
  //This will stream the provided chunk by bits
  //Callback will be called when the provided chunk is emitted
  public write(
    chunk: string | Buffer,
    encoding = "utf8",
    callback: () => void,
  ): boolean {
    // TODO
    // This should only return true when the last bit of data was streamed
    return true;
  }

  //TODO
  //Sends a {100, CONTINUE} signal to the client
  public writeContinue(): void {
    throw new Error("Not implemented");
  }

  //TODO
  //Sends a response header to the client
  //Headers should be merged with this.headers
  public writeHead(): Response {
    return this;
  }

  //TODO
  //Sends a {102, Processing} signal to the client
  public writeProcessing(): void {
    throw new Error("Not implemented");
  }
}

// TODO(any) Finish: https://github.com/nodejs/node/blob/c205f672e9cf0c70ea26f87eb97342947a244e18/lib/_http_server.js#L334
class Server {
  private readonly request_listener: (
    req: ServerRequest,
    res: Response,
  ) => void;

  private server: DenoServer;

  public options: HTTPOptions;

  constructor(
    options: HTTPOptions | ((req: ServerRequest, res: Response) => void),
    requestListener?: (req: ServerRequest, res: Response) => void,
  ) {
    if (typeof options === "function") {
      this.request_listener = options;
      this.options = {};
    } else {
      this.request_listener = requestListener;
      this.options = options;
    }
  }

  public async listen(address: string | HTTPOptions) {
    this.server = serve(address);
    await this._listen();
  }

  private async _listen() {
    try {
      for await (const request of this.server) {
        const response = new Response(request);
        this.request_listener(request as ServerRequest, response);
      }
    } catch (e) {
      this.server.close();
    }
  }
}

const STATUS_CODES = {
  100: "Continue", // RFC 7231 6.2.1
  101: "Switching Protocols", // RFC 7231 6.2.2
  102: "Processing", // RFC 2518 10.1 (obsoleted by RFC 4918)
  103: "Early Hints", // RFC 8297 2
  200: "OK", // RFC 7231 6.3.1
  201: "Created", // RFC 7231 6.3.2
  202: "Accepted", // RFC 7231 6.3.3
  203: "Non-Authoritative Information", // RFC 7231 6.3.4
  204: "No Content", // RFC 7231 6.3.5
  205: "Reset Content", // RFC 7231 6.3.6
  206: "Partial Content", // RFC 7233 4.1
  207: "Multi-Status", // RFC 4918 11.1
  208: "Already Reported", // RFC 5842 7.1
  226: "IM Used", // RFC 3229 10.4.1
  300: "Multiple Choices", // RFC 7231 6.4.1
  301: "Moved Permanently", // RFC 7231 6.4.2
  302: "Found", // RFC 7231 6.4.3
  303: "See Other", // RFC 7231 6.4.4
  304: "Not Modified", // RFC 7232 4.1
  305: "Use Proxy", // RFC 7231 6.4.5
  307: "Temporary Redirect", // RFC 7231 6.4.7
  308: "Permanent Redirect", // RFC 7238 3
  400: "Bad Request", // RFC 7231 6.5.1
  401: "Unauthorized", // RFC 7235 3.1
  402: "Payment Required", // RFC 7231 6.5.2
  403: "Forbidden", // RFC 7231 6.5.3
  404: "Not Found", // RFC 7231 6.5.4
  405: "Method Not Allowed", // RFC 7231 6.5.5
  406: "Not Acceptable", // RFC 7231 6.5.6
  407: "Proxy Authentication Required", // RFC 7235 3.2
  408: "Request Timeout", // RFC 7231 6.5.7
  409: "Conflict", // RFC 7231 6.5.8
  410: "Gone", // RFC 7231 6.5.9
  411: "Length Required", // RFC 7231 6.5.10
  412: "Precondition Failed", // RFC 7232 4.2
  413: "Payload Too Large", // RFC 7231 6.5.11
  414: "URI Too Long", // RFC 7231 6.5.12
  415: "Unsupported Media Type", // RFC 7231 6.5.13
  416: "Range Not Satisfiable", // RFC 7233 4.4
  417: "Expectation Failed", // RFC 7231 6.5.14
  418: "I'm a Teapot", // RFC 7168 2.3.3
  421: "Misdirected Request", // RFC 7540 9.1.2
  422: "Unprocessable Entity", // RFC 4918 11.2
  423: "Locked", // RFC 4918 11.3
  424: "Failed Dependency", // RFC 4918 11.4
  425: "Too Early", // RFC 8470 5.2
  426: "Upgrade Required", // RFC 2817 and RFC 7231 6.5.15
  428: "Precondition Required", // RFC 6585 3
  429: "Too Many Requests", // RFC 6585 4
  431: "Request Header Fields Too Large", // RFC 6585 5
  451: "Unavailable For Legal Reasons", // RFC 7725 3
  500: "Internal Server Error", // RFC 7231 6.6.1
  501: "Not Implemented", // RFC 7231 6.6.2
  502: "Bad Gateway", // RFC 7231 6.6.3
  503: "Service Unavailable", // RFC 7231 6.6.4
  504: "Gateway Timeout", // RFC 7231 6.6.5
  505: "HTTP Version Not Supported", // RFC 7231 6.6.6
  506: "Variant Also Negotiates", // RFC 2295 8.1
  507: "Insufficient Storage", // RFC 4918 11.5
  508: "Loop Detected", // RFC 5842 7.2
  509: "Bandwidth Limit Exceeded",
  510: "Not Extended", // RFC 2774 7
  511: "Network Authentication Required", // RFC 6585 6
};

export class Http {
  public METHODS = [
    "ACL",
    "BIND",
    "CHECKOUT",
    "CONNECT",
    "COPY",
    "DELETE",
    "GET",
    "HEAD",
    "LINK",
    "LOCK",
    "M-SEARCH",
    "MERGE",
    "MKACTIVITY",
    "MKCALENDAR",
    "MKCOL",
    "MOVE",
    "NOTIFY",
    "OPTIONS",
    "PATCH",
    "POST",
    "PROPFIND",
    "PROPPATCH",
    "PURGE",
    "PUT",
    "REBIND",
    "REPORT",
    "SEARCH",
    "SOURCE",
    "SUBSCRIBE",
    "TRACE",
    "UNBIND",
    "UNLINK",
    "UNLOCK",
    "UNSUBSCRIBE",
  ];

  public STATUS_CODES: { [key: string]: string } = STATUS_CODES;

  private _maxHeaderSize?: number;

  private _globalAgent: Agent = globalAgent;

  public Agent(options: AgentOptions): Agent {
    return new Agent(options);
  }

  // TODO https://github.com/nodejs/node/blob/c205f672e9cf0c70ea26f87eb97342947a244e18/lib/_http_client.js#L88
  public ClientRequest(input, options, cb) { // TODO(any): Finish content, return and param types
  }

  public IncomingMessage() { // TODO(any): Finish content, return and param types
  }

  public OutgoingMessage() { // TODO(any): Finish content, return and param types
  }

  /**
   * https://github.com/nodejs/node/blob/c205f672e9cf0c70ea26f87eb97342947a244e18/lib/_http_server.js#L334
   *
   */
  public Server(
    options: HTTPOptions,
    requestListener: (req: ServerRequest, res: Response) => void,
  ): Server {
    return new Server(options, requestListener);
  }

  public ServerResponse(request: ServerRequest) { // TODO(any): Finish content, return and param types
  }

  /**
   * Create a HTTP server
   *
   *      const server = Http.createServer(...)
   *      for await (const req of server) {
   *        ...
   *      }
   *
   * @param options - Configs to start the server on
   * @param requestListener - Callback for when a request is made
   */
  public createServer(options: HTTPOptions | ((req: ServerRequest, res: Response) => void),
    requestListener: (req: ServerRequest, res: Response) => void,
  ): Server {
    return new Server(options, requestListener);
  }

  public validateHeaderName(name: string): void {
    if (typeof name !== "string" || !name || !this.checkIsHttpToken(name)) {
      throw new Error("Invalid header name: " + name);
    }
  }

  public validateHeaderValue(name: string, value: string): void {
    if (value === undefined) {
      throw new Error(`Invalid header value: ${value}=${name}`);
    }
    if (this.checkInvalidHeaderChar(value)) {
      throw new Error(`Invalid header value: ${value}=${name}`);
    }
  }

  public async get(url: string, options: RequestInit): Promise<Response> {
    const response = await this.request(url, options);
    return response;
  }

  public async request(url: string, options: RequestInit): Promise<Response> {
    return await fetch(url, options);
  }

  get maxHeaderSize(): number {
    if (this._maxHeaderSize === undefined) {
      this._maxHeaderSize = MAX_HEADER_SIZE;
    }
    return this._maxHeaderSize;
  }

  get globalAgent() {
    return this._globalAgent;
  }

  set globalAgent(value: Agent) {
    this._globalAgent = value;
  }

  /**
   * Verifies that the given val is a valid HTTP token
   * per the rules defined in RFC 7230
   * See https://tools.ietf.org/html/rfc7230#section-3.2.6
   */
  private checkIsHttpToken(val: string): boolean {
    return tokenRegExp.test(val);
  }

  /**
   * True if val contains an invalid field-vchar
   *  field-value    = *( field-content / obs-fold )
   *  field-content  = field-vchar [ 1*( SP / HTAB ) field-vchar ]
   *  field-vchar    = VCHAR / obs-text
   */
  private checkInvalidHeaderChar(val: string): boolean {
    return headerCharRegex.test(val);
  }
}
