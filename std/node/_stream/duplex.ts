// eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
export const errorOrDestroy = (...args: any[]) => {};
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

import Readable from "./readable.ts";
import type {ReadableOptions} from "./readable.ts";
import Stream from "./stream.ts";
import Writable from "./writable.ts";
import type {WritableOptions} from "./writable.ts";
import {
  StringDecoder,
} from "../string_decoder.ts";
import BufferList from "./buffer_list.ts";
import {
  kPaused,
} from "./symbols.ts";
import {
  ERR_INVALID_OPT_VALUE,
} from "../_errors.ts";

interface DuplexOptions extends ReadableOptions, WritableOptions {
  allowHalfOpen?: boolean;
  destroy?(this: Duplex, error: Error | null, callback: (error: Error | null) => void): void;
  final?(this: Duplex, callback: (error?: Error | null) => void): void;
  read?(this: Duplex): void;
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
class Duplex extends Stream implements Readable, Writable {
  allowHalfOpen = true;
  
  constructor(options?: DuplexOptions){
    super();
    if (options) {
      if (options.readable === false)
        this.readable = false;
  
      if (options.writable === false)
        this.writable = false;
  
      if (options.allowHalfOpen === false) {
        this.allowHalfOpen = false;
      }
    }
  }
}

export default Duplex;
