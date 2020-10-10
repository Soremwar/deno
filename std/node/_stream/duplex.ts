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

import { captureRejectionSymbol } from "../events.ts";
import Readable, {
  ReadableState,
} from "./readable.ts";
import Stream from "./stream.ts";
import Writable, {
  WritableState,
} from "./writable.ts";
import {
  StringDecoder,
} from "../string_decoder.ts";
import Buffer from "../buffer.ts";
import {
  kPaused,
} from "./symbols.ts";
import {
  ERR_INVALID_ARG_TYPE,
  ERR_METHOD_NOT_IMPLEMENTED, ERR_STREAM_ALREADY_FINISHED, ERR_STREAM_DESTROYED, ERR_STREAM_NULL_VALUES, ERR_STREAM_WRITE_AFTER_END, ERR_UNKNOWN_ENCODING,
} from "../_errors.ts";
import createReadableStreamAsyncIterator from "./async_iterator.ts";
import {
  _destroy,
  computeNewHighWaterMark,
  emitReadable,
  fromList,
  howMuchToRead,
  nReadingNextTick,
  pipeOnDrain,
  prependListener,
  readableAddChunk,
  resume,
  updateReadableListening,
} from "./readable_internal.ts";
import {
  clearBuffer,
  kOnFinished,
  nop,
  writeOrBuffer,
} from "./writable_internal.ts";
import {
  endDuplex,
  errorOrDestroy,
  finishMaybe,
  onwrite,
} from "./duplex_internal.ts";
export {errorOrDestroy} from "./duplex_internal.ts";

export interface DuplexOptions {
  allowHalfOpen?: boolean;
  autoDestroy?: boolean;
  decodeStrings?: boolean;
  //TODO
  //Bring encodings in
  defaultEncoding?: string;
  destroy?(this: Duplex, error: Error | null, callback: (error: Error | null) => void): void;
  emitClose?: boolean;
  //TODO(Soremwar)
  //Import available encodings
  encoding?: string;
  final?(this: Duplex, callback: (error?: Error | null) => void): void;
  highWaterMark?: number;
  objectMode?: boolean;
  read?(this: Duplex, size: number): void;
  readable?: boolean;
  readableHighWaterMark?: number;
  readableObjectMode?: boolean;
  writable?: boolean;
  writableCorked?: number;
  writableHighWaterMark?: number;
  writableObjectMode?: boolean;
  //TODO(Soremwar)
  //Bring encodings in
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write?(this: Duplex, chunk: any, encoding: string, callback: (error?: Error | null) => void): void;
  //TODO(Soremwar)
  //Bring encodings in
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  writev?(this: Duplex, chunks: Array<{ chunk: any, encoding: string }>, callback: (error?: Error | null) => void): void;
}

/**
 * A duplex is an implementation of a stream that has both Readable and Writable
 * attributes and capabilities
 */
class Duplex extends Stream {
  allowHalfOpen = true;
  _final?: (
    this: Duplex,
    callback: (error?: Error | null | undefined) => void,
  ) => void;
  _readableState: ReadableState;
  _writableState: WritableState;
  _writev?: ((
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chunks: Array<{ chunk: any; encoding: string }>,
    callback: (error?: Error | null) => void,
  ) => void) | null;
  
  constructor(options?: DuplexOptions){
    super();

    if (options) {
      if (options.allowHalfOpen === false) {
        this.allowHalfOpen = false;
      }
      if (typeof options.destroy === "function") {
        this._destroy = options.destroy;
      }
      if (typeof options.final === "function") {
        this._final = options.final;
      }
      if (typeof options.read === "function") {
        this._read = options.read;
      }
      if (options.readable === false){
        this.readable = false;
      }
      if (options.writable === false){
        this.writable = false;
      }
      if (typeof options.write === "function") {
        this._write = options.write;
      }
      if (typeof options.writev === "function") {
        this._writev = options.writev;
      }
    }

    const readable_options = {
      autoDestroy: options?.autoDestroy,
      defaultEncoding: options?.defaultEncoding,
      destroy: options?.destroy as unknown as (
        this: Readable,
        error: Error | null,
        callback: (error: Error | null) => void,
      ) => void,
      emitClose: options?.emitClose,
      encoding: options?.encoding,
      highWaterMark: options?.highWaterMark ?? options?.readableHighWaterMark,
      objectMode: options?.objectMode ?? options?.readableObjectMode,
      read: options?.read as unknown as (this: Readable) => void,
    };

    const writable_options = {
      autoDestroy: options?.autoDestroy,
      decodeStrings: options?.decodeStrings,
      defaultEncoding: options?.defaultEncoding,
      destroy: options?.destroy as unknown as (
        this: Writable,
        error: Error | null,
        callback: (error: Error | null) => void,
      ) => void,
      emitClose: options?.emitClose,
      final: options?.final as unknown as (this: Writable, callback: (error?: Error | null) => void) => void,
      highWaterMark: options?.highWaterMark ?? options?.writableHighWaterMark,
      objectMode: options?.objectMode ?? options?.writableObjectMode,
      write: options?.write as unknown as (
        this: Writable,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chunk: any,
        encoding: string,
        callback: (error?: Error | null) => void,
      ) => void,
      //TODO
      //Bring encodings in
      writev: options?.writev as unknown as (
        this: Writable,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chunks: Array<{ chunk: any; encoding: string }>,
        callback: (error?: Error | null) => void,
      ) => void,
    };

    this._readableState = new ReadableState(readable_options);
    this._writableState = new WritableState(writable_options, this as unknown as Writable);
    //Very important to override onwrite here, duplex implementation adds a check
    //on the readable side
    this._writableState.onwrite = onwrite.bind(undefined, this);
  }

