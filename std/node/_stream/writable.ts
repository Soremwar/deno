//TODO@Soremwar
//Typescript
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

// A bit simpler than readable streams.
// Implement an async ._write(chunk, encoding, cb), and it'll handle all
// the drain event emission and buffering.

import {
  captureRejectionSymbol,
} from "../events.ts";
import Stream from "./stream.ts";
import Buffer from "../buffer.ts";
import {
  construct,
  destroy,
  undestroy,
  errorOrDestroy,
} from "./destroy.js";
import {
  codes as error_codes,
} from "../internal/errors.js";

const {
  //@ts-ignore
  ERR_INVALID_ARG_TYPE,
  //@ts-ignore
  ERR_METHOD_NOT_IMPLEMENTED,
  //@ts-ignore
  ERR_MULTIPLE_CALLBACK,
  //@ts-ignore
  ERR_STREAM_CANNOT_PIPE,
  //@ts-ignore
  ERR_STREAM_DESTROYED,
  //@ts-ignore
  ERR_STREAM_ALREADY_FINISHED,
  //@ts-ignore
  ERR_STREAM_NULL_VALUES,
  //@ts-ignore
  ERR_STREAM_WRITE_AFTER_END,
  //@ts-ignore
  ERR_UNKNOWN_ENCODING,
  //@ts-ignore
  ERR_INVALID_OPT_VALUE,
} = error_codes;

function nop() {}

const errorMe = (...args: any[]) => {};
export { errorMe as errorOrDestroy };

//TODO
//Bring in encodings
type write_v = (
  // deno-lint-ignore no-explicit-any
  chunks: Array<{ chunk: any; encoding: string }>,
  callback: (error?: Error | null) => void,
) => void;

type AfterWriteTick = {
  cb: (error?: Error) => void;
  count: number;
  state: WritableState;
  stream: Writable;
};

const kOnFinished = Symbol("kOnFinished");

//TODO
//Bring encodings in
function writeOrBuffer(
  stream: Writable,
  state: WritableState,
  // deno-lint-ignore no-explicit-any
  chunk: any,
  encoding: string,
  callback: (error: Error) => void,
) {
  const len = state.objectMode ? 1 : chunk.length;

  state.length += len;

  if (state.writing || state.corked || state.errored || !state.constructed) {
    state.buffered.push({ chunk, encoding, callback });
    if (state.allBuffers && encoding !== "buffer") {
      state.allBuffers = false;
    }
    if (state.allNoop && callback !== nop) {
      state.allNoop = false;
    }
  } else {
    state.writelen = len;
    state.writecb = callback;
    state.writing = true;
    state.sync = true;
    stream._write(chunk, encoding, state.onwrite);
    state.sync = false;
  }

  const ret = state.length < state.highWaterMark;

  // We must ensure that previous needDrain will not be reset to false.
  if (!ret) {
    state.needDrain = true;
  }

  // Return false if errored or destroyed in order to break
  // any synchronous while(stream.write(data)) loops.
  return ret && !state.errored && !state.destroyed;
}

//TODO
//Bring encodings in
function doWrite(
  stream: Writable,
  state: WritableState,
  writev: boolean,
  len: number,
  // deno-lint-ignore no-explicit-any
  chunk: any,
  encoding: string,
  cb: (error: Error) => void,
) {
  state.writelen = len;
  state.writecb = cb;
  state.writing = true;
  state.sync = true;
  if (state.destroyed) {
    state.onwrite(new ERR_STREAM_DESTROYED("write"));
  } else if (writev) {
    (stream._writev as unknown as write_v)(chunk, state.onwrite);
  } else {
    stream._write(chunk, encoding, state.onwrite);
  }
  state.sync = false;
}

function onwriteError(
  stream: Writable,
  state: WritableState,
  er: Error,
  cb: (error: Error) => void,
) {
  --state.pendingcb;

  cb(er);
  // Ensure callbacks are invoked even when autoDestroy is
  // not enabled. Passing `er` here doesn't make sense since
  // it's related to one specific write, not to the buffered
  // writes.
  errorBuffer(state);
  // This can emit error, but error must always follow cb.
  errorOrDestroy(stream, er);
}

