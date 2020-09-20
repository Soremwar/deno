import { captureRejectionSymbol } from "../events.ts"
import { asyncIdSymbol } from "./_http_agent/ts";
import { checkIsHttpToken } from "./_http_common.ts";

const kOutHeaders = Symbol('kOutHeaders')
const kNeedDrain = Symbol('kNeedDrain')
const kCorked = Symbol('corked');
const crlf_buf = Buffer.from('\r\n');
const CRLF = '\r\n'
let utcCache;

function getDefaultHighWaterMark(objectMode?) {
  return objectMode ? 16 : 16 * 1024;
}

function setUnrefTimeout(callback, after) {
  // Type checking identical to setTimeout()
  if (typeof callback !== 'function') {
    throw new ERR_INVALID_CALLBACK(callback);
  }

  const timer = new Timeout(callback, after, undefined, false, false);
  insert(timer, timer._idleTimeout);

  return timer;
}

function utcDate() {
  if (!utcCache) cache();
  return utcCache;
}

function cache() {
  const d = new Date();
  nowCache = d.valueOf();
  utcCache = d.toUTCString();
  setUnrefTimeout(resetCache, 1000 - d.getMilliseconds());
}

function ObjectCreate(proto, internalSlotsList?) {
  if (proto !== null && this.Type(proto) !== 'Object') {
    throw new $TypeError('Assertion failed: proto must be null or an object');
  }
  var slots = arguments.length < 2 ? [] : internalSlotsList;
  if (slots.length > 0) {
    throw new $SyntaxError('es-abstract does not yet support internal slots');
  }

  if (proto === null && !$ObjectCreate) {
    throw new $SyntaxError('native Object.create support is required to create null objects');
  }

  return $ObjectCreate(proto);
}

function isCookieField(s: string): boolean {
  return s.length === 6 && s.toLowerCase() === 'cookie';
}

function processHeader(self, state, key, value, validate) {
  if (validate)
    validateHeaderName(key);
  if (Array.isArray(value)) {
    if (value.length < 2 || !isCookieField(key)) {
      // Retain for(;;) loop for performance reasons
      // Refs: https://github.com/nodejs/node/pull/30958
      for (let i = 0; i < value.length; i++)
        storeHeader(self, state, key, value[i], validate);
      return;
    }
    value = value.join('; ');
  }
  storeHeader(self, state, key, value, validate);
}

function onError(msg, err, callback) {
  const triggerAsyncId = msg.socket ? msg.socket[asyncIdSymbol] : undefined;
  defaultTriggerAsyncIdScope(triggerAsyncId,
    process.nextTick,
    emitErrorNt,
    msg,
    err,
    callback);
}

function emitErrorNt(msg, err, callback) {
  callback(err);
  if (typeof msg.emit === 'function' && !msg._closed) {
    msg.emit('error', err);
  }
}

function write_(msg, chunk, encoding, callback, fromEnd) {
  if (typeof callback !== 'function')
    callback = function () {};

  let len;
  if (chunk === null) {
    throw new ERR_STREAM_NULL_VALUES();
  } else if (typeof chunk === 'string') {
    len = Buffer.byteLength(chunk, encoding);
  } else if (isUint8Array(chunk)) {
    len = chunk.length;
  } else {
    throw new ERR_INVALID_ARG_TYPE(
      'chunk', ['string', 'Buffer', 'Uint8Array'], chunk);
  }

  let err;
  if (msg.finished) {
    err = new ERR_STREAM_WRITE_AFTER_END();
  } else if (msg.destroyed) {
    err = new ERR_STREAM_DESTROYED('write');
  }

  if (err) {
    if (!msg.destroyed) {
      onError(msg, err, callback);
    } else {
      process.nextTick(callback, err);
    }
    return false;
  }

  if (!msg._header) {
    if (fromEnd) {
      msg._contentLength = len;
    }
    msg._implicitHeader();
  }

  if (!msg._hasBody) {
    debug('This type of response MUST NOT have a body. ' +
      'Ignoring write() calls.');
    process.nextTick(callback);
    return true;
  }

  if (!fromEnd && msg.socket && !msg.socket.writableCorked) {
    msg.socket.cork();
    process.nextTick(connectionCorkNT, msg.socket);
  }

  let ret;
  if (msg.chunkedEncoding && chunk.length !== 0) {
    msg._send(len.toString(16), 'latin1', null);
    msg._send(crlf_buf, null, null);
    msg._send(chunk, encoding, null);
    ret = msg._send(crlf_buf, null, callback);
  } else {
    ret = msg._send(chunk, encoding, callback);
  }

  debug('write ret = ' + ret);
  return ret;
}


