import {Agent, globalAgent} from "./_http_agent.ts";
import { checkIsHttpToken } from "./_http_common.ts";

const searchParamsSymbol = Symbol('query')
const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/;
// Timeout values > TIMEOUT_MAX are set to 1.
const TIMEOUT_MAX = 2 ** 31 - 1;

function validateHost(host: string, name: string): string {
  if (host !== null && host !== undefined && typeof host !== 'string') {
    throw new ERR_INVALID_ARG_TYPE(`options.${name}`,
      ['string', 'undefined', 'null'],
      host);
  }
  return host;
}

// Type checking used by timers.enroll() and Socket#setTimeout()
function getTimerDuration(msecs: number, name: string) {
  if (msecs < 0 || !isFinite(msecs)) {
    throw new ERR_OUT_OF_RANGE(name, 'a non-negative finite number', msecs);
  }

  // Ensure that msecs fits into signed int32
  if (msecs > TIMEOUT_MAX) {
    process.emitWarning(`${msecs} does not fit into a 32-bit signed integer.` +
      `\nTimer duration was truncated to ${TIMEOUT_MAX}.`,
      'TimeoutOverflowWarning');
    return TIMEOUT_MAX;
  }

  return msecs;
}

let urlWarningEmitted = false;

interface URLToOptions {
  hostname: string,
  protocol: string,
  hash: string,
  search: string,
  pathname: string,
  path: string,
  href: string,
  port?: number,
  auth?: string
}

export class ClientRequest extends OutGoingMessage {

  private agent: Agent

  private path: string

  private method: string // Upper case

  private socketPath: string

  private timeout: number

  constructor(input: string | URL, options: Function | { agent: Agent, _defaultAgent: Agent, protocol: string, path: string, host: string, port: number, hostname: string, socketPath: string, setHost: boolean, timeout: number, method: string, maxHeaderSize:  number, insecureHttpParser: unknown}, cb) { // TODO(any) Make options into an interface and figure out what isecureHttpParser is
    super(input, options, cb)

    if (typeof input === 'string') {
      const urlStr = input;
      try {
        input = this.urlToOptions(new URL(urlStr));
      } catch (err) {
        input = new URL(urlStr);
        if (!input.hostname) {
          throw err;
        }
        if (!urlWarningEmitted && !process.noDeprecation) {
          urlWarningEmitted = true;
          process.emitWarning(
            `The provided URL ${urlStr} is not a valid URL, and is supported ` +
            'in the http module solely for compatibility.',
            'DeprecationWarning', 'DEP0109');
        }
      }
    } else if (input && input[searchParamsSymbol] &&
      input[searchParamsSymbol][searchParamsSymbol]) {
      // url.URL instance
      input = this.urlToOptions(input);
    } else {
      cb = options;
      options = input;
      input = null;
    }

    if (typeof options === 'function') {
      cb = options;
      options = input || {};
    } else {
      options = Object.assign(input || {}, options);
    }

    let agent = options.agent;
    const defaultAgent = options._defaultAgent || globalAgent;
    if (agent === false) {
      agent = new defaultAgent.constructor();
    } else if (agent === null || agent === undefined) {
      if (typeof options.createConnection !== 'function') {
        agent = defaultAgent;
      }
      // Explicitly pass through this statement as agent will not be used
      // when createConnection is provided.
    } else if (typeof agent.addRequest !== 'function') {
      throw new ERR_INVALID_ARG_TYPE('options.agent',
        ['Agent-like Object', 'undefined', 'false'],
        agent);
    }
    this.agent = agent;

    const protocol = options.protocol || defaultAgent.protocol;
    let expectedProtocol = defaultAgent.protocol;
    if (this.agent && this.agent.protocol)
      expectedProtocol = this.agent.protocol;

    let path;
    if (options.path) {
      path = String(options.path);
      if (INVALID_PATH_REGEX.test(path))
        throw new ERR_UNESCAPED_CHARACTERS('Request path');
    }

    if (protocol !== expectedProtocol) {
      throw new ERR_INVALID_PROTOCOL(protocol, expectedProtocol);
    }

    const defaultPort = options.defaultPort ||
      (this.agent && this.agent.defaultPort);

    const port = options.port = options.port || defaultPort || 80;
    const host = options.host = validateHost(options.hostname, 'hostname') ||
      validateHost(options.host, 'host') || 'localhost';

    const setHost = (options.setHost === undefined || Boolean(options.setHost));

    this.socketPath = options.socketPath;

    if (options.timeout !== undefined)
      this.timeout = getTimerDuration(options.timeout, 'timeout');

    let method = options.method;
    const methodIsString = (typeof method === 'string');
    if (method !== null && method !== undefined && !methodIsString) {
      throw new ERR_INVALID_ARG_TYPE('options.method', 'string', method);
    }

    if (methodIsString && method) {
      if (!checkIsHttpToken(method)) {
        throw new ERR_INVALID_HTTP_TOKEN('Method', method);
      }
      method = this.method = method.toUpperCase();
    } else {
      method = this.method = 'GET';
    }

    const maxHeaderSize = options.maxHeaderSize;
    // if (maxHeaderSize !== undefined)
    //   validateInteger(maxHeaderSize, 'maxHeaderSize', 0);
    this.maxHeaderSize = maxHeaderSize;

    const insecureHTTPParser = options.insecureHTTPParser;
    if (insecureHTTPParser !== undefined &&
      typeof insecureHTTPParser !== 'boolean') {
      throw new ERR_INVALID_ARG_TYPE(
        'options.insecureHTTPParser', 'boolean', insecureHTTPParser);
    }
    this.insecureHTTPParser = insecureHTTPParser;

    this.path = options.path || '/';
    if (cb) {
      this.once('response', cb);
    }

    if (method === 'GET' ||
      method === 'HEAD' ||
      method === 'DELETE' ||
      method === 'OPTIONS' ||
      method === 'TRACE' ||
      method === 'CONNECT') {
      this.useChunkedEncodingByDefault = false;
    } else {
      this.useChunkedEncodingByDefault = true;
    }

    this._ended = false;
    this.res = null;
    this.aborted = false;
    this.timeoutCb = null;
    this.upgradeOrConnect = false;
    this.parser = null;
    this.maxHeadersCount = null;
    this.reusedSocket = false;
    this.host = host;
    this.protocol = protocol;

    let called = false;

    if (this.agent) {
      // If there is an agent we should default to Connection:keep-alive,
      // but only if the Agent will actually reuse the connection!
      // If it's not a keepAlive agent, and the maxSockets==Infinity, then
      // there's never a case where this socket will actually be reused
      if (!this.agent.keepAlive && !NumberIsFinite(this.agent.maxSockets)) {
        this._last = true;
        this.shouldKeepAlive = false;
      } else {
        this._last = false;
        this.shouldKeepAlive = true;
      }
    }

    const headersArray = ArrayIsArray(options.headers);
    if (!headersArray) {
      if (options.headers) {
        const keys = ObjectKeys(options.headers);
        // Retain for(;;) loop for performance reasons
        // Refs: https://github.com/nodejs/node/pull/30958
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          this.setHeader(key, options.headers[key]);
        }
      }

      if (host && !this.getHeader('host') && setHost) {
        let hostHeader = host;

        // For the Host header, ensure that IPv6 addresses are enclosed
        // in square brackets, as defined by URI formatting
        // https://tools.ietf.org/html/rfc3986#section-3.2.2
        const posColon = hostHeader.indexOf(':');
        if (posColon !== -1 &&
          hostHeader.includes(':', posColon + 1) &&
          hostHeader.charCodeAt(0) !== 91/* '[' */) {
          hostHeader = `[${hostHeader}]`;
        }

        if (port && +port !== defaultPort) {
          hostHeader += ':' + port;
        }
        this.setHeader('Host', hostHeader);
      }

      if (options.auth && !this.getHeader('Authorization')) {
        this.setHeader('Authorization', 'Basic ' +
          Buffer.from(options.auth).toString('base64'));
      }

      if (this.getHeader('expect')) {
        if (this._header) {
          throw new ERR_HTTP_HEADERS_SENT('render');
        }

        this._storeHeader(this.method + ' ' + this.path + ' HTTP/1.1\r\n',
          this[kOutHeaders]);
      }
    } else {
      this._storeHeader(this.method + ' ' + this.path + ' HTTP/1.1\r\n',
        options.headers);
    }

