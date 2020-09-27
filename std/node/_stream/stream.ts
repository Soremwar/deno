//TODO@Soremwar
//Move from prototypes to classes
import Buffer from "../buffer.ts";
import EventEmitter from "../events.ts";
import type Writable from "./writable.ts";
import { types } from "../util.ts";

class Stream extends EventEmitter {
  constructor() {
    super();
  }

  static _isUint8Array = types.isUint8Array;
  static _uint8ArrayToBuffer = (chunk: Uint8Array) => Buffer.from(chunk);

  pipe(dest: Writable, options: { end: boolean }) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const source = this;

    //TODO
    //isStdio exist on stdin || stdout only, which extend from Duplex
    //if (!dest._isStdio && (options?.end ?? true)) {
    if (options?.end ?? true) {
      source.on("end", onend);
      source.on("close", onclose);
    }

    let didOnEnd = false;
    function onend() {
      if (didOnEnd) return;
      didOnEnd = true;

      dest.end();
    }

    function onclose() {
      if (didOnEnd) return;
      didOnEnd = true;

      if (typeof dest.destroy === "function") dest.destroy();
    }

    // Don't leave dangling pipes when there are errors.
    function onerror(this: Stream, er: Error) {
      cleanup();
      if (this.listenerCount("error") === 0) {
        throw er; // Unhandled stream error in pipe.
      }
    }

    source.on("error", onerror);
    dest.on("error", onerror);

    // Remove all the event listeners that were added.
    function cleanup() {
      source.removeListener("end", onend);
      source.removeListener("close", onclose);

      source.removeListener("error", onerror);
      dest.removeListener("error", onerror);

      source.removeListener("end", cleanup);
      source.removeListener("close", cleanup);

      dest.removeListener("close", cleanup);
    }

    source.on("end", cleanup);
    source.on("close", cleanup);

    dest.on("close", cleanup);
    dest.emit("pipe", source);

    return dest;
  }
}

export default Stream;