function onwrite(stream: Writable, er?: Error | null) {
  const state = stream._writableState;
  const sync = state.sync;
  const cb = state.writecb;

  if (typeof cb !== "function") {
    errorOrDestroy(stream, new ERR_MULTIPLE_CALLBACK());
    return;
  }

  state.writing = false;
  state.writecb = null;
  state.length -= state.writelen;
  state.writelen = 0;

  if (er) {
    // Avoid V8 leak, https://github.com/nodejs/node/pull/34103#issuecomment-652002364
    er.stack;

    if (!state.errored) {
      state.errored = er;
    }

    if (sync) {
      //TODO(Soremwar)
      //This replaces `process.nextTick(onwriteError, stream, state, er, cb);`
      //Check if this is a reliable replace
      queueMicrotask(() => onwriteError(stream, state, er, cb));
    } else {
      onwriteError(stream, state, er, cb);
    }
  } else {
    if (state.buffered.length > state.bufferedIndex) {
      clearBuffer(stream, state);
    }

    if (sync) {
      // It is a common case that the callback passed to .write() is always
      // the same. In that case, we do not schedule a new nextTick(), but
      // rather just increase a counter, to improve performance and avoid
      // memory allocations.
      if (
        state.afterWriteTickInfo !== null &&
        state.afterWriteTickInfo.cb === cb
      ) {
        state.afterWriteTickInfo.count++;
      } else {
        state.afterWriteTickInfo = {
          count: 1,
          cb: (cb as (error?: Error) => void),
          stream,
          state,
        };
        //TODO(Soremwar)
        //This replaces `process.nextTick(afterWriteTick, state.afterWriteTickInfo);`
        //Check if this is a reliable replace
        queueMicrotask(() =>
          afterWriteTick(state.afterWriteTickInfo as AfterWriteTick)
        );
      }
    } else {
      afterWrite(stream, state, 1, cb as (error?: Error) => void);
    }
  }
}

function afterWriteTick({
  cb,
  count,
  state,
  stream,
}: AfterWriteTick) {
  state.afterWriteTickInfo = null;
  return afterWrite(stream, state, count, cb);
}

function afterWrite(
  stream: Writable,
  state: WritableState,
  count: number,
  cb: (error?: Error) => void,
) {
  const needDrain = !state.ending && !stream.destroyed && state.length === 0 &&
    state.needDrain;
  if (needDrain) {
    state.needDrain = false;
    stream.emit("drain");
  }

  while (count-- > 0) {
    state.pendingcb--;
    cb();
  }

  if (state.destroyed) {
    errorBuffer(state);
  }

  finishMaybe(stream, state);
}

// If there's something in the buffer waiting, then invoke callbacks.
function errorBuffer(state: WritableState) {
  if (state.writing) {
    return;
  }

  for (let n = state.bufferedIndex; n < state.buffered.length; ++n) {
    const { chunk, callback } = state.buffered[n];
    const len = state.objectMode ? 1 : chunk.length;
    state.length -= len;
    callback(new ERR_STREAM_DESTROYED("write"));
  }

  for (const callback of state[kOnFinished].splice(0)) {
    callback(new ERR_STREAM_DESTROYED("end"));
  }

  resetBuffer(state);
}

// If there's something in the buffer waiting, then process it.
function clearBuffer(stream: Writable, state: WritableState) {
  if (
    state.corked ||
    state.bufferProcessing ||
    state.destroyed ||
    !state.constructed
  ) {
    return;
  }

  const { buffered, bufferedIndex, objectMode } = state;
  const bufferedLength = buffered.length - bufferedIndex;

  if (!bufferedLength) {
    return;
  }

  let i = bufferedIndex;

  state.bufferProcessing = true;
  if (bufferedLength > 1 && stream._writev) {
    state.pendingcb -= bufferedLength - 1;

    const callback = state.allNoop ? nop : (err: Error) => {
      for (let n = i; n < buffered.length; ++n) {
        buffered[n].callback(err);
      }
    };
    // Make a copy of `buffered` if it's going to be used by `callback` above,
    // since `doWrite` will mutate the array.
    const chunks = state.allNoop && i === 0 ? buffered : buffered.slice(i);

    //TODO(Soremwar)
    //I cannot figure this out at
    //chunks.allBuffers = state.allBuffers;

    doWrite(stream, state, true, state.length, chunks, "", callback);

    resetBuffer(state);
  } else {
    do {
      const { chunk, encoding, callback } = buffered[i];
      //TODO(Soremwar)
      //Cant figure this out either
      //buffered[i++] = null;
      const len = objectMode ? 1 : chunk.length;
      doWrite(stream, state, false, len, chunk, encoding, callback);
    } while (i < buffered.length && !state.writing);

    if (i === buffered.length) {
      resetBuffer(state);
    } else if (i > 256) {
      buffered.splice(0, i);
      state.bufferedIndex = 0;
    } else {
      state.bufferedIndex = i;
    }
  }
  state.bufferProcessing = false;
}

