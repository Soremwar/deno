//TODO@Soremwar
//Investigate/Reintegrate debug calls for the stream
//Reintegrate lazy loads

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
import EventEmitter, {
  captureRejectionSymbol,
} from "../events.ts";
import Stream from "./stream.ts";
import Buffer from "../buffer.ts";
import BufferList from "./buffer_list.ts";
import {
  ERR_INVALID_ARG_TYPE,
  ERR_STREAM_PUSH_AFTER_EOF,
  ERR_METHOD_NOT_IMPLEMENTED,
  ERR_STREAM_UNSHIFT_AFTER_END_EVENT,
  ERR_INVALID_OPT_VALUE,
  ERR_MULTIPLE_CALLBACK,
} from "../_errors.ts";
import {
  StringDecoder,
} from "../string_decoder.ts";
import createReadableStreamAsyncIterator from "./async_iterator.ts";
import streamFrom from "./from.ts";
import {
  kConstruct,
  kDestroy,
  kPaused,
} from "./symbols.ts";
import type Writable from "./writable.ts";
import {
  errorOrDestroy as errorOrDestroyDuplex,
} from "./duplex.ts";

function construct(stream: Readable, cb: () => void) {
  const r = stream._readableState;

  if (!stream._construct) {
    return;
  }

  stream.once(kConstruct, cb);

  r.constructed = false;

  queueMicrotask(() => {
    let called = false;
    stream._construct?.((err?: Error) => {
      r.constructed = true;

      if (called) {
        err = new ERR_MULTIPLE_CALLBACK();
      } else {
        called = true;
      }

      if (r.destroyed) {
        stream.emit(kDestroy, err);
      } else if (err) {
        errorOrDestroy(stream, err, true);
      } else {
        queueMicrotask(() => stream.emit(kConstruct));
      }
    });
  });
}

function _destroy(
  self: Readable,
  err?: Error,
  cb?: (error?: Error | null) => void,
) {
  self._destroy(err || null, (err) => {
    const r = (self as Readable)._readableState;

    if (err) {
      // Avoid V8 leak, https://github.com/nodejs/node/pull/34103#issuecomment-652002364
      err.stack;

      if (!r.errored) {
        r.errored = err;
      }
    }

    r.closed = true;

    if (typeof cb === "function") {
      cb(err);
    }

    if (err) {
      queueMicrotask(() => {
        if (!r.errorEmitted) {
          r.errorEmitted = true;
          self.emit("error", err);
        }
        r.closeEmitted = true;
        if (r.emitClose) {
          self.emit("close");
        }
      });
    } else {
      queueMicrotask(() => {
        r.closeEmitted = true;
        if (r.emitClose) {
          self.emit("close");
        }
      });
    }
  });
}

function errorOrDestroy(stream: Readable, err: Error, sync = false) {
  const r = stream._readableState;

  if (r.destroyed) {
    return stream;
  }

  if (r.autoDestroy) {
    stream.destroy(err);
  } else if (err) {
    // Avoid V8 leak, https://github.com/nodejs/node/pull/34103#issuecomment-652002364
    err.stack;

    if (!r.errored) {
      r.errored = err;
    }
    if (sync) {
      queueMicrotask(() => {
        if (!r.errorEmitted) {
          r.errorEmitted = true;
          stream.emit("error", err);
        }
      });
    } else if (!r.errorEmitted) {
      r.errorEmitted = true;
      stream.emit("error", err);
    }
  }
}

function flow(stream: Readable) {
  const state = stream._readableState;
  while (state.flowing && stream.read() !== null);
}

function pipeOnDrain(src: Readable, dest: Writable) {
  return function pipeOnDrainFunctionResult() {
    const state = src._readableState;

    // `ondrain` will call directly,
    // `this` maybe not a reference to dest,
    // so we use the real dest here.
    if (state.awaitDrainWriters === dest) {
      state.awaitDrainWriters = null;
    } else if (state.multiAwaitDrain) {
      (state.awaitDrainWriters as Set<Writable>).delete(dest);
    }

    if (
      (!state.awaitDrainWriters ||
        (state.awaitDrainWriters as Set<Writable>).size === 0) &&
      src.listenerCount("data")
    ) {
      state.flowing = true;
      flow(src);
    }
  };
}

function updateReadableListening(self: Readable) {
  const state = self._readableState;
  state.readableListening = self.listenerCount("readable") > 0;

  if (state.resumeScheduled && state[kPaused] === false) {
    // Flowing needs to be set to true now, otherwise
    // the upcoming resume will not flow.
    state.flowing = true;

    // Crude way to check if we should resume.
  } else if (self.listenerCount("data") > 0) {
    self.resume();
  } else if (!state.readableListening) {
    state.flowing = null;
  }
}