    const oncreate = (err, socket) => {
      if (called)
        return;
      called = true;
      if (err) {
        process.nextTick(() => this.emit('error', err));
        return;
      }
      this.onSocket(socket);
      this._deferToConnect(null, null, () => this._flush());
    };

    // initiate connection
    if (this.agent) {
      this.agent.addRequest(this, options);
    } else {
      // No agent, default to Connection:close.
      this._last = true;
      this.shouldKeepAlive = false;
      if (typeof options.createConnection === 'function') {
        const newSocket = options.createConnection(options, oncreate);
        if (newSocket && !called) {
          called = true;
          this.onSocket(newSocket);
        } else {
          return;
        }
      } else {
        debug('CLIENT use net.createConnection', options);
        this.onSocket(net.createConnection(options));
      }
    }

    this._deferToConnect(null, null, () => this._flush());
  }

  private urlToOptions(url: URL): URLToOptions {
    const options: URLToOptions = {
      protocol: url.protocol,
      hostname: typeof url.hostname === 'string' && url.hostname.startsWith('[') ?
        url.hostname.slice(1, -1) :
        url.hostname,
      hash: url.hash,
      search: url.search,
      pathname: url.pathname,
      path: `${url.pathname || ''}${url.search || ''}`,
      href: url.href,
    };
    if (url.port !== '') {
      options.port = Number(url.port);
    }
    if (url.username || url.password) {
      options.auth = `${url.username}:${url.password}`;
    }
    return options;
  }

  private _finish () {
    DTRACE_HTTP_CLIENT_REQUEST(this, this.socket);
    OutgoingMessage.prototype._finish.call(this);
  }

  private _implicitHeader() {
    if (this._header) {
      throw new ERR_HTTP_HEADERS_SENT('render');
    }
    this._storeHeader(this.method + ' ' + this.path + ' HTTP/1.1\r\n',
      this[kOutHeaders]);
  };

  private abort() {
    if (this.aborted) {
      return;
    }
    this.aborted = true;
    process.nextTick(emitAbortNT, this);
    this.destroy();
  };

  private destroy(err) {
    if (this.destroyed) {
      return this;
    }
    this.destroyed = true;

    // If we're aborting, we don't care about any more response data.
    if (this.res) {
      this.res._dump();
    }

    // In the event that we don't have a socket, we will pop out of
    // the request queue through handling in onSocket.
    if (this.socket) {
      _destroy(this, this.socket, err);
    } else if (err) {
      this[kError] = err;
    }

    return this;
  };
}
ObjectSetPrototypeOf(ClientRequest.prototype, OutgoingMessage.prototype);
ObjectSetPrototypeOf(ClientRequest, OutgoingMessage);
