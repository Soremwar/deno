import Socket from "../_net/socket.ts";

export class IncomingMessage extends Readable {
  private _readableState: { readingMore: boolean} = {
    readingMore: true
  };

  public socket: Socket;

  public httpVersionMajor: null|string = null

  public httpVersionMinor: null|string = null;

  public httpVersion: null|string = null;
  public complete: boolean = false;
  public headers: {[key: string]: string} = {};
  public rawHeaders: string[] = []
  public trailers: any = {} // todo get type
  public rawTrailers: unknown[] = [] // todo what type array is this?
  public aborted: boolean = false;
  public upgrade: null|unknown = null // todo remove unknown, and find out what types it is assigned
  public url: string = ''
  public method: null|string = null;
  public statusCode: null|number = null;
  public statusMessage: null|string = null;
  private _consuming: boolean = false;
  // Flag for when we decide that this message cannot possibly be
  // read by the user, so there's no point continuing to handle it.
  private _dumped: boolean = false
  public client: Socket;
  constructor(socket: Socket) {
    super({ autoDestroy: false, highWaterMark: socket.readableHighWaterMark}) // see below commented out code

    // let streamOptions;
    //
    // if (socket) {
    //   streamOptions = {
    //     highWaterMark: socket.readableHighWaterMark
    //   };
    // }
    //
    // Stream.Readable.call(this, { autoDestroy: false, ...streamOptions });

    this.socket = socket;
    this.client = socket;
  }

  public setTimeout(msecs: number, callback) {
    if (callback)
      this.on('timeout', callback);
    this.socket.setTimeout(msecs);
    return this;
  };

  private _read(n) {
    if (!this._consuming) {
      this._readableState.readingMore = false;
      this._consuming = true;
    }
    // We actually do almost nothing here, because the parserOnBody
    // function fills up our internal buffer directly.  However, we
    // do need to unpause the underlying socket so that it flows.
    if (this.socket.readable)
      if (this.socket && !this.socket._paused && this.socket.readable)
        this.socket.resume();
      //readStart(this.socket); // Above two lines are what this line does
  }

  public destroy(error) {
    // TODO(ronag): Implement in terms of _destroy
    this.destroyed = true;
    if (this.socket)
      this.socket.destroy(error);
    return this;
  };

  private _addHeaderLines(headers, n) {
    if (headers && headers.length) {
      let dest;
      if (this.complete) {
        this.rawTrailers = headers;
        dest = this.trailers;
      } else {
        this.rawHeaders = headers;
        dest = this.headers;
      }

      for (let i = 0; i < n; i += 2) {
        this._addHeaderLine(headers[i], headers[i + 1], dest);
      }
    }
  }

  private _dump() {
    if (!this._dumped) {
      this._dumped = true;
      // If there is buffered data, it may trigger 'data' events.
      // Remove 'data' event listeners explicitly.
      this.removeAllListeners('data');
      this.resume();
    }
  };

  private matchKnownFields(field: string, lowercased?: boolean) {
    switch (field.length) {
      case 3:
        if (field === 'Age' || field === 'age') return 'age';
        break;
      case 4:
        if (field === 'Host' || field === 'host') return 'host';
        if (field === 'From' || field === 'from') return 'from';
        if (field === 'ETag' || field === 'etag') return 'etag';
        if (field === 'Date' || field === 'date') return '\u0000date';
        if (field === 'Vary' || field === 'vary') return '\u0000vary';
        break;
      case 6:
        if (field === 'Server' || field === 'server') return 'server';
        if (field === 'Cookie' || field === 'cookie') return '\u0002cookie';
        if (field === 'Origin' || field === 'origin') return '\u0000origin';
        if (field === 'Expect' || field === 'expect') return '\u0000expect';
        if (field === 'Accept' || field === 'accept') return '\u0000accept';
        break;
      case 7:
        if (field === 'Referer' || field === 'referer') return 'referer';
        if (field === 'Expires' || field === 'expires') return 'expires';
        if (field === 'Upgrade' || field === 'upgrade') return '\u0000upgrade';
        break;
      case 8:
        if (field === 'Location' || field === 'location')
          return 'location';
        if (field === 'If-Match' || field === 'if-match')
          return '\u0000if-match';
        break;
      case 10:
        if (field === 'User-Agent' || field === 'user-agent')
          return 'user-agent';
        if (field === 'Set-Cookie' || field === 'set-cookie')
          return '\u0001';
        if (field === 'Connection' || field === 'connection')
          return '\u0000connection';
        break;
      case 11:
        if (field === 'Retry-After' || field === 'retry-after')
          return 'retry-after';
        break;
      case 12:
        if (field === 'Content-Type' || field === 'content-type')
          return 'content-type';
        if (field === 'Max-Forwards' || field === 'max-forwards')
          return 'max-forwards';
        break;
      case 13:
        if (field === 'Authorization' || field === 'authorization')
          return 'authorization';
        if (field === 'Last-Modified' || field === 'last-modified')
          return 'last-modified';
        if (field === 'Cache-Control' || field === 'cache-control')
          return '\u0000cache-control';
        if (field === 'If-None-Match' || field === 'if-none-match')
          return '\u0000if-none-match';
        break;
      case 14:
        if (field === 'Content-Length' || field === 'content-length')
          return 'content-length';
        break;
      case 15:
        if (field === 'Accept-Encoding' || field === 'accept-encoding')
          return '\u0000accept-encoding';
        if (field === 'Accept-Language' || field === 'accept-language')
          return '\u0000accept-language';
        if (field === 'X-Forwarded-For' || field === 'x-forwarded-for')
          return '\u0000x-forwarded-for';
        break;
      case 16:
        if (field === 'Content-Encoding' || field === 'content-encoding')
          return '\u0000content-encoding';
        if (field === 'X-Forwarded-Host' || field === 'x-forwarded-host')
          return '\u0000x-forwarded-host';
        break;
      case 17:
        if (field === 'If-Modified-Since' || field === 'if-modified-since')
          return 'if-modified-since';
        if (field === 'Transfer-Encoding' || field === 'transfer-encoding')
          return '\u0000transfer-encoding';
        if (field === 'X-Forwarded-Proto' || field === 'x-forwarded-proto')
          return '\u0000x-forwarded-proto';
        break;
      case 19:
        if (field === 'Proxy-Authorization' || field === 'proxy-authorization')
          return 'proxy-authorization';
        if (field === 'If-Unmodified-Since' || field === 'if-unmodified-since')
          return 'if-unmodified-since';
        break;
    }
    if (lowercased) {
      return '\u0000' + field;
    }
    return this.matchKnownFields(field.toLowerCase(), true);
  }

  private _addHeaderLine(field, value, dest) {
    field = this.matchKnownFields(field);
    const flag = field.charCodeAt(0);
    if (flag === 0 || flag === 2) {
      field = field.slice(1);
      // Make a delimited list
      if (typeof dest[field] === 'string') {
        dest[field] += (flag === 0 ? ', ' : '; ') + value;
      } else {
        dest[field] = value;
      }
    } else if (flag === 1) {
      // Array header -- only Set-Cookie at the moment
      if (dest['set-cookie'] !== undefined) {
        dest['set-cookie'].push(value);
      } else {
        dest['set-cookie'] = [value];
      }
    } else if (dest[field] === undefined) {
      // Drop duplicates
      dest[field] = value;
    }
  }

  get connection () {
    return this.socket
  }

  set connection (socket) {
    this.socket = socket
  }
}