function nReadingNextTick(self: Readable) {
  self.read(0);
}

function resume(stream: Readable, state: ReadableState) {
  if (!state.resumeScheduled) {
    state.resumeScheduled = true;
    queueMicrotask(() => resume_(stream, state));
  }
}

function resume_(stream: Readable, state: ReadableState) {
  if (!state.reading) {
    stream.read(0);
  }

  state.resumeScheduled = false;
  stream.emit("resume");
  flow(stream);
  if (state.flowing && !state.reading) {
    stream.read(0);
  }
}

function readableAddChunk(
  stream: Readable,
  chunk: string | Buffer | Uint8Array | null,
  encoding: undefined | string = undefined,
  addToFront: boolean,
) {
  const state = stream._readableState;
  let used_encoding = encoding;

  let err;
  if (!state.objectMode) {
    if (typeof chunk === "string") {
      used_encoding = encoding || state.defaultEncoding;
      if (state.encoding !== used_encoding) {
        if (addToFront && state.encoding) {
          chunk = Buffer.from(chunk, used_encoding).toString(state.encoding);
        } else {
          chunk = Buffer.from(chunk, used_encoding);
          used_encoding = "";
        }
      }
    } else if (chunk instanceof Uint8Array) {
      chunk = Buffer.from(chunk);
    }
  }

  if (err) {
    errorOrDestroy(stream, err);
  } else if (chunk === null) {
    state.reading = false;
    onEofChunk(stream, state);
  } else if (state.objectMode || (chunk.length > 0)) {
    if (addToFront) {
      if (state.endEmitted) {
        errorOrDestroy(stream, new ERR_STREAM_UNSHIFT_AFTER_END_EVENT());
      } else {
        addChunk(stream, state, chunk, true);
      }
    } else if (state.ended) {
      errorOrDestroy(stream, new ERR_STREAM_PUSH_AFTER_EOF());
    } else if (state.destroyed || state.errored) {
      return false;
    } else {
      state.reading = false;
      if (state.decoder && !used_encoding) {
        //TODO(Soremwar)
        //I don't think this cast is right
        chunk = state.decoder.write(Buffer.from(chunk as Uint8Array));
        if (state.objectMode || chunk.length !== 0) {
          addChunk(stream, state, chunk, false);
        } else {
          maybeReadMore(stream, state);
        }
      } else {
        addChunk(stream, state, chunk, false);
      }
    }
  } else if (!addToFront) {
    state.reading = false;
    maybeReadMore(stream, state);
  }

  // We can push more data if we are below the highWaterMark.
  // Also, if we have no data yet, we can stand some more bytes.
  // This is to work around cases where hwm=0, such as the repl.
  return !state.ended &&
    (state.length < state.highWaterMark || state.length === 0);
}

function addChunk(
  stream: Readable,
  state: ReadableState,
  chunk: string | Buffer | Uint8Array,
  addToFront: boolean,
) {
  if (state.flowing && state.length === 0 && !state.sync) {
    // Use the guard to avoid creating `Set()` repeatedly
    // when we have multiple pipes.
    if (state.multiAwaitDrain) {
      (state.awaitDrainWriters as Set<Writable>).clear();
    } else {
      state.awaitDrainWriters = null;
    }
    stream.emit("data", chunk);
  } else {
    // Update the buffer info.
    state.length += state.objectMode ? 1 : chunk.length;
    if (addToFront) {
      state.buffer.unshift(chunk);
    } else {
      state.buffer.push(chunk);
    }

    if (state.needReadable) {
      emitReadable(stream);
    }
  }
  maybeReadMore(stream, state);
}

function prependListener(
  emitter: EventEmitter,
  event: string,
  // deno-lint-ignore no-explicit-any
  fn: (...args: any[]) => any,
) {
  // Sadly this is not cacheable as some libraries bundle their own
  // event emitter implementation with them.
  if (typeof emitter.prependListener === "function") {
    return emitter.prependListener(event, fn);
  }

  // This is a hack to make sure that our error handler is attached before any
  // userland ones.  NEVER DO THIS. This is here only because this code needs
  // to continue to work with older versions of Node.js that do not include
  //the prependListener() method. The goal is to eventually remove this hack.
  // TODO(Soremwar)
  // Burn it with fire
  // deno-lint-ignore ban-ts-comment
  //@ts-ignore
  if (emitter._events.get(event)?.length) {
    // deno-lint-ignore ban-ts-comment
    //@ts-ignore
    const listeners = [fn, ...emitter._events.get(event)];
    // deno-lint-ignore ban-ts-comment
    //@ts-ignore
    emitter._events.set(event, listeners);
  } else {
    emitter.on(event, fn);
  }
}

