import { once } from "../_utils.ts";
import type Readable from "./readable.ts";
import type Writable from "./writable.ts";
import {
  ERR_INVALID_ARG_TYPE,
  ERR_STREAM_PREMATURE_CLOSE,
  NodeErrorAbstraction,
} from "../_errors.ts";

type Stream = Readable | Writable;

function isRequest(stream: Stream) {
  // deno-lint-ignore ban-ts-comment
  //@ts-ignore
  return stream.setHeader && typeof stream.abort === "function";
}

function isReadable(stream: Stream) {
  // deno-lint-ignore ban-ts-comment
  //@ts-ignore
  return typeof stream.readable === "boolean" ||
    // deno-lint-ignore ban-ts-comment
    //@ts-ignore
    typeof stream.readableEnded === "boolean" ||
    // deno-lint-ignore ban-ts-comment
    //@ts-ignore
    !!stream._readableState;
}

function isWritable(stream: Stream) {
  // deno-lint-ignore ban-ts-comment
  //@ts-ignore
  return typeof stream.writable === "boolean" ||
    // deno-lint-ignore ban-ts-comment
    //@ts-ignore
    typeof stream.writableEnded === "boolean" ||
    // deno-lint-ignore ban-ts-comment
    //@ts-ignore
    !!stream._writableState;
}

function isWritableFinished(stream: Writable) {
  if (stream.writableFinished) return true;
  const wState = stream._writableState;
  if (!wState || wState.errored) return false;
  return wState.finished || (wState.ended && wState.length === 0);
}

function nop() {}

function isReadableEnded(stream: Readable) {
  if (stream.readableEnded) return true;
  const rState = stream._readableState;
  if (!rState || rState.errored) return false;
  return rState.endEmitted || (rState.ended && rState.length === 0);
}

interface FinishedOptions {
  error?: boolean;
  readable?: boolean;
  writable?: boolean;
}

export default function eos(
  stream: Stream,
  options: FinishedOptions | null,
  callback: (err?: NodeErrorAbstraction | null) => void,
): () => void;
export default function eos(
  stream: Stream,
  callback: (err?: NodeErrorAbstraction | null) => void,
): () => void;

export default function eos(
  stream: Stream,
  x: FinishedOptions | ((err?: NodeErrorAbstraction | null) => void) | null,
  y?: (err?: NodeErrorAbstraction | null) => void,
) {
  let opts: FinishedOptions;
  let callback: (err?: NodeErrorAbstraction | null) => void;

  if (!y) {
    if (typeof x !== "function") {
      throw new ERR_INVALID_ARG_TYPE("callback", "function", x);
    }
    opts = {};
    callback = x;
  } else {
    if (!x || Array.isArray(x) || typeof x !== "object") {
      throw new ERR_INVALID_ARG_TYPE("opts", "object", x);
    }
    opts = x;

    if (typeof y !== "function") {
      throw new ERR_INVALID_ARG_TYPE("callback", "function", y);
    }
    callback = y;
  }

  callback = once(callback);

  const readable = opts.readable ||
    (opts.readable !== false && isReadable(stream));
  const writable = opts.writable ||
    (opts.writable !== false && isWritable(stream));

  // deno-lint-ignore ban-ts-comment
  //@ts-ignore
  const wState = stream._writableState;
  // deno-lint-ignore ban-ts-comment
  //@ts-ignore
  const rState = stream._readableState;
  const state = wState || rState;

  const onlegacyfinish = () => {
    // deno-lint-ignore ban-ts-comment
    //@ts-ignore
    if (!stream.writable) onfinish();
  };

  let willEmitClose = (
    state &&
    state.autoDestroy &&
    state.emitClose &&
    state.closed === false &&
    isReadable(stream) === readable &&
    isWritable(stream) === writable
  );

  // deno-lint-ignore ban-ts-comment
  //@ts-ignore
  let writableFinished = stream.writableFinished ||
    (wState && wState.finished);
  const onfinish = () => {
    writableFinished = true;
    // deno-lint-ignore ban-ts-comment
    //@ts-ignore
    if (stream.destroyed) willEmitClose = false;

    // deno-lint-ignore ban-ts-comment
    //@ts-ignore
    if (willEmitClose && (!stream.readable || readable)) return;
    if (!readable || readableEnded) callback.call(stream);
  };

  // deno-lint-ignore ban-ts-comment
  //@ts-ignore
  let readableEnded = stream.readableEnded ||
    (rState && rState.endEmitted);
  const onend = () => {
    readableEnded = true;
    // deno-lint-ignore ban-ts-comment
    //@ts-ignore
    if (stream.destroyed) willEmitClose = false;

    // deno-lint-ignore ban-ts-comment
    //@ts-ignore
    if (willEmitClose && (!stream.writable || writable)) return;
    if (!writable || writableFinished) callback.call(stream);
  };

  const onerror = (err: NodeErrorAbstraction) => {
    callback.call(stream, err);
  };

  const onclose = () => {
    if (readable && !readableEnded) {
      // deno-lint-ignore ban-ts-comment
      //@ts-ignore
      if (!isReadableEnded(stream)) {
        return callback.call(stream, new ERR_STREAM_PREMATURE_CLOSE());
      }
    }
    if (writable && !writableFinished) {
      // deno-lint-ignore ban-ts-comment
      //@ts-ignore
      if (!isWritableFinished(stream)) {
        return callback.call(stream, new ERR_STREAM_PREMATURE_CLOSE());
      }
    }
    callback.call(stream);
  };

  const onrequest = () => {
    // deno-lint-ignore ban-ts-comment
    //@ts-ignore
    stream.req.on("finish", onfinish);
  };

  if (isRequest(stream)) {
    stream.on("complete", onfinish);
    stream.on("abort", onclose);
    // deno-lint-ignore ban-ts-comment
    //@ts-ignore
    if (stream.req) onrequest();
    else stream.on("request", onrequest);
  } else if (writable && !wState) { // legacy streams
    stream.on("end", onlegacyfinish);
    stream.on("close", onlegacyfinish);
  }

  // deno-lint-ignore ban-ts-comment
  //@ts-ignore
  if (typeof stream.aborted === "boolean") {
    stream.on("aborted", onclose);
  }

  stream.on("end", onend);
  stream.on("finish", onfinish);
  if (opts.error !== false) stream.on("error", onerror);
  stream.on("close", onclose);

  const closed = (
    (wState && wState.closed) ||
    (rState && rState.closed) ||
    (wState && wState.errorEmitted) ||
    (rState && rState.errorEmitted) ||
    // deno-lint-ignore ban-ts-comment
    //@ts-ignore
    (rState && stream.req && stream.aborted) ||
    (
      (!writable || (wState && wState.finished)) &&
      (!readable || (rState && rState.endEmitted))
    )
  );

  if (closed) {
    queueMicrotask(callback);
  }

  return function () {
    callback = nop;
    stream.removeListener("aborted", onclose);
    stream.removeListener("complete", onfinish);
    stream.removeListener("abort", onclose);
    stream.removeListener("request", onrequest);
    // deno-lint-ignore ban-ts-comment
    //@ts-ignore
    if (stream.req) stream.req.removeListener("finish", onfinish);
    stream.removeListener("end", onlegacyfinish);
    stream.removeListener("close", onlegacyfinish);
    stream.removeListener("finish", onfinish);
    stream.removeListener("end", onend);
    stream.removeListener("error", onerror);
    stream.removeListener("close", onclose);
  };
}
