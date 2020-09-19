// TODO(any): Make this file scalable for HTTPS, so abstract most of the logic into a separate file (./_util/ or ./_http/ ?)

import {
  ServerRequest,
  serve,
  Server as DenoServer,
} from "../http/server.ts";
import { Server } from "./_http/_http_server.ts"
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
import { Socket } from "./net.ts"
import {NetAgent} from "./_http/net_agent.ts";
import {Agent} from "./_http/_http_agent";
import {ClientRequest} from "./_http/_http_client";
import {IncomingMessage} from "./_http/_http_incoming.ts";

const tokenRegExp = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/;
const headerCharRegex = /[^\t\x20-\x7e\x80-\xff]/;

//TODO:Soremwar
//NodeJS allows to set this property through a cli option
//Find a way to mimic this behavior
const MAX_HEADER_SIZE = 80 * 1024;

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
  public getHeader(name: string): string {
    return this.headers.get(name.toLowerCase());
  }

  public getHeaderNames(): string[] {
    return Array.from(this.headers.keys());
  }

  public getHeaders(): { [name: string]: string } {
    return Object.fromEntries(this.headers);
  }

  public hasHeader(name: string): boolean {
    return this.headers.has(name.toLowerCase());
  }

  public removeHeader(name: string): void {
    this.headers.delete(name.toLowerCase());
  }

  public setHeader(name: string, value: string): void {
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
    chunk: string | Deno.Buffer,
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

export class Http extends NetAgent {
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

  public IncomingMessage(socket: Socket): IncomingMessage { // TODO(any): Finish content, return and param types
    return new IncomingMessage(socket)
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