// Pluck off n bytes from an array of buffers.
// Length is the combined lengths of all the buffers in the list.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function fromList(n: number, state: ReadableState) {
  // nothing buffered.
  if (state.length === 0) {
    return null;
  }

  let ret;
  if (state.objectMode) {
    ret = state.buffer.shift();
  } else if (!n || n >= state.length) {
    // Read it all, truncate the list.
    if (state.decoder) {
      ret = state.buffer.join("");
    } else if (state.buffer.length === 1) {
      ret = state.buffer.first();
    } else {
      ret = state.buffer.concat(state.length);
    }
    state.buffer.clear();
  } else {
    // read part of list.
    ret = state.buffer.consume(n, !!state.decoder);
  }

  return ret;
}

function endReadable(stream: Readable) {
  const state = stream._readableState;

  if (!state.endEmitted) {
    state.ended = true;
    queueMicrotask(() => endReadableNT(state, stream));
  }
}

function endReadableNT(state: ReadableState, stream: Readable) {
  // Check that we didn't get one last unshift.
  if (
    !state.errorEmitted && !state.closeEmitted &&
    !state.endEmitted && state.length === 0
  ) {
    state.endEmitted = true;
    stream.emit("end");

    if (state.autoDestroy) {
      stream.destroy();
    }
  }
}

// Don't raise the hwm > 1GB.
const MAX_HWM = 0x40000000;
function computeNewHighWaterMark(n: number) {
  if (n >= MAX_HWM) {
    // TODO(ronag): Throw ERR_VALUE_OUT_OF_RANGE.
    n = MAX_HWM;
  } else {
    // Get the next highest power of 2 to prevent increasing hwm excessively in
    // tiny amounts.
    n--;
    n |= n >>> 1;
    n |= n >>> 2;
    n |= n >>> 4;
    n |= n >>> 8;
    n |= n >>> 16;
    n++;
  }
  return n;
}

// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function howMuchToRead(n: number, state: ReadableState) {
  if (n <= 0 || (state.length === 0 && state.ended)) {
    return 0;
  }
  if (state.objectMode) {
    return 1;
  }
  if (Number.isNaN(n)) {
    // Only flow one buffer at a time.
    if (state.flowing && state.length) {
      return state.buffer.first().length;
    }
    return state.length;
  }
  if (n <= state.length) {
    return n;
  }
  return state.ended ? state.length : 0;
}

function onEofChunk(stream: Readable, state: ReadableState) {
  if (state.ended) return;
  if (state.decoder) {
    const chunk = state.decoder.end();
    if (chunk && chunk.length) {
      state.buffer.push(chunk);
      state.length += state.objectMode ? 1 : chunk.length;
    }
  }
  state.ended = true;

  if (state.sync) {
    // If we are sync, wait until next tick to emit the data.
    // Otherwise we risk emitting data in the flow()
    // the readable code triggers during a read() call.
    emitReadable(stream);
  } else {
    // Emit 'readable' now to make sure it gets picked up.
    state.needReadable = false;
    state.emittedReadable = true;
    // We have to emit readable now that we are EOF. Modules
    // in the ecosystem (e.g. dicer) rely on this event being sync.
    emitReadable_(stream);
  }
}

// Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.
function emitReadable(stream: Readable) {
  const state = stream._readableState;
  state.needReadable = false;
  if (!state.emittedReadable) {
    state.emittedReadable = true;
    queueMicrotask(() => emitReadable_(stream));
  }
}

function emitReadable_(stream: Readable) {
  const state = stream._readableState;
  if (!state.destroyed && !state.errored && (state.length || state.ended)) {
    stream.emit("readable");
    state.emittedReadable = false;
  }

  // The stream needs another readable event if:
  // 1. It is not flowing, as the flow mechanism will take
  //    care of it.
  // 2. It is not ended.
  // 3. It is below the highWaterMark, so we can schedule
  //    another readable later.
  state.needReadable = !state.flowing &&
    !state.ended &&
    state.length <= state.highWaterMark;
  flow(stream);
}

// At this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.
function maybeReadMore(stream: Readable, state: ReadableState) {
  if (!state.readingMore && state.constructed) {
    state.readingMore = true;
    queueMicrotask(() => maybeReadMore_(stream, state));
  }
}

