
import type { ReadableState } from "./readable.ts";
import type Writable from "./writable.ts";
import type { WritableState } from "./writable.ts";
import {
  AfterWriteTick, kOnFinished,
} from "./writable_internal.ts";
import {
  afterWrite,
  afterWriteTick,
  clearBuffer,
  errorBuffer,
  needFinish,
  prefinish,
} from "./writable_internal.ts";
import type Duplex from "./duplex.ts";
import { ERR_MULTIPLE_CALLBACK } from "../_errors.ts";

export function endDuplex(stream: Duplex) {
  const state = stream._readableState;

  if (!state.endEmitted) {
    state.ended = true;
    queueMicrotask(() => endReadableNT(state, stream));
  }
}

function endReadableNT(state: ReadableState, stream: Duplex) {
  // Check that we didn't get one last unshift.
  if (!state.errorEmitted && !state.closeEmitted &&
      !state.endEmitted && state.length === 0) {
    state.endEmitted = true;
    stream.emit('end');

    if (stream.writable && stream.allowHalfOpen === false) {
      queueMicrotask(() => endWritableNT(state, stream));
    } else if (state.autoDestroy) {
      // In case of duplex streams we need a way to detect
      // if the writable side is ready for autoDestroy as well.
      const wState = stream._writableState;
      const autoDestroy = !wState || (
        wState.autoDestroy &&
        // We don't expect the writable to ever 'finish'
        // if writable is explicitly set to false.
        (wState.finished || wState.writable === false)
      );

      if (autoDestroy) {
        stream.destroy();
      }
    }
  }
}

function endWritableNT(state: ReadableState, stream: Duplex) {
  const writable = stream.writable &&
    !stream.writableEnded &&
    !stream.destroyed;
  if (writable) {
    stream.end();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function errorOrDestroy(this: any, stream: Duplex, err: Error, sync = false) {
  const r = stream._readableState;
  const w = stream._writableState;

  if (w.destroyed || r.destroyed) {
    return this;
  }

  if (r.autoDestroy || w.autoDestroy){
    stream.destroy(err);
  } else if (err) {
    // Avoid V8 leak, https://github.com/nodejs/node/pull/34103#issuecomment-652002364
    err.stack;

    if (w && !w.errored) {
      w.errored = err;
    }
    if (r && !r.errored) {
      r.errored = err;
    }

    if (sync) {
      queueMicrotask(() => {
        if (w.errorEmitted || r.errorEmitted) {
          return;
        }

        w.errorEmitted = true;
        r.errorEmitted = true;

        stream.emit('error', err);
      });
    } else {
      if (w.errorEmitted || r.errorEmitted) {
        return;
      }

      w.errorEmitted = true;
      r.errorEmitted = true;

      stream.emit('error', err);
    }
  }
}

function finish(stream: Duplex, state: WritableState) {
  state.pendingcb--;
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

export function finishMaybe(stream: Duplex, state: WritableState, sync?: boolean) {
  if (needFinish(state)) {
    prefinish(stream as Writable, state);
    if (state.pendingcb === 0 && needFinish(state)) {
      state.pendingcb++;
      if (sync) {
        queueMicrotask(() => finish(stream, state));
      } else {
        finish(stream, state);
      }
    }
  }
}

export function onwrite(stream: Duplex, er?: Error | null) {
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

    if (stream._readableState && !stream._readableState.errored) {
      stream._readableState.errored = er;
    }

    if (sync) {
      queueMicrotask(() => onwriteError(stream, state, er, cb));
    } else {
      onwriteError(stream, state, er, cb);
    }
  } else {
    if (state.buffered.length > state.bufferedIndex) {
      clearBuffer(stream, state);
    }

    if (sync) {
      if (
        state.afterWriteTickInfo !== null &&
        state.afterWriteTickInfo.cb === cb
      ) {
        state.afterWriteTickInfo.count++;
      } else {
        state.afterWriteTickInfo = {
          count: 1,
          cb: (cb as (error?: Error) => void),
          stream: stream as Writable,
          state,
        };
        queueMicrotask(() =>
          afterWriteTick(state.afterWriteTickInfo as AfterWriteTick)
        );
      }
    } else {
      afterWrite(stream as Writable, state, 1, cb as (error?: Error) => void);
    }
  }
}

function onwriteError(
  stream: Duplex,
  state: WritableState,
  er: Error,
  cb: (error: Error) => void,
) {
  --state.pendingcb;

  cb(er);
  errorBuffer(state);
  errorOrDestroy(stream, er);
}