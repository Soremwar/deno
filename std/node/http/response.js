import Buffer from "../buffer.ts";
import {
  Readable,
} from "../stream.ts";

var rStates = {
	UNSENT: 0,
	OPENED: 1,
	HEADERS_RECEIVED: 2,
	LOADING: 3,
	DONE: 4
}

class IncomingMessage extends Readable{
  constructor (xhr, response, mode, fetchTimer){
    super();
    var self = this

    self._mode = mode
    self.headers = {}
    self.rawHeaders = []
    self.trailers = {}
    self.rawTrailers = []

    // Fake the 'close' event, but only once 'end' fires
    self.on('end', function () {
      // The nextTick is necessary to prevent the 'request' module from causing an infinite loop
      queueMicrotask(function () {
        self.emit('close')
      });
    })

    self._fetchResponse = response

    self.url = response.url
    self.statusCode = response.status
    self.statusMessage = response.statusText
    
    response.headers.forEach(function (header, key){
      self.headers[key.toLowerCase()] = header
      self.rawHeaders.push(key, header)
    })

    var reader = response.body.getReader()
    function read () {
      reader.read().then(function (result) {
        if (self._destroyed)
          return
        if (result.done) {
          clearTimeout(fetchTimer)
          self.push(null)
          return
        }
        self.push(Buffer.from(result.value))
        read()
      }).catch(function (err) {
        clearTimeout(fetchTimer)
        if (!self._destroyed)
          self.emit('error', err)
      })
    }
    read()
  }

  _read = function () {
    var self = this
  
    var resolve = self._resumeFetch
    if (resolve) {
      self._resumeFetch = null
      resolve()
    }
  }

  _onXHRProgress = function () {
    var self = this
  
    var xhr = self._xhr
  
    var response = null
    switch (self._mode) {
      case 'text':
        response = xhr.responseText
        if (response.length > self._pos) {
          var newData = response.substr(self._pos)
          if (self._charset === 'x-user-defined') {
            var buffer = Buffer.alloc(newData.length)
            for (var i = 0; i < newData.length; i++)
              buffer[i] = newData.charCodeAt(i) & 0xff
  
            self.push(buffer)
          } else {
            self.push(newData, self._charset)
          }
          self._pos = response.length
        }
        break
      case 'arraybuffer':
        if (xhr.readyState !== rStates.DONE || !xhr.response)
          break
        response = xhr.response
        self.push(Buffer.from(new Uint8Array(response)))
        break
      case 'moz-chunked-arraybuffer': // take whole
        response = xhr.response
        if (xhr.readyState !== rStates.LOADING || !response)
          break
        self.push(Buffer.from(new Uint8Array(response)))
        break
      case 'ms-stream':
        response = xhr.response
        if (xhr.readyState !== rStates.LOADING)
          break
        var reader = new MSStreamReader()
        reader.onprogress = function () {
          if (reader.result.byteLength > self._pos) {
            self.push(Buffer.from(new Uint8Array(reader.result.slice(self._pos))))
            self._pos = reader.result.byteLength
          }
        }
        reader.onload = function () {
          self.push(null)
        }
        // reader.onerror = ??? // TODO: this
        reader.readAsArrayBuffer(response)
        break
    }
  
    // The ms-stream case handles end separately in reader.onload()
    if (self._xhr.readyState === rStates.DONE && self._mode !== 'ms-stream') {
      self.push(null)
    }
  }
}

export {
  rStates,
  IncomingMessage,
}