function maybeReadMore_(stream: Readable, state: ReadableState) {
  // Attempt to read more data if we should.
  //
  // The conditions for reading more data are (one of):
  // - Not enough data buffered (state.length < state.highWaterMark). The loop
  //   is responsible for filling the buffer with enough data if such data
  //   is available. If highWaterMark is 0 and we are not in the flowing mode
  //   we should _not_ attempt to buffer any extra data. We'll get more data
  //   when the stream consumer calls read() instead.
  // - No data in the buffer, and the stream is in flowing mode. In this mode
  //   the loop below is responsible for ensuring read() is called. Failing to
  //   call read here would abort the flow and there's no other mechanism for
  //   continuing the flow if the stream consumer has just subscribed to the
  //   'data' event.
  //
  // In addition to the above conditions to keep reading data, the following
  // conditions prevent the data from being read:
  // - The stream has ended (state.ended).
  // - There is already a pending 'read' operation (state.reading). This is a
  //   case where the the stream has called the implementation defined _read()
  //   method, but they are processing the call asynchronously and have _not_
  //   called push() with new data. In this case we skip performing more
  //   read()s. The execution ends in this method again after the _read() ends
  //   up calling push() with more data.
  while (
    !state.reading && !state.ended &&
    (state.length < state.highWaterMark ||
      (state.flowing && state.length === 0))
  ) {
    const len = state.length;
    stream.read(0);
    if (len === state.length) {
      // Didn't get any data, stop spinning.
      break;
    }
  }
  state.readingMore = false;
}

export interface ReadableOptions {
  autoDestroy?: boolean;
  construct?: () => void;
  //TODO(Soremwar)
  //Import available encodings
  defaultEncoding?: string;
  destroy?(
    this: Readable,
    error: Error | null,
    callback: (error: Error | null) => void,
  ): void;
  emitClose?: boolean;
  //TODO(Soremwar)
  //Import available encodings
  encoding?: string;
  highWaterMark?: number;
  objectMode?: boolean;
  read?(this: Readable, size: number): void;
}

class ReadableState {
  [kPaused]: boolean | null = null;
  awaitDrainWriters: Writable | Set<Writable> | null = null;
  buffer = new BufferList();
  closed = false;
  closeEmitted = false;
  constructed: boolean;
  decoder: StringDecoder | null = null;
  destroyed = false;
  emittedReadable = false;
  //TODO(Soremwar)
  //Import available encodings
  encoding: string | null = null;
  ended = false;
  endEmitted = false;
  errored: Error | null = null;
  errorEmitted = false;
  flowing: boolean | null = null;
  highWaterMark: number;
  length = 0;
  multiAwaitDrain = false;
  needReadable = false;
  objectMode: boolean;
  pipes: Writable[] = [];
  readable = true;
  readableListening = false;
  reading = false;
  readingMore = false;
  resumeScheduled = false;
  sync = true;
  emitClose: boolean;
  autoDestroy: boolean;
  defaultEncoding: string;

  constructor(options?: ReadableOptions) {
    this.objectMode = !!options?.objectMode;

    this.highWaterMark = options?.highWaterMark ??
      (this.objectMode ? 16 : 16 * 1024);
    if (Number.isInteger(this.highWaterMark) && this.highWaterMark >= 0) {
      this.highWaterMark = Math.floor(this.highWaterMark);
    } else {
      throw new ERR_INVALID_OPT_VALUE("highWaterMark", this.highWaterMark);
    }

    this.emitClose = options?.emitClose ?? true;
    this.autoDestroy = options?.autoDestroy ?? true;
    this.defaultEncoding = options?.defaultEncoding || "utf8";

    if (options?.encoding) {
      this.decoder = new StringDecoder(options.encoding);
      this.encoding = options.encoding;
    }

    this.constructed = true;
  }
}

class Readable extends Stream {
  _construct?: (cb: (error?: Error) => void) => void;
  _readableState: ReadableState;

  constructor(options?: ReadableOptions) {
    super();
    if (options) {
      if (typeof options.read === "function") {
        this._read = options.read;
      }
      if (typeof options.destroy === "function") {
        this._destroy = options.destroy;
      }
      if (typeof options.construct === "function") {
        this._construct = options.construct;
      }
    }
    this._readableState = new ReadableState(options);

    construct(this, () => {
      maybeReadMore(this, this._readableState);
    });
  }

  static from(
    // deno-lint-ignore no-explicit-any
    iterable: Iterable<any> | AsyncIterable<any>,
    opts?: ReadableOptions,
  ): Readable {
    return streamFrom(iterable, opts);
  }

  static ReadableState = ReadableState;

  static _fromList = fromList;

