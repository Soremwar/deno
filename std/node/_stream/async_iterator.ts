import finished from "./end-of-stream.ts";
import Readable from "./readable.ts";
import type Stream from "./stream.ts";
import * as destroyImpl from "./destroy.js";

const kLastResolve = Symbol("lastResolve");
const kLastReject = Symbol("lastReject");
const kError = Symbol("error");
const kEnded = Symbol("ended");
const kLastPromise = Symbol("lastPromise");
const kHandlePromise = Symbol("handlePromise");
const kStream = Symbol("stream");

// deno-lint-ignore no-explicit-any
function createIterResult(value: any, done: boolean): IteratorResult<any> {
  return { value, done };
}

function readAndResolve(iter: any) {
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

function onReadable(iter: any) {
  // We wait for the next tick, because it might
  // emit an error with `process.nextTick()`.
  //TODO
  //This replaces `process.nextTick(readAndResolve, iter);`
  //Is this reliable?
  queueMicrotask(() => readAndResolve(iter));
}

function wrapForNext(lastPromise: Promise<any>, iter: any) {
  return (resolve: (value: any) => void, reject: (value: any) => void) => {
    lastPromise.then(() => {
      if (iter[kEnded]) {
        resolve(createIterResult(undefined, true));
        return;
      }

      iter[kHandlePromise](resolve, reject);
    }, reject);
  };
}

const AsyncIteratorPrototype = Object.getPrototypeOf(
  Object.getPrototypeOf(async function* () {}).prototype,
);

function finish(self: any, err?: Error) {
  return new Promise((resolve, reject) => {
    const stream = self[kStream];

    finished(stream, (err) => {
      //@ts-ignore
      if (err && err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
        reject(err);
      } else {
        resolve(createIterResult(undefined, true));
      }
    });
    destroyImpl.destroyer(stream, err);
  });
}

const ReadableStreamAsyncIteratorPrototype = Object.setPrototypeOf({
  get stream() {
    return this[kStream];
  },

  next() {
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
  },

  return() {
    return finish(this);
  },

  throw(err: Error) {
    return finish(this, err);
  },
}, AsyncIteratorPrototype);

const createReadableStreamAsyncIterator = (stream: Stream) => {
  //@ts-ignore
  if (typeof stream.read !== "function") {
    const src = stream;
    //TODO
    //Looks like wrap should work with any kind of streams
    //@ts-ignore
    stream = new Readable({ objectMode: true }).wrap(src);
    //@ts-ignore
    finished(stream, (err) => destroyImpl.destroyer(src, err));
  }

  const iterator = Object.create(ReadableStreamAsyncIteratorPrototype, {
    [kStream]: { value: stream, writable: true },
    [kLastResolve]: { value: null, writable: true },
    [kLastReject]: { value: null, writable: true },
    [kError]: { value: null, writable: true },
    [kEnded]: {
      //@ts-ignore
      value: stream.readableEnded || stream._readableState.endEmitted,
      writable: true,
    },
    // The function passed to new Promise is cached so we avoid allocating a new
    // closure at every run.
    [kHandlePromise]: {
      value: (resolve: (value: any) => void, reject: (value: any) => void) => {
        const data = iterator[kStream].read();
        if (data) {
          iterator[kLastPromise] = null;
          iterator[kLastResolve] = null;
          iterator[kLastReject] = null;
          resolve(createIterResult(data, false));
        } else {
          iterator[kLastResolve] = resolve;
          iterator[kLastReject] = reject;
        }
      },
      writable: true,
    },
  });
  iterator[kLastPromise] = null;

  //@ts-ignore
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
