// TODO(any) Finish: https://github.com/nodejs/node/blob/c205f672e9cf0c70ea26f87eb97342947a244e18/lib/_http_server.js#L334
import {
  HTTPOptions,
  serve,
  Server as DenoServer,
  ServerRequest,
} from "../../http/server.ts";
import { OutgoingMessage } from "./_http_outgoing";
import {
  checkInvalidHeaderChar,
  chunkExpression,
  CRLF,
  STATUS_CODES,
} from "./_http_common";
import { assert } from "../../testing/asserts";

const observerCounts = internalBinding("performance"); // TODO(any) Figure out what the value assigned is. https://github.com/nodejs/node/blob/a8971f87d3573ac247110e6afde0dc475fe21264/lib/_http_server.js#L81
const kServerResponseStatistics = Symbol("ServerResponseStatistics");
const kOutHeaders = Symbol("kOutHeaders");

function onServerResponseClose() {
  // EventEmitter.emit makes a copy of the 'close' listeners array before
  // calling the listeners. detachSocket() unregisters onServerResponseClose
  // but if detachSocket() is called, directly or indirectly, by a 'close'
  // listener, onServerResponseClose is still in that copy of the listeners
  // array. That is, in the example below, b still gets called even though
  // it's been removed by a:
  //
  //   var EventEmitter = require('events');
  //   var obj = new EventEmitter();
  //   obj.on('event', a);
  //   obj.on('event', b);
  //   function a() { obj.removeListener('event', b) }
  //   function b() { throw "BAM!" }
  //   obj.emit('event');  // throws
  //
  // Ergo, we need to deal with stale 'close' events and handle the case
  // where the ServerResponse object has already been deconstructed.
  // Fortunately, that requires only a single if check. :-)
  if (this._httpMessage) {
    this._httpMessage.destroyed = true;
    this._httpMessage._closed = true;
    this._httpMessage.emit("close");
  }
}

export class Server {
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

export class ServerResponse extends OutgoingMessage {
  public sendDate: boolean = true;
  private _sent100: boolean = false;
  private _expect_continue: boolean = false;
  public statusCode: number = 200;
  public statusMessage: undefined | string = undefined;
  constructor(req) {
    super();
    if (req.method === "HEAD") this._hasBody = false;

    if (req.httpVersionMajor < 1 || req.httpVersionMinor < 1) {
      this.useChunkedEncodingByDefault = chunkExpression.test(req.headers.te);
      this.shouldKeepAlive = false;
    }

    const httpObserverCount = observerCounts[NODE_PERFORMANCE_ENTRY_TYPE_HTTP];
    if (httpObserverCount > 0) {
      this[kServerResponseStatistics] = {
        startTime: process.hrtime(), // TODO(any) Find a deno replacement for this. `process.hrtime()` returns the following: `[<seconds>, <nanoseconds>]`
      };
    }
  }

  // renamed from _finish to finish, as OutgoingMessage already has a method named _finish (but with slightly differennt logic
  private finish() {
    DTRACE_HTTP_SERVER_RESPONSE(this.socket);
    if (this[kServerResponseStatistics] !== undefined) {
      emitStatistics(this[kServerResponseStatistics]);
    }
    this._finish();
  }

  public assignSocket(socket) {
    assert(!socket._httpMessage);
    socket._httpMessage = this;
    socket.on("close", onServerResponseClose);
    this.socket = socket;
    this.emit("socket", socket);
    this._flush();
  }

  public detachSocket(socket) {
    assert(socket._httpMessage === this);
    socket.removeListener("close", onServerResponseClose);
    socket._httpMessage = null;
    this.socket = null;
  }

  public writeContinue(cb: (err?: Error) => void) {
    this._writeRaw(`HTTP/1.1 100 Continue${CRLF}${CRLF}`, "ascii", cb);
    this._sent100 = true;
  }

  public writeProcessing(cb: (err?: Error) => void) {
    this._writeRaw(`HTTP/1.1 102 Processing${CRLF}${CRLF}`, "ascii", cb);
  }

  private _implicitHeader() {
    this.writeHead(this.statusCode);
  }

  public writeHead(
    statusCode: number,
    reason?: string | { [key: string]: string },
    obj?: { [key: string]: string },
  ) {
    const originalStatusCode = statusCode;

    statusCode |= 0;
    if (statusCode < 100 || statusCode > 999) {
      throw new ERR_HTTP_INVALID_STATUS_CODE(originalStatusCode);
    }

    if (typeof reason === "string") {
      // writeHead(statusCode, reasonPhrase[, headers])
      this.statusMessage = reason;
    } else {
      // writeHead(statusCode[, headers])
      if (!this.statusMessage) {
        this.statusMessage = STATUS_CODES[statusCode] || "unknown";
      }
      obj = reason;
    }
    this.statusCode = statusCode;

    let headers;
    if (this[kOutHeaders]) {
      // Slow-case: when progressive API and header fields are passed.
      let k;
      if (obj) {
        const keys = Object.keys(obj);
        // Retain for(;;) loop for performance reasons
        // Refs: https://github.com/nodejs/node/pull/30958
        for (let i = 0; i < keys.length; i++) {
          k = keys[i];
          if (k) this.setHeader(k, obj[k]);
        }
      }
      if (k === undefined && this._header) {
        throw new ERR_HTTP_HEADERS_SENT("render");
      }
      // Only progressive api is used
      headers = this[kOutHeaders];
    } else {
      // Only writeHead() called
      headers = obj;
    }

    if (checkInvalidHeaderChar(this.statusMessage)) {
      throw new ERR_INVALID_CHAR("statusMessage");
    }

    const statusLine = `HTTP/1.1 ${statusCode} ${this.statusMessage}${CRLF}`;

    if (
      statusCode === 204 || statusCode === 304 ||
      (statusCode >= 100 && statusCode <= 199)
    ) {
      // RFC 2616, 10.2.5:
      // The 204 response MUST NOT include a message-body, and thus is always
      // terminated by the first empty line after the header fields.
      // RFC 2616, 10.3.5:
      // The 304 response MUST NOT contain a message-body, and thus is always
      // terminated by the first empty line after the header fields.
      // RFC 2616, 10.1 Informational 1xx:
      // This class of status code indicates a provisional response,
      // consisting only of the Status-Line and optional headers, and is
      // terminated by an empty line.
      this._hasBody = false;
    }

    // Don't keep alive connections where the client expects 100 Continue
    // but we sent a final status; they may put extra bytes on the wire.
    if (this._expect_continue && !this._sent100) {
      this.shouldKeepAlive = false;
    }

    this._storeHeader(statusLine, headers);

    return this;
  }

  public writeHeader(statusCode, reason, obj) {
    this.writeHead(statusCode, reason, obj);
  }
}
