import finished from "./end-of-stream.ts";
import Readable from "./readable.ts";

const kLastResolve = Symbol("lastResolve");
const kLastReject = Symbol("lastReject");
const kError = Symbol("error");
const kEnded = Symbol("ended");
const kLastPromise = Symbol("lastPromise");
const kHandlePromise = Symbol("handlePromise");
const kStream = Symbol("stream");

// TODO(Soremwar)
// Add Duplex streams
type IterableStreams = Readable;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReadableIteratorResult = IteratorResult<any>;

function initIteratorSymbols(o: ReadableStreamAsyncIterator, symbols: symbol[]) {
  let properties: PropertyDescriptorMap = {};
  for (const sym in symbols) {
    properties[sym] = { configurable: false, enumerable: false, writable: true };
  }
  Object.defineProperties(o, properties);
}

// TODO(Soremwar)
// Bring back once requests are implemented
// function isRequest(stream: any) {
//   return stream && stream.setHeader && typeof stream.abort === "function";
// }

//TODO(Soremwar)
//Should be any implementation of stream
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function destroyer(stream: any, err?: Error | null) {
  // TODO(Soremwar)
  // Bring back once requests are implemented
  // if (isRequest(stream)) return stream.abort();
  // if (isRequest(stream.req)) return stream.req.abort();
  if (typeof stream.destroy === "function") return stream.destroy(err);
  if (typeof stream.close === "function") return stream.close();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createIterResult(value: any, done: boolean): ReadableIteratorResult {
  return { value, done };
}

function readAndResolve(iter: ReadableStreamAsyncIterator) {
  const resolve = iter[kLastResolve];
  if (resolve !== null) {
    const data = iter[kStream].read();
    if (data !== null) {
      iter[kLastPromise] = null;
      iter[kLastResolve] = null;
      iter[kLastReject] = null;
      resolve(createIterResult(data, false));
    }
  }
}

function onReadable(iter: ReadableStreamAsyncIterator) {
  queueMicrotask(() => readAndResolve(iter));
}

function wrapForNext(
  lastPromise: Promise<ReadableIteratorResult>,
  iter: ReadableStreamAsyncIterator,
) {
  return (
    resolve: (value: ReadableIteratorResult) => void,
    reject: (error: Error) => void,
  ) => {
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
  return new Promise(
    (
      resolve: (result: ReadableIteratorResult) => void,
      reject: (error: Error) => void,
    ) => {
      const stream = self[kStream];

      finished(stream, (err) => {
        if (err && err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
          reject(err);
        } else {
          resolve(createIterResult(undefined, true));
        }
      });
      destroyer(stream, err);
    },
  );
}

const AsyncIteratorPrototype = Object.getPrototypeOf(
  Object.getPrototypeOf(async function* () {}).prototype,
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [kLastPromise]: null | Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [kLastReject]: null | ((value: any) => void) = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [kLastResolve]: null | ((value: any) => void) = null;
  [kStream]: Readable;
  [Symbol.asyncIterator] = AsyncIteratorPrototype[Symbol.asyncIterator];

  constructor(stream: Readable) {
    this[kEnded] = stream.readableEnded || stream._readableState.endEmitted;
    this[kStream] = stream;
    initIteratorSymbols(this, [
      kEnded,
      kError,
      kHandlePromise,
      kLastPromise,
      kLastReject,
      kLastResolve,
      kStream,
    ]);
  }

  get stream() {
    return this[kStream];
  }

  next(): Promise<ReadableIteratorResult> {
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

const createReadableStreamAsyncIterator = (stream: IterableStreams) => {
  if (typeof stream.read !== "function") {
    const src = stream;
    stream = new Readable({ objectMode: true }).wrap(src);
    finished(stream, (err) => destroyer(src, err));
  }

  const iterator = new ReadableStreamAsyncIterator(stream);
  iterator[kLastPromise] = null;

  finished(stream, { writable: false }, (err) => {
    if (err && err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
      const reject = iterator[kLastReject];
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