function connectionCorkNT(conn) {
  conn.uncork();
}

function storeHeader(self, state, key, value, validate) {
  if (validate)
    validateHeaderValue(key, value);
  state.header += key + ': ' + value + CRLF;
  matchHeader(self, state, key, value);
}

function matchHeader(self, state, field, value) {
  if (field.length < 4 || field.length > 17)
    return;
  field = field.toLowerCase();
  switch (field) {
    case 'connection':
      state.connection = true;
      self._removedConnection = false;
      if (RE_CONN_CLOSE.test(value))
        self._last = true;
      else
        self.shouldKeepAlive = true;
      break;
    case 'transfer-encoding':
      state.te = true;
      self._removedTE = false;
      if (RE_TE_CHUNKED.test(value)) self.chunkedEncoding = true;
      break;
    case 'content-length':
      state.contLen = true;
      self._removedContLen = false;
      break;
    case 'date':
    case 'expect':
    case 'trailer':
      state[field] = true;
      break;
    case 'keep-alive':
      self._defaultKeepAlive = false;
      break;
  }
}

const validateHeaderName = hideStackFrames((name) => {
  if (typeof name !== 'string' || !name || !checkIsHttpToken(name)) {
    throw new ERR_INVALID_HTTP_TOKEN('Header name', name);
  }
});

const validateHeaderValue = hideStackFrames((name, value) => {
  if (value === undefined) {
    throw new ERR_HTTP_INVALID_HEADER_VALUE(value, name);
  }
  if (checkInvalidHeaderChar(value)) {
    debug('Header "%s" contains invalid characters', name);
    throw new ERR_INVALID_CHAR('header content', name);
  }
});

function onFinish(outmsg) {
  if (outmsg && outmsg.socket && outmsg.socket._hadError) return;
  outmsg.emit('finish');
}

const HIGH_WATER_MARK = getDefaultHighWaterMark()

export class OutgoingMessage extends Stream {
  // Queue that holds all currently pending data, until the response will be
  // assigned to the socket (until it will its turn in the HTTP pipeline).
  public outputData: unknown[] = [] // todo replace unknown with actual type
  // `outputSize` is an approximate measure of how much data is queued on this
  // response. `_onPendingData` will be invoked to update similar global
  // per-connection counter. That counter will be used to pause/unpause the
  // TCP socket and HTTP Parser and thus handle the backpressure.
  public outputSize: number = 0
  public writable: boolean = true
  public destroyed: boolean = false;
  private _last: boolean = false
  public chunkedEncoding: boolean = false;
  public shouldKeepAlive: boolean = true;
  private _defaultKeepAlive: boolean = true;
  public useChunkedEncodingByDefault: boolean = true;
  public sendDate: boolean = false;
  private _removedConnection: boolean = false;
  private _removedContLen: boolean = false;
  private _removedTE: boolean = false;
  private _contentLength = null;
  private _hasBody = true;
  private _trailer = '';
  public finished: boolean = false;
  private _headerSent: boolean = false;
  private _closed: boolean = false
  public socket: Socket|null = null;
  private _header: null|string = null
  private _keepAliveTimeout: number = 0
  constructor() {
    super();

    this[kNeedDrain] = false;
    this[kCorked] = 0;
    this[kOutHeaders] = null;
    this._keepAliveTimeout = 0;
  }

  private _onPendingData (amount) {}

  get writableFinished () {
    return (
      this.finished &&
      this.outputSize === 0 &&
      (!this.socket || this.socket.writableLength === 0)
    );
  }