  // You can override either this method, or the async _read(n) below.
  read(n?: number) {
    // Same as parseInt(undefined, 10), however V8 7.3 performance regressed
    // in this scenario, so we are doing it manually.
    if (n === undefined) {
      n = NaN;
    }
    const state = this._readableState;
    const nOrig = n;

    // If we're asking for more than the current hwm, then raise the hwm.
    if (n > state.highWaterMark) {
      state.highWaterMark = computeNewHighWaterMark(n);
    }

    if (n !== 0) {
      state.emittedReadable = false;
    }

    // If we're doing read(0) to trigger a readable event, but we
    // already have a bunch of data in the buffer, then just trigger
    // the 'readable' event and move on.
    if (
      n === 0 &&
      state.needReadable &&
      ((state.highWaterMark !== 0
        ? state.length >= state.highWaterMark
        : state.length > 0) ||
        state.ended)
    ) {
      if (state.length === 0 && state.ended) {
        endReadable(this);
      } else {
        emitReadable(this);
      }
      return null;
    }

    n = howMuchToRead(n, state);

    // If we've ended, and we're now clear, then finish it up.
    if (n === 0 && state.ended) {
      if (state.length === 0) {
        endReadable(this);
      }
      return null;
    }

    // All the actual chunk generation logic needs to be
    // *below* the call to _read.  The reason is that in certain
    // synthetic stream cases, such as passthrough streams, _read
    // may be a completely synchronous operation which may change
    // the state of the read buffer, providing enough data when
    // before there was *not* enough.
    //
    // So, the steps are:
    // 1. Figure out what the state of things will be after we do
    // a read from the buffer.
    //
    // 2. If that resulting state will trigger a _read, then call _read.
    // Note that this may be asynchronous, or synchronous.  Yes, it is
    // deeply ugly to write APIs this way, but that still doesn't mean
    // that the Readable class should behave improperly, as streams are
    // designed to be sync/async agnostic.
    // Take note if the _read call is sync or async (ie, if the read call
    // has returned yet), so that we know whether or not it's safe to emit
    // 'readable' etc.
    //
    // 3. Actually pull the requested chunks out of the buffer and return.

    // if we need a readable event, then we need to do some reading.
    let doRead = state.needReadable;
    // If we currently have less than the highWaterMark, then also read some.
    if (
      state.length === 0 || state.length - (n as number) < state.highWaterMark
    ) {
      doRead = true;
    }

    // However, if we've ended, then there's no point, if we're already
    // reading, then it's unnecessary, if we're constructing we have to wait,
    // and if we're destroyed or errored, then it's not allowed,
    if (
      state.ended || state.reading || state.destroyed || state.errored ||
      !state.constructed
    ) {
      doRead = false;
    } else if (doRead) {
      state.reading = true;
      state.sync = true;
      // If the length is currently zero, then we *need* a readable event.
      if (state.length === 0) {
        state.needReadable = true;
      }
      // Call internal read method
      this._read(state.highWaterMark);
      state.sync = false;
      // If _read pushed data synchronously, then `reading` will be false,
      // and we need to re-evaluate how much data we can return to the user.
      if (!state.reading) {
        n = howMuchToRead(nOrig, state);
      }
    }

    let ret;
    if ((n as number) > 0) {
      ret = fromList((n as number), state);
    } else {
      ret = null;
    }

    if (ret === null) {
      state.needReadable = state.length <= state.highWaterMark;
      n = 0;
    } else {
      state.length -= n as number;
      if (state.multiAwaitDrain) {
        (state.awaitDrainWriters as Set<Writable>).clear();
      } else {
        state.awaitDrainWriters = null;
      }
    }

    if (state.length === 0) {
      // If we have nothing in the buffer, then we want to know
      // as soon as we *do* get something into the buffer.
      if (!state.ended) {
        state.needReadable = true;
      }

      // If we tried to read() past the EOF, then emit end on the next tick.
      if (nOrig !== n && state.ended) {
        endReadable(this);
      }
    }

    if (ret !== null) {
      this.emit("data", ret);
    }

    return ret;
  }

  // Abstract method.  to be overridden in specific implementation classes.
  // call cb(er, data) where data is <= n in length.
  // for virtual (non-string, non-buffer) streams, "length" is somewhat
  // arbitrary, and perhaps not very meaningful.
  _read(n?: number) {
    throw new ERR_METHOD_NOT_IMPLEMENTED("_read()");
  }

