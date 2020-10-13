import Buffer from "../buffer.ts";
import {
  rStates,
  IncomingMessage,
} from "./response.js";
import {
  Writable,
} from "../stream.ts";

/**
 * Checks if xhr.status is readable and non-zero, indicating no error.
 * Even though the spec says it should be available in readyState 3,
 * accessing it throws an exception in IE8
 */
function statusValid (xhr) {
	try {
		var status = xhr.status
		return (status !== null && status !== 0)
	} catch (e) {
		return false
	}
}

// Taken from http://www.w3.org/TR/XMLHttpRequest/#the-setrequestheader%28%29-method
var unsafeHeaders = [
	'accept-charset',
	'accept-encoding',
	'access-control-request-headers',
	'access-control-request-method',
	'connection',
	'content-length',
	'cookie',
	'cookie2',
	'date',
	'dnt',
	'expect',
	'host',
	'keep-alive',
	'origin',
	'referer',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
	'via'
]

class ClientRequest extends Writable {
  constructor (opts) {
    super({
      autoDestroy: false,
    });
    var self = this
    self._opts = opts
    self._body = []
    self._headers = {}
    if (opts.auth)
      self.setHeader('Authorization', 'Basic ' + Buffer.from(opts.auth).toString('base64'))
    Object.keys(opts.headers).forEach(function (name) {
      self.setHeader(name, opts.headers[name])
    })

    self._mode = 'fetch';
    self._fetchTimer = null

    self.on('finish', function () {
      self._onFinish()
    })
  }

  setHeader = function (name, value) {
    var self = this
    var lowerName = name.toLowerCase()
    // This check is not necessary, but it prevents warnings from browsers about setting unsafe
    // headers. To be honest I'm not entirely sure hiding these warnings is a good thing, but
    // http-browserify did it, so I will too.
    if (unsafeHeaders.indexOf(lowerName) !== -1)
      return
  
    self._headers[lowerName] = {
      name: name,
      value: value
    }
  }

  getHeader = function (name) {
    var header = this._headers[name.toLowerCase()]
    if (header)
      return header.value
    return null
  }

  removeHeader = function (name) {
    var self = this
    delete self._headers[name.toLowerCase()]
  }

  async _onFinish () {
    var self = this
  
    if (self._destroyed)
      return
    var opts = self._opts
  
    var headersObj = self._headers
    var body = null
    if (opts.method !== 'GET' && opts.method !== 'HEAD') {
          body = new Blob(self._body, {
              type: (headersObj['content-type'] || {}).value || ''
          });
      }
  
    // create flattened list of headers
    var headersList = []
    Object.keys(headersObj).forEach(function (keyName) {
      var name = headersObj[keyName].name
      var value = headersObj[keyName].value
      if (Array.isArray(value)) {
        value.forEach(function (v) {
          headersList.push([name, v])
        })
      } else {
        headersList.push([name, value])
      }
    })
  
    var signal = null
    var controller = new AbortController()
    signal = controller.signal
    self._fetchAbortController = controller

    if ('requestTimeout' in opts && opts.requestTimeout !== 0) {
      self._fetchTimer = setTimeout(function () {
        self.emit('requestTimeout')
        if (self._fetchAbortController)
          self._fetchAbortController.abort()
      }, opts.requestTimeout)
    }

    await fetch(self._opts.url, {
      method: self._opts.method,
      headers: headersList,
      body: body || undefined,
      mode: 'cors',
      credentials: opts.withCredentials ? 'include' : 'same-origin',
    }).then(
      function (response) {
        self._fetchResponse = response
        self._connect()
      }, function (reason) {
        clearTimeout(self._fetchTimer)
        if (!self._destroyed)
          self.emit('error', reason)
      }
    )
  }

  _onXHRProgress = function () {
    var self = this
  
    if (!statusValid(self._xhr) || self._destroyed)
      return
  
    if (!self._response)
      self._connect()
  
    self._response._onXHRProgress()
  }

  _connect = function () {
    var self = this
  
    if (self._destroyed)
      return
  
    self._response = new IncomingMessage(self._xhr, self._fetchResponse, self._mode, self._fetchTimer)
    self._response.on('error', function(err) {
      self.emit('error', err)
    })
  
    self.emit('response', self._response)
  }

  _write = function (chunk, encoding, cb) {
    var self = this
  
    self._body.push(chunk)
    cb()
  }

  destroy = function (x) {
    var self = this
    self._destroyed = true
    clearTimeout(self._fetchTimer)
    if (self._response)
      self._response._destroyed = true
    if (self._xhr)
      self._xhr.abort()
    else if (self._fetchAbortController)
      self._fetchAbortController.abort()
  }

  abort = this.destroy;

  end(data, encoding, cb) {
    var self = this
    if (typeof data === 'function') {
      cb = data
      data = undefined
    }
  
    super.end(data, encoding, cb)
  }

  flushHeaders = function () {}

  setTimeout = function () {}

  setNoDelay = function () {}

  setSocketKeepAlive = function () {}
}

export default ClientRequest