  get writableObjectMode () {
    return false
  }

  get writableLength () {
    return this.outputSize + (this.socket ? this.socket.writableLength : 0);
  }

  get writableHighWaterMark () {
    return this.socket ? this.socket.writableHighWaterMark : HIGH_WATER_MARK;
  }

  get writableCorked () {
    const corked = this.socket ? this.socket.writableCorked : 0;
    return corked + this[kCorked];
  }

  get _headers () {
    return this.getHeaders();
  }

  set _headers (val: null|{[key: string]: Array<string>}) {
    if (val == null) {
      this[kOutHeaders] = null;
    } else if (typeof val === 'object') {
      const headers = this[kOutHeaders] = ObjectCreate(null);
      const keys = Object.keys(val);
      // Retain for(;;) loop for performance reasons
      // Refs: https://github.com/nodejs/node/pull/30958
      for (let i = 0; i < keys.length; ++i) {
        const name = keys[i];
        headers[name.toLowerCase()] = [name, val[name]];
      }
    }
  }

  get connection () {
    return this.socket
  }

  get _headerNames () {
    const headers = this[kOutHeaders];
    if (headers !== null) {
      const out = ObjectCreate(null);
      const keys = Object.keys(headers);
      // Retain for(;;) loop for performance reasons
      // Refs: https://github.com/nodejs/node/pull/30958
      for (let i = 0; i < keys.length; ++i) {
        const key = keys[i];
        const val = headers[key][0];
        out[key] = val;
      }
      return out;
    }
    return null;
  }

  set _headerNames (val: {[key: string]: string}) {
    if (typeof val === 'object' && val !== null) {
      const headers = this[kOutHeaders];
      if (!headers)
        return;
      const keys = Object.keys(val);
      // Retain for(;;) loop for performance reasons
      // Refs: https://github.com/nodejs/node/pull/30958
      for (let i = 0; i < keys.length; ++i) {
        const header = headers[keys[i]];
        if (header)
          header[0] = val[keys[i]];
      }
    }
  }

  set connection (val: Socket) {
    this.socket = val
  }

  private _renderHeaders() {
    if (this._header) {
      throw new ERR_HTTP_HEADERS_SENT('render');
    }

    const headersMap = this[kOutHeaders];
    const headers = {};

    if (headersMap !== null) {
      const keys = Object.keys(headersMap);
      // Retain for(;;) loop for performance reasons
      // Refs: https://github.com/nodejs/node/pull/30958
      for (let i = 0, l = keys.length; i < l; i++) {
        const key = keys[i];
        headers[headersMap[key][0]] = headersMap[key][1];
      }
    }
    return headers;
  };

  public cork () {
    if (this.socket) {
      this.socket.cork();
    } else {
      this[kCorked]++;
    }
  };

  public uncork () {
    if (this.socket) {
      this.socket.uncork();
    } else if (this[kCorked]) {
      this[kCorked]--;
    }
  };

  public setHeader(name, value) {
    if (this._header) {
      throw new ERR_HTTP_HEADERS_SENT('set');
    }
    validateHeaderName(name);
    validateHeaderValue(name, value);

    let headers = this[kOutHeaders];
    if (headers === null)
      this[kOutHeaders] = headers = ObjectCreate(null);

    headers[name.toLowerCase()] = [name, value];
  };

  private _finish() {
    assert(this.socket);
    this.emit('prefinish');
  };

  // This logic is probably a bit confusing. Let me explain a bit:
  //
  // In both HTTP servers and clients it is possible to queue up several
  // outgoing messages. This is easiest to imagine in the case of a client.
  // Take the following situation:
  //
  //    req1 = client.request('GET', '/');
  //    req2 = client.request('POST', '/');
  //
  // When the user does
  //
  //   req2.write('hello world\n');
  //
  // it's possible that the first request has not been completely flushed to
  // the socket yet. Thus the outgoing messages need to be prepared to queue
  // up data internally before sending it on further to the socket's queue.
  //
  // This function, outgoingFlush(), is called by both the Server and Client
  // to attempt to flush any pending messages out to the socket.
  private _flush() {
    const socket = this.socket;

    if (socket && socket.writable) {
      // There might be remaining data in this.output; write it out
      const ret = this._flushOutput(socket);

      if (this.finished) {
        // This is a queue to the server or client to bring in the next this.
        this._finish();
      } else if (ret && this[kNeedDrain]) {
        this[kNeedDrain] = false;
        this.emit('drain');
      }
    }
  };