function finish(stream: Writable, state: WritableState) {
  state.pendingcb--;
  // TODO (ronag): Unify with needFinish.
  if (state.errorEmitted || state.closeEmitted) {
    return;
  }

  state.finished = true;

  for (const callback of state[kOnFinished].splice(0)) {
    callback();
  }

  stream.emit("finish");

  if (state.autoDestroy) {
    stream.destroy();
  }
}

function finishMaybe(stream: Writable, state: WritableState, sync?: boolean) {
  if (needFinish(state)) {
    prefinish(stream, state);
    if (state.pendingcb === 0 && needFinish(state)) {
      state.pendingcb++;
      if (sync) {
        //TODO(Soremwar)
        //This replaces `process.nextTick(finish, stream, state);`
        //Check if this is a reliable replace
        queueMicrotask(() => finish(stream, state));
      } else {
        finish(stream, state);
      }
    }
  }
}

function prefinish(stream: Writable, state: WritableState) {
  if (!state.prefinished && !state.finalCalled) {
    if (typeof stream._final === "function" && !state.destroyed) {
      state.finalCalled = true;

      state.sync = true;
      state.pendingcb++;
      stream._final((err) => {
        state.pendingcb--;
        if (err) {
          for (const callback of state[kOnFinished].splice(0)) {
            callback(err);
          }
          errorOrDestroy(stream, err, state.sync);
        } else if (needFinish(state)) {
          state.prefinished = true;
          stream.emit("prefinish");
          // Backwards compat. Don't check state.sync here.
          // Some streams assume 'finish' will be emitted
          // asynchronously relative to _final callback.
          state.pendingcb++;
          //TODO(Soremwar)
          //This replaces `process.nextTick(finish, stream, state);`
          //Check if this is a reliable replace
          queueMicrotask(() => finish(stream, state));
        }
      });
      state.sync = false;
    } else {
      state.prefinished = true;
      stream.emit("prefinish");
    }
  }
}

function needFinish(state: WritableState) {
  return (state.ending &&
    state.constructed &&
    state.length === 0 &&
    !state.errored &&
    state.buffered.length === 0 &&
    !state.finished &&
    !state.writing);
}

interface WritableOptions {
  autoDestroy?: boolean;
  decodeStrings?: boolean;
  //TODO
  //Bring encodings in
  defaultEncoding?: string;
  destroy?(
    this: Writable,
    error: Error | null,
    callback: (error: Error | null) => void,
  ): void;
  emitClose?: boolean;
  final?(this: Writable, callback: (error?: Error | null) => void): void;
  highWaterMark?: number;
  objectMode?: boolean;
  //TODO
  //Bring encodings in
  write?(
    this: Writable,
    // deno-lint-ignore no-explicit-any
    chunk: any,
    encoding: string,
    callback: (error?: Error | null) => void,
  ): void;
  //TODO
  //Bring encodings in
  writev?(
    this: Writable,
    // deno-lint-ignore no-explicit-any
    chunks: Array<{ chunk: any; encoding: string }>,
    callback: (error?: Error | null) => void,
  ): void;
}

class WritableState {
  [kOnFinished]: Array<(error?: Error) => void> = [];
  afterWriteTickInfo: null | AfterWriteTick = null;
  allBuffers = true;
  allNoop = true;
  autoDestroy: boolean;
  //TODO
  //Bring in encodings
  buffered: Array<{
    allBuffers?: boolean;
    // deno-lint-ignore no-explicit-any
    chunk: any;
    encoding: string;
    callback: (error: Error) => void;
  }> = [];
  bufferedIndex = 0;
  bufferProcessing = false;
  closed = false;
  closeEmitted = false;
  constructed: boolean;
  corked = 0;
  decodeStrings: boolean;
  defaultEncoding: string;
  destroyed = false;
  emitClose: boolean;
  ended = false;
  ending = false;
  errored: Error | null = null;
  errorEmitted = false;
  finalCalled = false;
  finished = false;
  highWaterMark: number;
  length = 0;
  needDrain = false;
  objectMode: boolean;
  onwrite: (error?: Error | null) => void;
  pendingcb = 0;
  prefinished = false;
  sync = true;
  writecb: null | ((error: Error) => void) = null;
  writable = true;
  writelen = 0;
  writing = false;

