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

import Duplex from "./_stream/duplex.ts";
import eos from "./internal/streams/end-of-stream.js";
import PassThrough from "./_stream/passthrough.js";
import pipeline from "./internal/streams/pipeline.js";
import promises from "./_stream/promises.js";
import Readable from "./_stream/readable.js";
import Stream from "./internal/streams/legacy.js";
import Transform from "./_stream/transform.js";
import Writable from "./_stream/writable.js";
import {
  types,
} from "./util.ts";

const _isUint8Array = types.isUint8Array;

Stream._isUint8Array = _isUint8Array;
Stream.Duplex = Duplex;
Stream.finished = eos;
Stream.PassThrough = PassThrough;
Stream.pipeline = pipeline;
Stream.promises = promises;
Stream.Readable = Readable;
Stream.Stream = Stream;
Stream.Transform = Transform;
Stream.Writable = Writable;

export default Stream;
export {
  _isUint8Array,
  Duplex,
  eos as finished,
  PassThrough,
  pipeline,
  Readable,
  Stream,
  Transform,
  Writable,
};
