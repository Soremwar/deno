import finished from "./end-of-stream.ts";
import Readable from "./readable.ts";

const kLastResolve = Symbol("lastResolve");
const kLastReject = Symbol("lastReject");
const kError = Symbol("error");
const kEnded = Symbol("ended");
const kLastPromise = Symbol("lastPromise");
const kHandlePromise = Symbol("handlePromise");
const kStream = Symbol("stream");

// deno-lint-ignore no-explicit-any
type ReadableIteratorResult = IteratorResult<any>;

// deno-lint-ignore no-explicit-any
function isRequest(stream: any) {
  return stream && stream.setHeader && typeof stream.abort === "function";
}

//TODO(Soremwar)
//Should be any implementation of stream
// deno-lint-ignore no-explicit-any
function destroyer(stream: any, err?: Error | null) {
  if (isRequest(stream)) return stream.abort();
  if (isRequest(stream.req)) return stream.req.abort();
  if (typeof stream.destroy === "function") return stream.destroy(err);
  if (typeof stream.close === "function") return stream.close();
}

// deno-lint-ignore no-explicit-any
function createIterResult(value: any, done: boolean): ReadableIteratorResult {
  return { value, done };
}

function readAndResolve(iter: ReadableStreamAsyncIterator) {
  const resolve = iter[kLastResolve];
  if (resolve !== null) {
    const data = iter[kStream].read();
    // We defer if data is null. We can be expecting either 'end' or 'error'.
    if (data !== null) {
      iter[kLastPromise] = null;
      iter[kLastResolve] = null;
      iter[kLastReject] = null;
      resolve(createIterResult(data, false));
    }
  }
}

function onReadable(iter: ReadableStreamAsyncIterator) {
  // We wait for the next tick, because it might
  // emit an error with `process.nextTick()`.
  //TODO
  //This replaces `process.nextTick(readAndResolve, iter);`
  //Is this reliable?
  queueMicrotask(() => readAndResolve(iter));
}

function wrapForNext(lastPromise: Promise<ReadableIteratorResult>, iter: ReadableStreamAsyncIterator) {
  return (resolve: (value: ReadableIteratorResult) => void, reject: (error: Error) => void) => {
    lastPromise.then(() => {
      if (iter[kEnded]) {
        resolve(createIterResult(undefined, true));
        return;
      }

      iter[kHandlePromise](resolve, reject);
    }, reject);
  };
}

function finish(self: ReadableStreamAsyncIterator, err?: Error) {
  return new Promise((resolve: (result: ReadableIteratorResult) => void, reject: (error: Error) => void) => {
    const stream = self[kStream];

    finished(stream, (err) => {
      //@ts-ignore
      if (err && err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
        reject(err);
      } else {
        resolve(createIterResult(undefined, true));
      }
    });
    destroyer(stream, err);
  });
}

const AsyncIteratorPrototype = Object.getPrototypeOf(
  Object.getPrototypeOf(async function* () {}).prototype,
);

// deno-lint-ignore no-explicit-any
class ReadableStreamAsyncIterator implements AsyncIterableIterator<any> {
  [kEnded]: boolean;
  [kError]: Error | null = null;
  [kHandlePromise] = (
    resolve: (value: ReadableIteratorResult) => void,
    reject: (value: Error) => void,
  ) => {
    const data = this[kStream].read();
    if (data) {
      this[kLastPromise] = null;
      this[kLastResolve] = null;
      this[kLastReject] = null;
      resolve(createIterResult(data, false));
    } else {
      this[kLastResolve] = resolve;
      this[kLastReject] = reject;
    }
  };
  // deno-lint-ignore no-explicit-any
  [kLastPromise]: null | Promise<any>;
  // deno-lint-ignore no-explicit-any
  [kLastReject]: null | ((value: any) => void) = null;
  // deno-lint-ignore no-explicit-any
  [kLastResolve]: null | ((value: any) => void) = null;
  [kStream]: Readable;
  [Symbol.asyncIterator] = AsyncIteratorPrototype[Symbol.asyncIterator];

  constructor(stream: Readable){
    this[kEnded] = stream.readableEnded || stream._readableState.endEmitted;
    this[kStream] = stream;
    Object.defineProperties(this, {
      [kEnded]: {configurable: false, enumerable: false, writable: true},
      [kError]: {configurable: false, enumerable: false, writable: true},
      [kHandlePromise]: {configurable: false, enumerable: false, writable: true},
      [kLastPromise]: {configurable: false, enumerable: false, writable: true},
      [kLastReject]: {configurable: false, enumerable: false, writable: true},
      [kLastResolve]: {configurable: false, enumerable: false, writable: true},
      [kStream]: {configurable: false, enumerable: false, writable: true},
    });
  }

  get stream() {
    return this[kStream];
  }

  next(): Promise<ReadableIteratorResult> {
    // If we have detected an error in the meanwhile
    // reject straight away.
    const error = this[kError];
    if (error !== null) {
      return Promise.reject(error);
    }

    if (this[kEnded]) {
      return Promise.resolve(createIterResult(undefined, true));
    }

    if (this[kStream].destroyed) {
      return new Promise((resolve, reject) => {
        if (this[kError]) {
          reject(this[kError]);
        } else if (this[kEnded]) {
          resolve(createIterResult(undefined, true));
        } else {
          finished(this[kStream], (err) => {
            //@ts-ignore
            if (err && err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
              reject(err);
            } else {
              resolve(createIterResult(undefined, true));
            }
          });
        }
      });
    }

    // If we have multiple next() calls we will wait for the previous Promise to
    // finish. This logic is optimized to support for await loops, where next()
    // is only called once at a time.
    const lastPromise = this[kLastPromise];
    let promise;

    if (lastPromise) {
      promise = new Promise(wrapForNext(lastPromise, this));
    } else {
      // Fast path needed to support multiple this.push()
      // without triggering the next() queue.
      const data = this[kStream].read();
      if (data !== null) {
        return Promise.resolve(createIterResult(data, false));
      }

      promise = new Promise(this[kHandlePromise]);
    }

    this[kLastPromise] = promise;

    return promise;
  }

  return(): Promise<ReadableIteratorResult> {
    return finish(this);
  }

  throw(err: Error): Promise<ReadableIteratorResult> {
    return finish(this, err);
  }
}

//TODO(Soremwar)
//Should be all implementation of Stream
// deno-lint-ignore no-explicit-any
const createReadableStreamAsyncIterator = (stream: any) => {
  if (typeof stream.read !== "function") {
    const src = stream;
    stream = new Readable({ objectMode: true }).wrap(src);
    finished(stream, (err) => destroyer(src, err));
  }

  const iterator = new ReadableStreamAsyncIterator(stream);
  iterator[kLastPromise] = null;

  finished(stream, { writable: false }, (err) => {
    //@ts-ignore
    if (err && err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
      const reject = iterator[kLastReject];
      // Reject if we are waiting for data in the Promise returned by next() and
      // store the error.
      if (reject !== null) {
        iterator[kLastPromise] = null;
        iterator[kLastResolve] = null;
        iterator[kLastReject] = null;
        reject(err);
      }
      iterator[kError] = err;
      return;
    }

    const resolve = iterator[kLastResolve];
    if (resolve !== null) {
      iterator[kLastPromise] = null;
      iterator[kLastResolve] = null;
      iterator[kLastReject] = null;
      resolve(createIterResult(undefined, true));
    }
    iterator[kEnded] = true;
  });

  stream.on("readable", onReadable.bind(null, iterator));

  return iterator;
};

export default createReadableStreamAsyncIterator;