  //TODO(Soremwar)
  //Should be duplex
  pipe<T extends Writable>(dest: T, pipeOpts?: { end?: boolean }): T {
    // deno-lint-ignore no-this-alias
    const src = this;
    const state = this._readableState;

    if (state.pipes.length === 1) {
      if (!state.multiAwaitDrain) {
        state.multiAwaitDrain = true;
        state.awaitDrainWriters = new Set(
          state.awaitDrainWriters ? [state.awaitDrainWriters as Writable] : [],
        );
      }
    }

    state.pipes.push(dest);

    const doEnd = (!pipeOpts || pipeOpts.end !== false);

    //TODO
    //Part of doEnd condition
    //In  node, output is a writable Stream
    // &&
    // dest !== stdout &&
    // dest !== stderr

    const endFn = doEnd ? onend : unpipe;
    if (state.endEmitted) {
      queueMicrotask(endFn);
    } else {
      this.once("end", endFn);
    }

    dest.on("unpipe", onunpipe);
    function onunpipe(readable: Readable, unpipeInfo: { hasUnpiped: boolean }) {
      if (readable === src) {
        if (unpipeInfo && unpipeInfo.hasUnpiped === false) {
          unpipeInfo.hasUnpiped = true;
          cleanup();
        }
      }
    }

    function onend() {
      dest.end();
    }

    let ondrain: () => void;

    let cleanedUp = false;
    function cleanup() {
      // Cleanup event handlers once the pipe is broken.
      dest.removeListener("close", onclose);
      dest.removeListener("finish", onfinish);
      if (ondrain) {
        dest.removeListener("drain", ondrain);
      }
      dest.removeListener("error", onerror);
      dest.removeListener("unpipe", onunpipe);
      src.removeListener("end", onend);
      src.removeListener("end", unpipe);
      src.removeListener("data", ondata);

      cleanedUp = true;

      // If the reader is waiting for a drain event from this
      // specific writer, then it would cause it to never start
      // flowing again.
      // So, if this is awaiting a drain, then we just call it now.
      // If we don't know, then assume that we are waiting for one.
      if (
        ondrain && state.awaitDrainWriters &&
        (!dest._writableState || dest._writableState.needDrain)
      ) {
        ondrain();
      }
    }

    this.on("data", ondata);
    // deno-lint-ignore no-explicit-any
    function ondata(chunk: any) {
      const ret = dest.write(chunk);
      if (ret === false) {
        // If the user unpiped during `dest.write()`, it is possible
        // to get stuck in a permanently paused state if that write
        // also returned false.
        // => Check whether `dest` is still a piping destination.
        if (!cleanedUp) {
          if (state.pipes.length === 1 && state.pipes[0] === dest) {
            state.awaitDrainWriters = dest;
            state.multiAwaitDrain = false;
          } else if (state.pipes.length > 1 && state.pipes.includes(dest)) {
            (state.awaitDrainWriters as Set<Writable>).add(dest);
          }
          src.pause();
        }
        if (!ondrain) {
          // When the dest drains, it reduces the awaitDrain counter
          // on the source.  This would be more elegant with a .once()
          // handler in flow(), but adding and removing repeatedly is
          // too slow.
          ondrain = pipeOnDrain(src, dest);
          dest.on("drain", ondrain);
        }
      }
    }

    // If the dest has an error, then stop piping into it.
    // However, don't suppress the throwing behavior for this.
    function onerror(er: Error) {
      unpipe();
      dest.removeListener("error", onerror);
      if (dest.listenerCount("error") === 0) {
        //TODO(Soremwar)
        //Should be const s = dest._writableState || dest._readableState;
        const s = dest._writableState;
        if (s && !s.errorEmitted) {
          // User incorrectly emitted 'error' directly on the stream.
          errorOrDestroyDuplex(dest, er);
        } else {
          dest.emit("error", er);
        }
      }
    }

    // Make sure our error handler is attached before userland ones.
    prependListener(dest, "error", onerror);

    // Both close and finish should trigger unpipe, but only once.
    function onclose() {
      dest.removeListener("finish", onfinish);
      unpipe();
    }
    dest.once("close", onclose);
    function onfinish() {
      dest.removeListener("close", onclose);
      unpipe();
    }
    dest.once("finish", onfinish);

    function unpipe() {
      src.unpipe(dest);
    }

    // Tell the dest that it's being piped to.
    dest.emit("pipe", this);

    // Start the flow if it hasn't been started already.
    if (!state.flowing) {
      this.resume();
    }

    return dest;
  }

  isPaused() {
    return this._readableState[kPaused] === true ||
      this._readableState.flowing === false;
  }

  //TODO
  //Replace string with encoding types
  setEncoding(enc: string) {
    const decoder = new StringDecoder(enc);
    this._readableState.decoder = decoder;
    // If setEncoding(null), decoder.encoding equals utf8.
    this._readableState.encoding = this._readableState.decoder.encoding;

    const buffer = this._readableState.buffer;
    // Iterate over current buffer to convert already stored Buffers:
    let content = "";
    for (const data of buffer) {
      content += decoder.write(data as Buffer);
    }
    buffer.clear();
    if (content !== "") {
      buffer.push(content);
    }
    this._readableState.length = content.length;
    return this;
  }

