// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// a duplex stream is just a stream that is both readable and writable.
// Since JS doesn't have multiple prototype inheritance, this class
// prototypically inherits from Readable, and then parasitically from
// Writable.

import Readable from "./readable.js";
import Writable from "./writable.js";
import {
  StringDecoder,
} from "../string_decoder.ts";
import BufferList from "../internal/streams/buffer_list.js";
import {
  getHighWaterMark,
  getDefaultHighWaterMark,
} from "../internal/streams/state.js";
import {
  kPaused,
} from "../internal/streams/symbols.js";

//@ts-ignore
class Duplex extends Readable implements Writable {
  allowHalfOpen = true;
  readable = true;
  writable = true;

  #writable: Writable;

  _final: any;
  _writableState: any;
  _write: any;
  _writev: any;
  cork: any;
  end: any;
  setDefaultEncoding: any;
  uncork: any;
  writableBuffer: any;
  writableCorked: any;
  writableEnded: any;
  writableFinished: any;
  writableHighWaterMark: any;
  writableLength: any;
  writableObjectMode: any;
  write: any;

  constructor(options: any) {
    super(options);
    this.#writable = new Writable(options);
    if (options) {
      if (options.readable === false) {
        this.readable = false;
      }

      if (options.writable === false) {
        this.writable = false;
      }

      if (options.allowHalfOpen === false) {
        this.allowHalfOpen = false;
      }
    }

    this._final = this.#writable._final;
    this._writableState = this.#writable._writableState;
    this._write = this.#writable._write;
    this._writev = this.#writable._writev;
    this.cork = this.#writable.cork;
    this.end = this.#writable.end;
    this.setDefaultEncoding = this.#writable.setDefaultEncoding;
    this.uncork = this.#writable.uncork;
    this.writable = this.#writable.writable;
    this.writableBuffer = this.#writable.writableBuffer;
    this.writableCorked = this.#writable.writableCorked;
    this.writableEnded = this.#writable.writableEnded;
    this.writableFinished = this.#writable.writableFinished;
    this.writableHighWaterMark = this.#writable.writableHighWaterMark;
    this.writableLength = this.#writable.writableLength;
    this.writableObjectMode = this.#writable.writableObjectMode;
    this.write = this.#writable.write;
  }

  on(event: string, listener: any): this {
    if (["drain", "finish", "pipe", "unpipe"].includes(event)) {
      this.#writable.on(event, listener);
    } else {
      super.on(event, listener);
    }

    return this;
  }

  get destroyed() {
    if (
      this._readableState === undefined ||
      this._writableState === undefined
    ) {
      return false;
    }
    return this._readableState.destroyed && this._writableState.destroyed;
  }
  set destroyed(value) {
    if (this._readableState && this._writableState) {
      this._readableState.destroyed = value;
      this._writableState.destroyed = value;
    }
  }
}

class ReadableState {
  objectMode: boolean;
  highWaterMark: any;
  buffer: any;
  length: number;
  pipes: never[];
  flowing: null;
  ended: boolean;
  endEmitted: boolean;
  reading: boolean;
  constructed: boolean;
  sync: boolean;
  needReadable: boolean;
  emittedReadable: boolean;
  readableListening: boolean;
  resumeScheduled: boolean;
  errorEmitted: boolean;
  emitClose: boolean;
  autoDestroy: boolean;
  destroyed: boolean;
  errored: null;
  closed: boolean;
  closeEmitted: boolean;
  defaultEncoding: any;
  awaitDrainWriters: null;
  multiAwaitDrain: boolean;
  readingMore: boolean;
  decoder: StringDecoder | null;
  encoding: null;
  [kPaused]: any;

  constructor(options: any) {
    // Duplex streams are both readable and writable, but share
    // the same options object.
    // However, some cases require setting options to different
    // values for the readable and the writable sides of the duplex stream.
    // These options can be provided separately as readableXXX and writableXXX.

    // Object stream flag. Used to make read(n) ignore n and to
    // make all the buffer merging and length checks go away.
    this.objectMode = Boolean(
      options && (options.objectMode || options.readableObjectMode),
    );

    // The point at which it stops calling _read() to fill the buffer
    // Note: 0 is a valid value, means "don't call _read preemptively ever"
    this.highWaterMark = options
      ? getHighWaterMark(this, options, "readableHighWaterMark", true)
      : getDefaultHighWaterMark(false);

    // A linked list is used to store data chunks instead of an array because the
    // linked list can remove elements from the beginning faster than
    // array.shift().
    this.buffer = new BufferList();
    this.length = 0;
    this.pipes = [];
    this.flowing = null;
    this.ended = false;
    this.endEmitted = false;
    this.reading = false;

    // Stream is still being constructed and cannot be
    // destroyed until construction finished or failed.
    // Async construction is opt in, therefore we start as
    // constructed.
    this.constructed = true;

    // A flag to be able to tell if the event 'readable'/'data' is emitted
    // immediately, or on a later tick.  We set this to true at first, because
    // any actions that shouldn't happen until "later" should generally also
    // not happen before the first read call.
    this.sync = true;

    // Whenever we return null, then we set a flag to say
    // that we're awaiting a 'readable' event emission.
    this.needReadable = false;
    this.emittedReadable = false;
    this.readableListening = false;
    this.resumeScheduled = false;
    this[kPaused] = null;

    // True if the error was already emitted and should not be thrown again.
    this.errorEmitted = false;

    // Should close be emitted on destroy. Defaults to true.
    this.emitClose = !options || options.emitClose !== false;

    // Should .destroy() be called after 'end' (and potentially 'finish').
    this.autoDestroy = !options || options.autoDestroy !== false;

    // Has it been destroyed.
    this.destroyed = false;

    // Indicates whether the stream has errored. When true no further
    // _read calls, 'data' or 'readable' events should occur. This is needed
    // since when autoDestroy is disabled we need a way to tell whether the
    // stream has failed.
    this.errored = null;

    // Indicates whether the stream has finished destroying.
    this.closed = false;

    // True if close has been emitted or would have been emitted
    // depending on emitClose.
    this.closeEmitted = false;

    // Crypto is kind of old and crusty.  Historically, its default string
    // encoding is 'binary' so we have to make this configurable.
    // Everything else in the universe uses 'utf8', though.
    this.defaultEncoding = (options && options.defaultEncoding) || "utf8";

    // Ref the piped dest which we need a drain event on it
    // type: null | Writable | Set<Writable>.
    this.awaitDrainWriters = null;
    this.multiAwaitDrain = false;

    // If true, a maybeReadMore has been scheduled.
    this.readingMore = false;

    this.decoder = null;
    this.encoding = null;
    if (options && options.encoding) {
      this.decoder = new StringDecoder(options.encoding);
      this.encoding = options.encoding;
    }
  }
}

Duplex.ReadableState = ReadableState;

export default Duplex;