  [captureRejectionSymbol](err?: Error) {
    this.destroy(err);
  }

  /** You can override either this method, or the async `_read` method */
  read(n?: number) {
    // Same as parseInt(undefined, 10), however V8 7.3 performance regressed
    // in this scenario, so we are doing it manually.
    if (n === undefined) {
      n = NaN;
    }
    const state = this._readableState;
    const nOrig = n;

    if (n > state.highWaterMark) {
      state.highWaterMark = computeNewHighWaterMark(n);
    }

    if (n !== 0) {
      state.emittedReadable = false;
    }

    if (
      n === 0 &&
      state.needReadable &&
      ((state.highWaterMark !== 0
        ? state.length >= state.highWaterMark
        : state.length > 0) ||
        state.ended)
    ) {
      if (state.length === 0 && state.ended) {
        endDuplex(this);
      } else {
        emitReadable(this);
      }
      return null;
    }

    n = howMuchToRead(n, state);

    if (n === 0 && state.ended) {
      if (state.length === 0) {
        endDuplex(this);
      }
      return null;
    }

    let doRead = state.needReadable;
    if (
      state.length === 0 || state.length - (n as number) < state.highWaterMark
    ) {
      doRead = true;
    }

    if (
      state.ended || state.reading || state.destroyed || state.errored ||
      !state.constructed
    ) {
      doRead = false;
    } else if (doRead) {
      state.reading = true;
      state.sync = true;
      if (state.length === 0) {
        state.needReadable = true;
      }
      this._read();
      state.sync = false;
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
      if (!state.ended) {
        state.needReadable = true;
      }

      if (nOrig !== n && state.ended) {
        endDuplex(this);
      }
    }

    if (ret !== null) {
      this.emit("data", ret);
    }

    return ret;
  }

  _read(size?: number) {
    throw new ERR_METHOD_NOT_IMPLEMENTED("_read()");
  }