  on(
    event: "close" | "end" | "pause" | "readable" | "resume",
    listener: () => void,
  ): this;
  // deno-lint-ignore no-explicit-any
  on(event: "data", listener: (chunk: any) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  // deno-lint-ignore no-explicit-any
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  on(
    ev: string | symbol,
    fn:
      | (() => void)
      // deno-lint-ignore no-explicit-any
      | ((chunk: any) => void)
      | ((err: Error) => void)
      // deno-lint-ignore no-explicit-any
      | ((...args: any[]) => void),
  ) {
    const res = super.on.call(this, ev, fn);
    const state = this._readableState;

    if (ev === "data") {
      // Update readableListening so that resume() may be a no-op
      // a few lines down. This is needed to support once('readable').
      state.readableListening = this.listenerCount("readable") > 0;

      // Try start flowing on next tick if stream isn't explicitly paused.
      if (state.flowing !== false) {
        this.resume();
      }
    } else if (ev === "readable") {
      if (!state.endEmitted && !state.readableListening) {
        state.readableListening = state.needReadable = true;
        state.flowing = false;
        state.emittedReadable = false;
        if (state.length) {
          emitReadable(this);
        } else if (!state.reading) {
          queueMicrotask(() => nReadingNextTick(this));
        }
      }
    }

    return res;
  }

  removeListener(
    event: "close" | "end" | "pause" | "readable" | "resume",
    listener: () => void,
  ): this;
  // deno-lint-ignore no-explicit-any
  removeListener(event: "data", listener: (chunk: any) => void): this;
  removeListener(event: "error", listener: (err: Error) => void): this;
  removeListener(
    event: string | symbol,
    // deno-lint-ignore no-explicit-any
    listener: (...args: any[]) => void,
  ): this;
  removeListener(
    ev: string | symbol,
    fn:
      | (() => void)
      // deno-lint-ignore no-explicit-any
      | ((chunk: any) => void)
      | ((err: Error) => void)
      // deno-lint-ignore no-explicit-any
      | ((...args: any[]) => void),
  ) {
    const res = super.removeListener.call(this, ev, fn);

    if (ev === "readable") {
      // We need to check if there is someone still listening to
      // readable and reset the state. However this needs to happen
      // after readable has been emitted but before I/O (nextTick) to
      // support once('readable', fn) cycles. This means that calling
      // resume within the same tick will have no
      // effect.
      queueMicrotask(() => updateReadableListening(this));
    }

    return res;
  }

  off = this.removeListener;

  destroy(err?: Error, cb?: () => void) {
    const r = this._readableState;

    if (r.destroyed) {
      if (typeof cb === "function") {
        cb();
      }

      return this;
    }

    if (err) {
      // Avoid V8 leak, https://github.com/nodejs/node/pull/34103#issuecomment-652002364
      err.stack;

      if (!r.errored) {
        r.errored = err;
      }
    }

    r.destroyed = true;

    // If still constructing then defer calling _destroy.
    if (!r.constructed) {
      this.once(kDestroy, (er: Error) => {
        _destroy(this, err || er, cb);
      });
    } else {
      _destroy(this, err, cb);
    }

    return this;
  }

  _undestroy() {
    const r = this._readableState;
    r.constructed = true;
    r.closed = false;
    r.closeEmitted = false;
    r.destroyed = false;
    r.errored = null;
    r.errorEmitted = false;
    r.reading = false;
    r.ended = false;
    r.endEmitted = false;
  }

  _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ): void {
    callback(error);
  }

  [captureRejectionSymbol](err: Error) {
    this.destroy(err);
  }

  //TODO(Soremwar)
  //Same deal, string => encodings
  // deno-lint-ignore no-explicit-any
  push(chunk: any, encoding?: string): boolean {
    return readableAddChunk(this, chunk, encoding, false);
  }

  // deno-lint-ignore no-explicit-any
  unshift(chunk: any, encoding?: string): boolean {
    return readableAddChunk(this, chunk, encoding, true);
  }

  unpipe(dest?: Writable): this {
    const state = this._readableState;
    const unpipeInfo = { hasUnpiped: false };

    // If we're not piping anywhere, then do nothing.
    if (state.pipes.length === 0) {
      return this;
    }

    if (!dest) {
      // remove all.
      const dests = state.pipes;
      state.pipes = [];
      this.pause();

      for (const dest of dests) {
        dest.emit("unpipe", this, { hasUnpiped: false });
      }
      return this;
    }

    // Try to find the right one.
    const index = state.pipes.indexOf(dest);
    if (index === -1) {
      return this;
    }

    state.pipes.splice(index, 1);
    if (state.pipes.length === 0) {
      this.pause();
    }

    dest.emit("unpipe", this, unpipeInfo);

    return this;
  }

  removeAllListeners(
    ev:
      | "close"
      | "data"
      | "end"
      | "error"
      | "pause"
      | "readable"
      | "resume"
      | symbol
      | undefined,
  ) {
    const res = super.removeAllListeners(ev);

    if (ev === "readable" || ev === undefined) {
      // We need to check if there is someone still listening to
      // readable and reset the state. However this needs to happen
      // after readable has been emitted but before I/O (nextTick) to
      // support once('readable', fn) cycles. This means that calling
      // resume within the same tick will have no
      // effect.
      queueMicrotask(() => updateReadableListening(this));
    }

    return res;
  }