  constructor(options: WritableOptions | undefined, stream: Writable) {
    this.objectMode = !!options?.objectMode;

    this.highWaterMark = options?.highWaterMark ??
      (this.objectMode ? 16 : 16 * 1024);

    if (Number.isInteger(this.highWaterMark) && this.highWaterMark >= 0) {
      this.highWaterMark = Math.floor(this.highWaterMark);
    } else {
      throw new ERR_INVALID_OPT_VALUE("highWaterMark", this.highWaterMark);
    }

    this.decodeStrings = !options?.decodeStrings === false;

    this.defaultEncoding = options?.defaultEncoding || "utf8";

    this.onwrite = onwrite.bind(undefined, stream);

    resetBuffer(this);

    this.emitClose = options?.emitClose ?? true;
    this.autoDestroy = options?.autoDestroy ?? true;
    this.constructed = true;
  }

  getBuffer() {
    return this.buffered.slice(this.bufferedIndex);
  }

  get bufferedRequestCount() {
    return this.buffered.length - this.bufferedIndex;
  }
}

function resetBuffer(state: WritableState) {
  state.buffered = [];
  state.bufferedIndex = 0;
  state.allBuffers = true;
  state.allNoop = true;
}

class Writable extends Stream {
  _final?: (
    this: Writable,
    callback: (error?: Error | null | undefined) => void,
  ) => void;
  _writableState: WritableState;
  _writev?: write_v | null = null;

  constructor(options?: WritableOptions) {
    super();
    this._writableState = new WritableState(options, this);

    if (options) {
      if (typeof options.write === "function") {
        this._write = options.write;
      }

      if (typeof options.writev === "function") {
        this._writev = options.writev;
      }

      if (typeof options.destroy === "function") {
        this._destroy = options.destroy;
      }

      if (typeof options.final === "function") {
        this._final = options.final;
      }
    }

    construct(this, () => {
      const state = this._writableState;

      if (!state.writing) {
        clearBuffer(this, state);
      }

      finishMaybe(this, state);
    });
  }

  [captureRejectionSymbol](err?: Error) {
    this.destroy(err);
  }

  static WritableState = WritableState;

  get destroyed() {
    return this._writableState ? this._writableState.destroyed : false;
  }

  set destroyed(value) {
    // Backward compatibility, the user is explicitly managing destroyed.
    if (this._writableState) {
      this._writableState.destroyed = value;
    }
  }

  get writable() {
    const w = this._writableState;
    return !w.destroyed && !w.errored && !w.ending && !w.ended;
  }

  set writable(val) {
    // Backwards compatible.
    if (this._writableState) {
      this._writableState.writable = !!val;
    }
  }

  get writableFinished() {
    return this._writableState ? this._writableState.finished : false;
  }

  get writableObjectMode() {
    return this._writableState ? this._writableState.objectMode : false;
  }

  get writableBuffer() {
    return this._writableState && this._writableState.getBuffer();
  }

  get writableEnded() {
    return this._writableState ? this._writableState.ending : false;
  }

  get writableHighWaterMark() {
    return this._writableState && this._writableState.highWaterMark;
  }

  get writableCorked() {
    return this._writableState ? this._writableState.corked : 0;
  }

  get writableLength() {
    return this._writableState && this._writableState.length;
  }

  _undestroy = undestroy;

  _destroy(err: Error | null, cb: (error?: Error | null) => void) {
    cb(err);
  }

  destroy(err?: Error, cb?: () => void) {
    const state = this._writableState;
    if (!state.destroyed) {
      //TODO(Soremwar)
      //This replaces `process.nextTick(errorBuffer, state);`
      //Check if this is a reliable replace
      queueMicrotask(() => errorBuffer(state));
    }
    destroy.call(this, err, cb);
    return this;
  }

  end(cb?: () => void): void;
  // deno-lint-ignore no-explicit-any
  end(chunk: any, cb?: () => void): void;
  //TODO
  //Bring in encodings
  // deno-lint-ignore no-explicit-any
  end(chunk: any, encoding: string, cb?: () => void): void;

  end(
    // deno-lint-ignore no-explicit-any
    x?: any | (() => void),
    //TODO
    //Bring in encodings
    y?: string | (() => void),
    z?: () => void,
  ) {
    const state = this._writableState;
    // deno-lint-ignore no-explicit-any
    let chunk: any | null;
    //TODO
    //Bring in encodings
    let encoding: string | null;
    let cb: undefined | ((error?: Error) => void);

    if (typeof x === "function") {
      chunk = null;
      encoding = null;
      cb = x;
    } else if (typeof y === "function") {
      chunk = x;
      encoding = null;
      cb = y;
    } else {
      chunk = x;
      encoding = y as string;
      cb = z;
    }

    if (chunk !== null && chunk !== undefined) {
      this.write(chunk, encoding);
    }

    // .end() fully uncorks.
    if (state.corked) {
      state.corked = 1;
      this.uncork();
    }

    // This is forgiving in terms of unnecessary calls to end() and can hide
    // logic errors. However, usually such errors are harmless and causing a
    // hard error can be disproportionately destructive. It is not always
    // trivial for the user to determine whether end() needs to be called or not.
    let err: Error | undefined;
    if (!state.errored && !state.ending) {
      state.ending = true;
      finishMaybe(this, state, true);
      state.ended = true;
    } else if (state.finished) {
      err = new ERR_STREAM_ALREADY_FINISHED("end");
    } else if (state.destroyed) {
      err = new ERR_STREAM_DESTROYED("end");
    }

    if (typeof cb === "function") {
      if (err || state.finished) {
        //TODO(Soremwar)
        //This replaces `process.nextTick(cb, err);`
        //Check if this is a reliable replace
        queueMicrotask(() => {
          (cb as (error?: Error | undefined) => void)(err);
        });
      } else {
        state[kOnFinished].push(cb);
      }
    }

    return this;
  }

