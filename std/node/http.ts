// TODO(any): Make this file scalable for HTTPS, so abstract most of the logic into a separate file (./_util/ or ./_http/ ?)

import {
  ServerRequest,
} from "../http/server.ts";
import { Server, ServerResponse } from "./_http/_http_server.ts";
import type {
  HTTPOptions,
} from "../http/server.ts";
import type { Socket } from "./net.ts";
import { Socket } from "./net.ts";
import { NetAgent } from "./_http/net_agent.ts";
import { Agent } from "./_http/_http_agent";
import { IncomingMessage } from "./_http/_http_incoming.ts";
import { OutgoingMessage } from "./_http/_http_outgoing";
import { checkInvalidHeaderChar, STATUS_CODES } from "./_http/_http_common";

const tokenRegExp = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/;

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

  public IncomingMessage(socket: Socket): IncomingMessage {
    return new IncomingMessage(socket);
  }

  public OutgoingMessage(): OutgoingMessage {
    return new OutgoingMessage();
  }

  /**
   * https://github.com/nodejs/node/blob/c205f672e9cf0c70ea26f87eb97342947a244e18/lib/_http_server.js#L334
   */
  public Server(
    options: HTTPOptions,
    requestListener: (req: ServerRequest, res: Response) => void,
  ): Server {
    return new Server(options, requestListener);
  }

  public ServerResponse(request: ServerRequest): ServerResponse {
    return new ServerResponse(request);
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
  public createServer(
    options: HTTPOptions | ((req: ServerRequest, res: Response) => void),
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
    if (checkInvalidHeaderChar(value)) {
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
}