  //TODO(Soremwar)
  //Should be duplex
  pipe(dest: Duplex, pipeOpts?: { end?: boolean }): Duplex {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
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

    //TODO(Soremwar)
    //Part of doEnd condition
    //In  node, output/inout are a duplex Stream
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
    function onunpipe(readable: Duplex, unpipeInfo: { hasUnpiped: boolean }) {
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
      if (
        ondrain && state.awaitDrainWriters &&
        (!dest._writableState || dest._writableState.needDrain)
      ) {
        ondrain();
      }
    }

    this.on("data", ondata);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function ondata(chunk: any) {
      const ret = dest.write(chunk);
      if (ret === false) {
        if (!cleanedUp) {
          if (state.pipes.length === 1 && state.pipes[0] === dest) {
            state.awaitDrainWriters = dest;
            state.multiAwaitDrain = false;
          } else if (state.pipes.length > 1 && state.pipes.includes(dest)) {
            (state.awaitDrainWriters as Set<Duplex | Writable>).add(dest);
          }
          src.pause();
        }
        if (!ondrain) {
          ondrain = pipeOnDrain(src, dest);
          dest.on("drain", ondrain);
        }
      }
    }

    function onerror(er: Error) {
      unpipe();
      dest.removeListener("error", onerror);
      if (dest.listenerCount("error") === 0) {
        //TODO(Soremwar)
        //Should be const s = dest._writableState || dest._readableState;
        const s = dest._writableState;
        if (s && !s.errorEmitted) {
          // User incorrectly emitted 'error' directly on the stream.
          errorOrDestroy(dest, er);
        } else {
          dest.emit("error", er);
        }
      }
    }

    prependListener(dest, "error", onerror);

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

    dest.emit("pipe", this);

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
    this._readableState.encoding = this._readableState.decoder.encoding;

    const buffer = this._readableState.buffer;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: "data", listener: (chunk: any) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  on(
    ev: string | symbol,
    fn:
      | (() => void)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      | ((chunk: any) => void)
      | ((err: Error) => void)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      | ((...args: any[]) => void),
  ) {
    const res = super.on.call(this, ev, fn);
    const state = this._readableState;

    if (ev === "data") {
      state.readableListening = this.listenerCount("readable") > 0;

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeListener(event: "data", listener: (chunk: any) => void): this;
  removeListener(event: "error", listener: (err: Error) => void): this;
  removeListener(
    event: string | symbol,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listener: (...args: any[]) => void,
  ): this;
  removeListener(
    ev: string | symbol,
    fn:
      | (() => void)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      | ((chunk: any) => void)
      | ((err: Error) => void)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      | ((...args: any[]) => void),
  ) {
    const res = super.removeListener.call(this, ev, fn);

    if (ev === "readable") {
      queueMicrotask(() => updateReadableListening(this));
    }

    return res;
  }

  off = this.removeListener;

  destroy(err?: Error | null, cb?: (error?: Error | null) => void) {
    const r = this._readableState;
    const w = this._writableState;
  
    if (w.destroyed || r.destroyed) {
      if (typeof cb === 'function') {
        cb();
      }
  
      return this;
    }
  
    if (err) {
      // Avoid V8 leak, https://github.com/nodejs/node/pull/34103#issuecomment-652002364
      err.stack;
  
      if (!w.errored) {
        w.errored = err;
      }
      if (!r.errored) {
        r.errored = err;
      }
    }
  
    w.destroyed = true;
    r.destroyed = true;
  
    this._destroy(err || null, (err) => {
      if (err) {
        // Avoid V8 leak, https://github.com/nodejs/node/pull/34103#issuecomment-652002364
        err.stack;
  
        if (!w.errored) {
          w.errored = err;
        }
        if (!r.errored) {
          r.errored = err;
        }
      }
  
      w.closed = true;
      r.closed = true;
  
      if (typeof cb === 'function') {
        cb(err);
      }
  
      if (err) {
        queueMicrotask(() => {
          const r = this._readableState;
          const w = this._writableState;

          if (!w.errorEmitted && !r.errorEmitted) {
            w.errorEmitted = true;
            r.errorEmitted = true;
  
            this.emit('error', err);
          }

          r.closeEmitted = true;

          if (w.emitClose || r.emitClose) {
            this.emit('close');
          }
        });
      } else {
        queueMicrotask(() => {
          const r = this._readableState;
          const w = this._writableState;

          r.closeEmitted = true;

          if (w.emitClose || r.emitClose) {
            this.emit('close');
          }
        });
      }
    });
  
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

  //TODO(Soremwar)
  //Same deal, string => encodings
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  push(chunk: any, encoding?: string): boolean {
    return readableAddChunk(this, chunk, encoding, false);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unshift(chunk: any, encoding?: string): boolean {
    return readableAddChunk(this, chunk, encoding, true);
  }

  unpipe(dest?: Duplex): this {
    const state = this._readableState;
    const unpipeInfo = { hasUnpiped: false };

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
      queueMicrotask(() => updateReadableListening(this));
    }

    return res;
  }

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
  }

  /** Wrap an old-style stream as the async data source. */
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

      if (state.objectMode && (chunk === null || chunk === undefined)) {
        return;
      } else if (!state.objectMode && (!chunk || !chunk.length)) {
        return;
      }

      const ret = this.push(chunk);
      if (!ret) {
        paused = true;
        // By the time this is triggered, stream will be a readable stream
        // deno-lint-ignore ban-ts-comment
        // @ts-ignore
        stream.pause();
      }
    });

    // TODO(Soremwar)
    // There must be a clean way to implement this on TypeScript
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
            return stream[method].apply(stream);
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

    this._read = () => {
      if (paused) {
        paused = false;
        // By the time this is triggered, stream will be a readable stream
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

  get readableEnded() {
    return this._readableState ? this._readableState.endEmitted : false;
  }

  //TODO
  //Bring in encodings
  _write(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write(chunk: any, cb?: (error: Error | null | undefined) => void): boolean;
  //TODO(Soremwar)
  //Bring in encodings
  write(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chunk: any,
    encoding: string | null,
    cb?: (error: Error | null | undefined) => void,
  ): boolean;

  //TODO(Soremwar)
  //Bring in encodings
  write(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chunk: any,
    x?: string | null | ((error: Error | null | undefined) => void),
    y?: ((error: Error | null | undefined) => void),
  ) {
    const state = this._writableState;
    //TODO(Soremwar)
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

  //TODO(Soremwar)
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

  end(cb?: () => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  end(chunk: any, cb?: () => void): void;
  //TODO(Soremwar)
  //Bring in encodings
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  end(chunk: any, encoding: string, cb?: () => void): void;

  end(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    x?: any | (() => void),
    //TODO(Soremwar)
    //Bring in encodings
    y?: string | (() => void),
    z?: () => void,
  ) {
    const state = this._writableState;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let chunk: any | null;
    //TODO(Soremwar)
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

    if (state.corked) {
      state.corked = 1;
      this.uncork();
    }

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
        queueMicrotask(() => {
          (cb as (error?: Error | undefined) => void)(err);
        });
      } else {
        state[kOnFinished].push(cb);
      }
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

  set destroyed(value: boolean) {
    if (this._readableState && this._writableState) {
      this._readableState.destroyed = value;
      this._writableState.destroyed = value;
    }
  }

  get writable() {
    const w = this._writableState;
    return !w.destroyed && !w.errored && !w.ending && !w.ended;
  }

  set writable(val) {
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
}

export default Duplex;