  //TODO
  //Bring in encodings
  _write(
    // deno-lint-ignore no-explicit-any
    chunk: any,
    encoding: string,
    cb: (error?: Error | null) => void,
  ): void {
    if (this._writev) {
      this._writev([{ chunk, encoding }], cb);
    } else {
      throw new ERR_METHOD_NOT_IMPLEMENTED("_write()");
    }
  }

  //This signature was changed to keep inheritance coherent
  pipe(dest: Writable, options: { end: boolean }): Writable {
    errorOrDestroy(this, new ERR_STREAM_CANNOT_PIPE());
    return dest;
  }

  // deno-lint-ignore no-explicit-any
  write(chunk: any, cb?: (error: Error | null | undefined) => void): boolean;
  //TODO
  //Bring in encodings
  write(
    // deno-lint-ignore no-explicit-any
    chunk: any,
    encoding: string | null,
    cb?: (error: Error | null | undefined) => void,
  ): boolean;

  //TODO
  //Bring in encodings
  write(
    // deno-lint-ignore no-explicit-any
    chunk: any,
    x?: string | null | ((error: Error | null | undefined) => void),
    y?: ((error: Error | null | undefined) => void),
  ) {
    const state = this._writableState;
    //TODO
    //Bring in encodings
    let encoding: string;
    let cb: (error?: Error | null) => void;

    if (typeof x === "function") {
      cb = x;
      encoding = state.defaultEncoding;
    } else {
      if (!x) {
        encoding = state.defaultEncoding;
      } else if (x !== "buffer" && !Buffer.isEncoding(x)) {
        throw new ERR_UNKNOWN_ENCODING(x);
      } else {
        encoding = x;
      }
      if (typeof y !== "function") {
        cb = nop;
      } else {
        cb = y;
      }
    }

    if (chunk === null) {
      throw new ERR_STREAM_NULL_VALUES();
    } else if (!state.objectMode) {
      if (typeof chunk === "string") {
        if (state.decodeStrings !== false) {
          chunk = Buffer.from(chunk, encoding);
          encoding = "buffer";
        }
      } else if (chunk instanceof Buffer) {
        encoding = "buffer";
      } else if (Stream._isUint8Array(chunk)) {
        chunk = Stream._uint8ArrayToBuffer(chunk);
        encoding = "buffer";
      } else {
        throw new ERR_INVALID_ARG_TYPE(
          "chunk",
          ["string", "Buffer", "Uint8Array"],
          chunk,
        );
      }
    }

    let err: Error | undefined;
    if (state.ending) {
      err = new ERR_STREAM_WRITE_AFTER_END();
    } else if (state.destroyed) {
      err = new ERR_STREAM_DESTROYED("write");
    }

    if (err) {
      //TODO(Soremwar)
      //This replaces `process.nextTick(cb, err);`
      //Check if this is a reliable replace
      queueMicrotask(() => cb(err));
      errorOrDestroy(this, err, true);
      return false;
    }
    state.pendingcb++;
    return writeOrBuffer(this, state, chunk, encoding, cb);
  }

  cork() {
    this._writableState.corked++;
  }

  uncork() {
    const state = this._writableState;

    if (state.corked) {
      state.corked--;

      if (!state.writing) {
        clearBuffer(this, state);
      }
    }
  }

  //TODO
  //Bring allowed encodings
  setDefaultEncoding(encoding: string) {
    // node::ParseEncoding() requires lower case.
    if (typeof encoding === "string") {
      encoding = encoding.toLowerCase();
    }
    if (!Buffer.isEncoding(encoding)) {
      throw new ERR_UNKNOWN_ENCODING(encoding);
    }
    this._writableState.defaultEncoding = encoding;
    return this;
  }
}

export default Writable;
export {
  WritableState,
};
