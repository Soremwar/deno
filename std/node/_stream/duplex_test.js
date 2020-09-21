import Duplex from "./duplex.ts";
import {
  assert,
  assertEquals,
} from "../../testing/asserts.ts";

Deno.test("Duplex stream works normally", () => {
  const stream = new Duplex({ objectMode: true });

  assert(stream._readableState.objectMode);
  assert(stream._writableState.objectMode);
  assert(stream.allowHalfOpen);
  assertEquals(stream.listenerCount('end'), 0);

  let written;
  let read;

  stream._write = (obj, _, cb) => {
    written = obj;
    cb();
  };

  stream._read = () => {};

  stream.on('data', (obj) => {
    read = obj;
  });

  stream.push({ val: 1 });
  stream.end({ val: 2 });

  stream.on('finish', () => {
    assertEquals(read.val, 1);
    assertEquals(written.val, 2);
  });
});

Deno.test("Duplex stream gets constructed correctly", () => {
  const d1 = new Duplex({
    objectMode: true,
    highWaterMark: 100
  });

  assertEquals(d1.writableObjectMode, true);
  assertEquals(d1.writableHighWaterMark, 100);
  assertEquals(d1.readableObjectMode, true);
  assertEquals(d1.readableHighWaterMark, 100);

  const d2 = new Duplex({
    readableObjectMode: false,
    readableHighWaterMark: 10,
    writableObjectMode: true,
    writableHighWaterMark: 100
  });

  assertEquals(d2.writableObjectMode, true);
  assertEquals(d2.writableHighWaterMark, 100);
  assertEquals(d2.readableObjectMode, false);
  assertEquals(d2.readableHighWaterMark, 10);
});