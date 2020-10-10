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

import Duplex from "./duplex.ts";
import type {DuplexOptions} from "./duplex.ts"
import {
  ERR_METHOD_NOT_IMPLEMENTED,
} from "../_errors.ts";

const kCallback = Symbol("kCallback");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TransformFlush = (this: Transform, callback: (error?: Error | null, data?: any) => void) => void;

export interface TransformOptions extends DuplexOptions {
  read?(this: Transform, size: number): void;
  //TODO(Soremwar)
  //Bring encodings in
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write?(this: Transform, chunk: any, encoding: string, callback: (error?: Error | null) => void): void;
  //TODO(Soremwar)
  //Bring encodings in
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  writev?(this: Transform, chunks: Array<{ chunk: any, encoding: string }>, callback: (error?: Error | null) => void): void;
  final?(this: Transform, callback: (error?: Error | null) => void): void;
  destroy?(this: Transform, error: Error | null, callback: (error: Error | null) => void): void;
  //TODO(Soremwar)
  //Bring encodings in
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform?(this: Transform, chunk: any, encoding: string, callback: (error?: Error | null, data?: any) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  flush?: TransformFlush;
}

export default class Transform extends Duplex {
  [kCallback]: null | ((error?: Error | null) => void);
  _flush?: TransformFlush;

  constructor(options?: TransformOptions){
    super(options);
    this._readableState.sync = false;
  
    this[kCallback] = null;
  
    if (options) {
      if (typeof options.transform === "function") {
        this._transform = options.transform;
      }
  
      if (typeof options.flush === "function") {
        this._flush = options.flush;
      }
    }

    this.on("prefinish", function(this: Transform) {
      if (typeof this._flush === "function" && !this.destroyed) {
        this._flush((er, data) => {
          if (er) {
            this.destroy(er);
            return;
          }
    
          if (data != null) {
            this.push(data);
          }
          this.push(null);
        });
      } else {
        this.push(null);
      }
    });
  }

  _read() {
    if (this[kCallback]) {
      const callback = this[kCallback] as (error?: Error | null) => void;
      this[kCallback] = null;
      callback();
    }
  }

  _transform(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chunk: any,
    encoding: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (error?: Error | null, data?: any) => void,
  ) {
    throw new ERR_METHOD_NOT_IMPLEMENTED("_transform()");
  }

  _write(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chunk: any,
    encoding: string,
    callback: (error?: Error | null) => void,
  ) {
    const rState = this._readableState;
    const wState = this._writableState;
    const length = rState.length;
  
    this._transform(chunk, encoding, (err, val) => {
      if (err) {
        callback(err);
        return;
      }
  
      if (val != null) {
        this.push(val);
      }
  
      if (
        wState.ended || // Backwards compat.
        length === rState.length || // Backwards compat.
        rState.length < rState.highWaterMark ||
        rState.length === 0
      ) {
        callback();
      } else {
        this[kCallback] = callback;
      }
    });
  }
}