  public end(chunk, encoding, callback) {
    if (typeof chunk === 'function') {
      callback = chunk;
      chunk = null;
      encoding = null;
    } else if (typeof encoding === 'function') {
      callback = encoding;
      encoding = null;
    }

    if (this.socket) {
      this.socket.cork();
    }

    if (chunk) {
      write_(this, chunk, encoding, null, true);
    } else if (this.finished) {
      if (typeof callback === 'function') {
        if (!this.writableFinished) {
          this.on('finish', callback);
        } else {
          callback(new ERR_STREAM_ALREADY_FINISHED('end'));
        }
      }
      return this;
    } else if (!this._header) {
      this._contentLength = 0;
      this._implicitHeader();
    }

    if (typeof callback === 'function')
      this.once('finish', callback);

    const finish = onFinish.bind(undefined, this);

    if (this._hasBody && this.chunkedEncoding) {
      this._send('0\r\n' + this._trailer + '\r\n', 'latin1', finish);
    } else {
      // Force a flush, HACK.
      this._send('', 'latin1', finish);
    }

    if (this.socket) {
      // Fully uncork connection on end().
      this.socket._writableState.corked = 1;
      this.socket.uncork();
    }
    this[kCorked] = 0;

    this.finished = true;

    // There is the first message on the outgoing queue, and we've sent
    // everything to the socket.
    debug('outgoing message end.');
    if (this.outputData.length === 0 &&
      this.socket &&
      this.socket._httpMessage === this) {
      this._finish();
    }

    return this;
  };

  private _flushOutput(socket) {
    while (this[kCorked]) {
      this[kCorked]--;
      socket.cork();
    }

    const outputLength = this.outputData.length;
    if (outputLength <= 0)
      return undefined;

    const outputData = this.outputData;
    socket.cork();
    let ret;
    // Retain for(;;) loop for performance reasons
    // Refs: https://github.com/nodejs/node/pull/30958
    for (let i = 0; i < outputLength; i++) {
      const { data, encoding, callback } = outputData[i];
      ret = socket.write(data, encoding, callback);
    }
    socket.uncork();

    this.outputData = [];
    this._onPendingData(-this.outputSize);
    this.outputSize = 0;

    return ret;
  };

  public flushHeaders() {
    if (!this._header) {
      this._implicitHeader();
    }

    // Force-flush the headers.
    this._send('');
  };

  public pipe() {
    // OutgoingMessage should be write-only. Piping from it is disabled.
    this.emit('error', new ERR_STREAM_CANNOT_PIPE());
  };


  public getHeader(name: string) {
    const headers = this[kOutHeaders];
    if (headers === null)
      return;

    const entry = headers[name.toLowerCase()];
    return entry && entry[1];
  };

  public getHeaderNames() {
    return this[kOutHeaders] !== null ? Object.keys(this[kOutHeaders]) : [];
  };

  public hasHeader(name: string) {
    return this[kOutHeaders] !== null &&
      !!this[kOutHeaders][name.toLowerCase()];
  };

  public removeHeader(name: string) {
    if (this._header) {
      throw new ERR_HTTP_HEADERS_SENT('remove');
    }

    const key = name.toLowerCase();

    switch (key) {
      case 'connection':
        this._removedConnection = true;
        break;
      case 'content-length':
        this._removedContLen = true;
        break;
      case 'transfer-encoding':
        this._removedTE = true;
        break;
      case 'date':
        this.sendDate = false;
        break;
    }

    if (this[kOutHeaders] !== null) {
      delete this[kOutHeaders][key];
    }
  };