  // pause() and resume() are remnants of the legacy readable stream API
  // If the user uses them, then switch into old mode.
  resume() {
    const state = this._readableState;
    if (!state.flowing) {
      // We flow only if there is no one listening
      // for readable, but we still have to call
      // resume().
      state.flowing = !state.readableListening;
      resume(this, state);
    }
    state[kPaused] = false;
    return this;
  }

  pause() {
    if (this._readableState.flowing !== false) {
      this._readableState.flowing = false;
      this.emit("pause");
    }
    this._readableState[kPaused] = true;
    return this;
  } // Wrap an old-style stream as the async data source.
  // This is *not* part of the readable stream interface.
  // It is an ugly unfortunate mess of history.

  wrap(stream: Stream): this {
    const state = this._readableState;
    let paused = false;

    stream.on("end", () => {
      if (state.decoder && !state.ended) {
        const chunk = state.decoder.end();
        if (chunk && chunk.length) {
          this.push(chunk);
        }
      }

      this.push(null);
    });

    stream.on("data", (chunk) => {
      if (state.decoder) {
        chunk = state.decoder.write(chunk);
      }

      // Don't skip over falsy values in objectMode.
      if (state.objectMode && (chunk === null || chunk === undefined)) {
        return;
      } else if (!state.objectMode && (!chunk || !chunk.length)) {
        return;
      }

      const ret = this.push(chunk);
      if (!ret) {
        paused = true;
        //TODO
        //By the time this is triggered, stream will be a readable stream
        // deno-lint-ignore ban-ts-comment
        //@ts-ignore
        stream.pause();
      }
    });

    //TODO(Soremwar)
    //There must be a clean way to implement this on TypeScript
    // Proxy all the other methods. Important when wrapping filters and duplexes.
    for (const i in stream) {
      // deno-lint-ignore ban-ts-comment
      //@ts-ignore
      if (this[i] === undefined && typeof stream[i] === "function") {
        // deno-lint-ignore ban-ts-comment
        //@ts-ignore
        this[i] = function methodWrap(method) {
          return function methodWrapReturnFunction() {
            // deno-lint-ignore ban-ts-comment
            //@ts-ignore
            return stream[method].apply(stream, arguments);
          };
        }(i);
      }
    }

    stream.on("error", (err) => {
      errorOrDestroy(this, err);
    });

    stream.on("close", () => {
      this.emit("close");
    });

    stream.on("destroy", () => {
      this.emit("destroy");
    });

    stream.on("pause", () => {
      this.emit("pause");
    });

    stream.on("resume", () => {
      this.emit("resume");
    });

    // When we try to consume some more bytes, simply unpause the
    // underlying stream.
    this._read = (n) => {
      if (paused) {
        paused = false;
        //By the time this is triggered, stream will be a readable stream
        // deno-lint-ignore ban-ts-comment
        //@ts-ignore
        stream.resume();
      }
    };

    return this;
  }

  [Symbol.asyncIterator]() {
    return createReadableStreamAsyncIterator(this);
  }

  get readable(): boolean {
    return this._readableState?.readable &&
      !this._readableState?.destroyed &&
      !this._readableState?.errorEmitted &&
      !this._readableState?.endEmitted;
  }
  set readable(val: boolean) {
    if (this._readableState) {
      this._readableState.readable = val;
    }
  }

  get readableHighWaterMark(): number {
    return this._readableState.highWaterMark;
  }

  get readableBuffer() {
    return this._readableState && this._readableState.buffer;
  }

  get readableFlowing(): boolean | null {
    return this._readableState.flowing;
  }

  set readableFlowing(state: boolean | null) {
    if (this._readableState) {
      this._readableState.flowing = state;
    }
  }

  get readableLength() {
    return this._readableState.length;
  }

  get readableObjectMode() {
    return this._readableState ? this._readableState.objectMode : false;
  }

  get readableEncoding() {
    return this._readableState ? this._readableState.encoding : null;
  }

  get destroyed() {
    if (this._readableState === undefined) {
      return false;
    }
    return this._readableState.destroyed;
  }

  set destroyed(value: boolean) {
    if (!this._readableState) {
      return;
    }
    this._readableState.destroyed = value;
  }

  get readableEnded() {
    return this._readableState ? this._readableState.endEmitted : false;
  }
}

Object.defineProperties(Stream, {
  _readableState: { enumerable: false },
  destroyed: { enumerable: false },
  readableBuffer: { enumerable: false },
  readableEncoding: { enumerable: false },
  readableEnded: { enumerable: false },
  readableFlowing: { enumerable: false },
  readableHighWaterMark: { enumerable: false },
  readableLength: { enumerable: false },
  readableObjectMode: { enumerable: false },
});

export default Readable;