  private _implicitHeader() {
    throw new ERR_METHOD_NOT_IMPLEMENTED('_implicitHeader()');
  };

  get headersSent () {
    return !!this._header;
  }

  get writableEnded () {
    return this.finished;
  }

  public write(chunk, encoding, callback) {
    if (typeof encoding === 'function') {
      callback = encoding;
      encoding = null;
    }

    const ret = write_(this, chunk, encoding, callback, false);
    if (!ret)
      this[kNeedDrain] = true;
    return ret;
  };

  public setTimeout(msecs, callback) {

    if (callback) {
      this.on('timeout', callback);
    }

    if (!this.socket) {
      this.once('socket', function socketSetTimeoutOnConnect(socket) {
        socket.setTimeout(msecs);
      });
    } else {
      this.socket.setTimeout(msecs);
    }
    return this;
  };

  public destroy(error) {
    if (this.destroyed) {
      return this;
    }
    this.destroyed = true;

    if (this.socket) {
      this.socket.destroy(error);
    } else {
      this.once('socket', function socketDestroyOnConnect(socket) {
        socket.destroy(error);
      });
    }

    return this;
  };

  private _send(data, encoding?, callback?) {
    // This is a shameful hack to get the headers and first body chunk onto
    // the same packet. Future versions of Node are going to take care of
    // this at a lower level and in a more general way.
    if (!this._headerSent) {
      if (typeof data === 'string' &&
        (encoding === 'utf8' || encoding === 'latin1' || !encoding)) {
        data = this._header + data;
      } else {
        const header = this._header;
        this.outputData.unshift({
          data: header,
          encoding: 'latin1',
          callback: null
        });
        this.outputSize += header.length;
        this._onPendingData(header.length);
      }
      this._headerSent = true;
    }
    return this._writeRaw(data, encoding, callback);
  };

  public addTrailers(headers: unknown[]) { // todo replace unknown with actual type
    this._trailer = '';
    const keys = Object.keys(headers);
    const isArray = Array.isArray(headers);
    // Retain for(;;) loop for performance reasons
    // Refs: https://github.com/nodejs/node/pull/30958
    for (let i = 0, l = keys.length; i < l; i++) {
      let field, value;
      const key = keys[i];
      if (isArray) {
        field = headers[key][0];
        value = headers[key][1];
      } else {
        field = key;
        value = headers[key];
      }
      if (typeof field !== 'string' || !field || !checkIsHttpToken(field)) {
        throw new ERR_INVALID_HTTP_TOKEN('Trailer name', field);
      }
      if (checkInvalidHeaderChar(value)) {
        debug('Trailer "%s" contains invalid characters', field);
        throw new ERR_INVALID_CHAR('trailer content', field);
      }
      this._trailer += field + ': ' + value + CRLF;
    }
  };

  private _writeRaw(data, encoding, callback) {
    const conn = this.socket;
    if (conn && conn.destroyed) {
      // The socket was destroyed. If we're still trying to write to it,
      // then we haven't gotten the 'close' event yet.
      return false;
    }

    if (typeof encoding === 'function') {
      callback = encoding;
      encoding = null;
    }

    if (conn && conn._httpMessage === this && conn.writable) {
      // There might be pending data in the this.output buffer.
      if (this.outputData.length) {
        this._flushOutput(conn);
      }
      // Directly write to socket.
      return conn.write(data, encoding, callback);
    }
    // Buffer, as long as we're not destroyed.
    this.outputData.push({ data, encoding, callback });
    this.outputSize += data.length;
    this._onPendingData(data.length);
    return this.outputSize < HIGH_WATER_MARK;
  }

  private _storeHeader(firstLine, headers) {
    // firstLine in the case of request is: 'GET /index.html HTTP/1.1\r\n'
    // in the case of response it is: 'HTTP/1.1 200 OK\r\n'
    const state = {
      connection: false,
      contLen: false,
      te: false,
      date: false,
      expect: false,
      trailer: false,
      header: firstLine
    };

    if (headers) {
      if (headers === this[kOutHeaders]) {
        for (const key in headers) {
          const entry = headers[key];
          processHeader(this, state, entry[0], entry[1], false);
        }
      } else if (ArrayIsArray(headers)) {
        for (const entry of headers) {
          processHeader(this, state, entry[0], entry[1], true);
        }
      } else {
        for (const key in headers) {
          if (ObjectPrototypeHasOwnProperty(headers, key)) {
            processHeader(this, state, key, headers[key], true);
          }
        }
      }
    }

    let { header } = state;

    // Date header
    if (this.sendDate && !state.date) {
      header += 'Date: ' + utcDate() + CRLF;
    }

    // Force the connection to close when the response is a 204 No Content or
    // a 304 Not Modified and the user has set a "Transfer-Encoding: chunked"
    // header.
    //
    // RFC 2616 mandates that 204 and 304 responses MUST NOT have a body but
    // node.js used to send out a zero chunk anyway to accommodate clients
    // that don't have special handling for those responses.
    //
    // It was pointed out that this might confuse reverse proxies to the point
    // of creating security liabilities, so suppress the zero chunk and force
    // the connection to close.
    if (this.chunkedEncoding && (this.statusCode === 204 ||
      this.statusCode === 304)) {
      debug(this.statusCode + ' response should not use chunked encoding,' +
        ' closing connection.');
      this.chunkedEncoding = false;
      this.shouldKeepAlive = false;
    }

    // keep-alive logic
    if (this._removedConnection) {
      this._last = true;
      this.shouldKeepAlive = false;
    } else if (!state.connection) {
      const shouldSendKeepAlive = this.shouldKeepAlive &&
        (state.contLen || this.useChunkedEncodingByDefault || this.agent);
      if (shouldSendKeepAlive) {
        header += 'Connection: keep-alive\r\n';
        if (this._keepAliveTimeout && this._defaultKeepAlive) {
          const timeoutSeconds = Math.floor(this._keepAliveTimeout / 1000);
          header += `Keep-Alive: timeout=${timeoutSeconds}\r\n`;
        }
      } else {
        this._last = true;
        header += 'Connection: close\r\n';
      }
    }

    if (!state.contLen && !state.te) {
      if (!this._hasBody) {
        // Make sure we don't end the 0\r\n\r\n at the end of the message.
        this.chunkedEncoding = false;
      } else if (!this.useChunkedEncodingByDefault) {
        this._last = true;
      } else if (!state.trailer &&
        !this._removedContLen &&
        typeof this._contentLength === 'number') {
        header += 'Content-Length: ' + this._contentLength + CRLF;
      } else if (!this._removedTE) {
        header += 'Transfer-Encoding: chunked\r\n';
        this.chunkedEncoding = true;
      } else {
        // We should only be able to get here if both Content-Length and
        // Transfer-Encoding are removed by the user.
        // See: test/parallel/test-http-remove-header-stays-removed.js
        debug('Both Content-Length and Transfer-Encoding are removed');
      }
    }

    // Test non-chunked message does not have trailer header set,
    // message will be terminated by the first empty line after the
    // header fields, regardless of the header fields present in the
    // message, and thus cannot contain a message body or 'trailers'.
    if (this.chunkedEncoding !== true && state.trailer) {
      throw new ERR_HTTP_TRAILER_INVALID();
    }

    this._header = header + CRLF;
    this._headerSent = false;

    // Wait until the first body chunk, or close(), is sent to flush,
    // UNLESS we're sending Expect: 100-continue.
    if (state.expect) this._send('');
  }

  public getHeaders() {
    const headers = this[kOutHeaders];
    const ret = ObjectCreate(null);
    if (headers) {
      const keys = Object.keys(headers);
      // Retain for(;;) loop for performance reasons
      // Refs: https://github.com/nodejs/node/pull/30958
      for (let i = 0; i < keys.length; ++i) {
        const key = keys[i];
        const val = headers[key][1];
        ret[key] = val;
      }
    }
    return ret;
  };

  [captureRejectionSymbol](err, event) {
    this.destroy(err);
  };
}
