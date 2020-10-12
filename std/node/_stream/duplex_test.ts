import Buffer from "../buffer.ts";
import Duplex from "./duplex.ts";
import finished from "./end-of-stream.ts";
import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "../../testing/asserts.ts";
import { deferred, delay } from "../../async/mod.ts";

Deno.test("Duplex stream works normally", () => {
  const stream = new Duplex({ objectMode: true });

  assert(stream._readableState.objectMode);
  assert(stream._writableState.objectMode);
  assert(stream.allowHalfOpen);
  assertEquals(stream.listenerCount("end"), 0);

  let written: { val: number };
  let read: { val: number };

  stream._write = (obj, _, cb) => {
    written = obj;
    cb();
  };

  stream._read = () => {};

  stream.on("data", (obj) => {
    read = obj;
  });

  stream.push({ val: 1 });
  stream.end({ val: 2 });

  stream.on("finish", () => {
    assertEquals(read.val, 1);
    assertEquals(written.val, 2);
  });
});

Deno.test("Duplex stream gets constructed correctly", () => {
  const d1 = new Duplex({
    objectMode: true,
    highWaterMark: 100,
  });

  assertEquals(d1.readableObjectMode, true);
  assertEquals(d1.readableHighWaterMark, 100);
  assertEquals(d1.writableObjectMode, true);
  assertEquals(d1.writableHighWaterMark, 100);

  const d2 = new Duplex({
    readableObjectMode: false,
    readableHighWaterMark: 10,
    writableObjectMode: true,
    writableHighWaterMark: 100,
  });

  assertEquals(d2.writableObjectMode, true);
  assertEquals(d2.writableHighWaterMark, 100);
  assertEquals(d2.readableObjectMode, false);
  assertEquals(d2.readableHighWaterMark, 10);
});

Deno.test("Duplex stream can be paused", () => {
  const readable = new Duplex();

  // _read is a noop, here.
  readable._read = () => {};

  // Default state of a stream is not "paused"
  assert(!readable.isPaused());

  // Make the stream start flowing...
  readable.on("data", () => {});

  // still not paused.
  assert(!readable.isPaused());

  readable.pause();
  assert(readable.isPaused());
  readable.resume();
  assert(!readable.isPaused());
});

Deno.test("Duplex stream sets enconding correctly", () => {
  const readable = new Duplex({
    read() {},
  });

  readable.setEncoding("utf8");

  readable.push(new TextEncoder().encode("DEF"));
  readable.unshift(new TextEncoder().encode("ABC"));

  assertStrictEquals(readable.read(), "ABCDEF");
});

Deno.test("Duplex stream sets encoding correctly", () => {
  const readable = new Duplex({
    read() {},
  });

  readable.setEncoding("utf8");

  readable.push(new TextEncoder().encode("DEF"));
  readable.unshift(new TextEncoder().encode("ABC"));

  assertStrictEquals(readable.read(), "ABCDEF");
});

Deno.test("Duplex stream holds up a big push", async () => {
  let read_executed = 0;
  const read_executed_expected = 3;
  const read_expected_executions = deferred();

  let end_executed = 0;
  const end_executed_expected = 1;
  const end_expected_executions = deferred();

  const str = "asdfasdfasdfasdfasdf";

  const r = new Duplex({
    highWaterMark: 5,
    encoding: "utf8",
  });

  let reads = 0;

  function _read() {
    if (reads === 0) {
      setTimeout(() => {
        r.push(str);
      }, 1);
      reads++;
    } else if (reads === 1) {
      const ret = r.push(str);
      assertEquals(ret, false);
      reads++;
    } else {
      r.push(null);
    }
  }

  r._read = () => {
    read_executed++;
    if (read_executed == read_executed_expected) {
      read_expected_executions.resolve();
    }
    _read();
  };

  r.on("end", () => {
    end_executed++;
    if (end_executed == end_executed_expected) {
      end_expected_executions.resolve();
    }
  });

  // Push some data in to start.
  // We've never gotten any read event at this point.
  const ret = r.push(str);
  assert(!ret);
  let chunk = r.read();
  assertEquals(chunk, str);
  chunk = r.read();
  assertEquals(chunk, null);

  r.once("readable", () => {
    // This time, we'll get *all* the remaining data, because
    // it's been added synchronously, as the read WOULD take
    // us below the hwm, and so it triggered a _read() again,
    // which synchronously added more, which we then return.
    chunk = r.read();
    assertEquals(chunk, str + str);

    chunk = r.read();
    assertEquals(chunk, null);
  });

  const read_timeout = setTimeout(
    () => read_expected_executions.reject(),
    1000,
  );
  const end_timeout = setTimeout(
    () => end_expected_executions.reject(),
    1000,
  );
  await read_expected_executions;
  await end_expected_executions;
  clearTimeout(read_timeout);
  clearTimeout(end_timeout);
  assertEquals(read_executed, read_executed_expected);
  assertEquals(end_executed, end_executed_expected);
});

Deno.test("Duplex stream: 'readable' event is emitted but 'read' is not on highWaterMark length exceeded", async () => {
  let readable_executed = 0;
  const readable_executed_expected = 1;
  const readable_expected_executions = deferred();

  const r = new Duplex({
    highWaterMark: 3,
  });

  r._read = () => {
    throw new Error("_read must not be called");
  };
  r.push(Buffer.from("blerg"));

  setTimeout(function () {
    assert(!r._readableState.reading);
    r.on("readable", () => {
      readable_executed++;
      if (readable_executed == readable_executed_expected) {
        readable_expected_executions.resolve();
      }
    });
  }, 1);

  const readable_timeout = setTimeout(
    () => readable_expected_executions.reject(),
    1000,
  );
  await readable_expected_executions;
  clearTimeout(readable_timeout);
  assertEquals(readable_executed, readable_executed_expected);
});

Deno.test("Duplex stream: 'readable' and 'read' events are emitted on highWaterMark length not reached", async () => {
  let readable_executed = 0;
  const readable_executed_expected = 1;
  const readable_expected_executions = deferred();

  let read_executed = 0;
  const read_executed_expected = 1;
  const read_expected_executions = deferred();

  const r = new Duplex({
    highWaterMark: 3,
  });

  r._read = () => {
    read_executed++;
    if (read_executed == read_executed_expected) {
      read_expected_executions.resolve();
    }
  };

  r.push(Buffer.from("bl"));

  setTimeout(function () {
    assert(r._readableState.reading);
    r.on("readable", () => {
      readable_executed++;
      if (readable_executed == readable_executed_expected) {
        readable_expected_executions.resolve();
      }
    });
  }, 1);

  const readable_timeout = setTimeout(
    () => readable_expected_executions.reject(),
    1000,
  );
  const read_timeout = setTimeout(
    () => read_expected_executions.reject(),
    1000,
  );
  await readable_expected_executions;
  await read_expected_executions;
  clearTimeout(readable_timeout);
  clearTimeout(read_timeout);
  assertEquals(readable_executed, readable_executed_expected);
  assertEquals(read_executed, read_executed_expected);
});

Deno.test("Duplex stream: 'readable' event is emitted but 'read' is not on highWaterMark length not reached and stream ended", async () => {
  let readable_executed = 0;
  const readable_executed_expected = 1;
  const readable_expected_executions = deferred();

  const r = new Duplex({
    highWaterMark: 30,
  });

  r._read = () => {
    throw new Error("Must not be executed");
  };

  r.push(Buffer.from("blerg"));
  //This ends the stream and triggers end
  r.push(null);

  setTimeout(function () {
    // Assert we're testing what we think we are
    assert(!r._readableState.reading);
    r.on("readable", () => {
      readable_executed++;
      if (readable_executed == readable_executed_expected) {
        readable_expected_executions.resolve();
      }
    });
  }, 1);

  const readable_timeout = setTimeout(
    () => readable_expected_executions.reject(),
    1000,
  );
  await readable_expected_executions;
  clearTimeout(readable_timeout);
  assertEquals(readable_executed, readable_executed_expected);
});

Deno.test("Duplex stream: 'read' is emitted on empty string pushed in non-object mode", async () => {
  let end_executed = 0;
  const end_executed_expected = 1;
  const end_expected_executions = deferred();

  const underlyingData = ["", "x", "y", "", "z"];
  const expected = underlyingData.filter((data) => data);
  const result: unknown[] = [];

  const r = new Duplex({
    encoding: "utf8",
  });
  r._read = function () {
    queueMicrotask(() => {
      if (!underlyingData.length) {
        this.push(null);
      } else {
        this.push(underlyingData.shift());
      }
    });
  };

  r.on("readable", () => {
    const data = r.read();
    if (data !== null) result.push(data);
  });

  r.on("end", () => {
    end_executed++;
    if (end_executed == end_executed_expected) {
      end_expected_executions.resolve();
    }
    assertEquals(result, expected);
  });

  const end_timeout = setTimeout(
    () => end_expected_executions.reject(),
    1000,
  );
  await end_expected_executions;
  clearTimeout(end_timeout);
  assertEquals(end_executed, end_executed_expected);
});

Deno.test("Duplex stream: listeners can be removed", () => {
  const r = new Duplex();
  r._read = () => {};
  r.on("data", () => {});

  r.removeAllListeners("data");

  assertEquals(r.eventNames().length, 0);
});

Deno.test("Duplex stream writes correctly", async () => {
  let callback: undefined | ((error?: Error | null | undefined) => void);

  let write_executed = 0;
  const write_executed_expected = 1;
  const write_expected_executions = deferred();

  let writev_executed = 0;
  const writev_executed_expected = 1;
  const writev_expected_executions = deferred();

  const writable = new Duplex({
    write: (chunk, encoding, cb) => {
      write_executed++;
      if (write_executed == write_executed_expected) {
        write_expected_executions.resolve();
      }
      assert(chunk instanceof Buffer);
      assertStrictEquals(encoding, "buffer");
      assertStrictEquals(String(chunk), "ABC");
      callback = cb;
    },
    writev: (chunks) => {
      writev_executed++;
      if (writev_executed == writev_executed_expected) {
        writev_expected_executions.resolve();
      }
      assertStrictEquals(chunks.length, 2);
      assertStrictEquals(chunks[0].encoding, "buffer");
      assertStrictEquals(chunks[1].encoding, "buffer");
      assertStrictEquals(chunks[0].chunk + chunks[1].chunk, "DEFGHI");
    },
  });

  writable.write(new TextEncoder().encode("ABC"));
  writable.write(new TextEncoder().encode("DEF"));
  writable.end(new TextEncoder().encode("GHI"));
  callback?.();

  const write_timeout = setTimeout(
    () => write_expected_executions.reject(),
    1000,
  );
  const writev_timeout = setTimeout(
    () => writev_expected_executions.reject(),
    1000,
  );
  await write_expected_executions;
  await writev_expected_executions;
  clearTimeout(write_timeout);
  clearTimeout(writev_timeout);
  assertEquals(write_executed, write_executed_expected);
  assertEquals(writev_executed, writev_executed_expected);
});

Deno.test("Duplex stream writes Uint8Array in object mode", async () => {
  let write_executed = 0;
  const write_executed_expected = 1;
  const write_expected_executions = deferred();

  const ABC = new TextEncoder().encode("ABC");

  const writable = new Duplex({
    objectMode: true,
    write: (chunk, encoding, cb) => {
      write_executed++;
      if (write_executed == write_executed_expected) {
        write_expected_executions.resolve();
      }
      assert(!(chunk instanceof Buffer));
      assert(chunk instanceof Uint8Array);
      assertEquals(chunk, ABC);
      assertEquals(encoding, "utf8");
      cb();
    },
  });

  writable.end(ABC);

  const write_timeout = setTimeout(
    () => write_expected_executions.reject(),
    1000,
  );
  await write_expected_executions;
  clearTimeout(write_timeout);
  assertEquals(write_executed, write_executed_expected);
});

Deno.test("Duplex stream throws on unexpected close", async () => {
  let finished_executed = 0;
  const finished_executed_expected = 1;
  const finished_expected_executions = deferred();

  const writable = new Duplex({
    write: () => {},
  });
  writable.writable = false;
  writable.destroy();

  finished(writable, (err) => {
    finished_executed++;
    if (finished_executed == finished_executed_expected) {
      finished_expected_executions.resolve();
    }
    assertEquals(err?.code, "ERR_STREAM_PREMATURE_CLOSE");
  });

  const finished_timeout = setTimeout(
    () => finished_expected_executions.reject(),
    1000,
  );
  await finished_expected_executions;
  clearTimeout(finished_timeout);
  assertEquals(finished_executed, finished_executed_expected);
});

Deno.test("Duplex stream finishes correctly after error", async () => {
  let error_executed = 0;
  const error_executed_expected = 1;
  const error_expected_executions = deferred();

  let finished_executed = 0;
  const finished_executed_expected = 1;
  const finished_expected_executions = deferred();

  const w = new Duplex({
    write(_chunk, _encoding, cb) {
      cb(new Error());
    },
    autoDestroy: false,
  });
  w.write("asd");
  w.on("error", () => {
    error_executed++;
    if (error_executed == error_executed_expected) {
      error_expected_executions.resolve();
    }
    finished(w, () => {
      finished_executed++;
      if (finished_executed == finished_executed_expected) {
        finished_expected_executions.resolve();
      }
    });
  });

  const error_timeout = setTimeout(
    () => error_expected_executions.reject(),
    1000,
  );
  const finished_timeout = setTimeout(
    () => finished_expected_executions.reject(),
    1000,
  );
  await finished_expected_executions;
  await error_expected_executions;
  clearTimeout(finished_timeout);
  clearTimeout(error_timeout);
  assertEquals(finished_executed, finished_executed_expected);
  assertEquals(error_executed, error_executed_expected);
});

Deno.test("Duplex stream fails on 'write' null value", () => {
  const writable = new Duplex();
  assertThrows(() => writable.write(null));
});

Deno.test("Duplex stream is destroyed correctly", async () => {
  let close_executed = 0;
  const close_executed_expected = 1;
  const close_expected_executions = deferred();

  const unexpected_execution = deferred();

  const duplex = new Duplex({
    write(_chunk, _enc, cb) {
      cb();
    },
    read() {},
  });

  duplex.resume();

  function never() {
    unexpected_execution.reject();
  }

  duplex.on("end", never);
  duplex.on("finish", never);
  duplex.on("close", () => {
    close_executed++;
    if (close_executed == close_executed_expected) {
      close_expected_executions.resolve();
    }
  });

  duplex.destroy();
  assertEquals(duplex.destroyed, true);

  const close_timeout = setTimeout(
    () => close_expected_executions.reject(),
    1000,
  );
  await Promise.race([
    unexpected_execution,
    delay(100),
  ]);
  await close_expected_executions;
  clearTimeout(close_timeout);
  assertEquals(close_executed, close_executed_expected);
});

Deno.test("Duplex stream errors correctly on destroy", async () => {
  let error_executed = 0;
  const error_executed_expected = 1;
  const error_expected_executions = deferred();

  const unexpected_execution = deferred();

  const duplex = new Duplex({
    write(_chunk, _enc, cb) {
      cb();
    },
    read() {},
  });
  duplex.resume();

  const expected = new Error("kaboom");

  function never() {
    unexpected_execution.reject();
  }

  duplex.on("end", never);
  duplex.on("finish", never);
  duplex.on("error", (err) => {
    error_executed++;
    if (error_executed == error_executed_expected) {
      error_expected_executions.resolve();
    }
    assertStrictEquals(err, expected);
  });

  duplex.destroy(expected);
  assertEquals(duplex.destroyed, true);

  const error_timeout = setTimeout(
    () => error_expected_executions.reject(),
    1000,
  );
  await Promise.race([
    unexpected_execution,
    delay(100),
  ]);
  await error_expected_executions;
  clearTimeout(error_timeout);
  assertEquals(error_executed, error_executed_expected);
});

Deno.test("Duplex stream doesn't finish on allowHalfOpen", async () => {
  const unexpected_execution = deferred();

  const duplex = new Duplex({
    read() {},
  });

  assertEquals(duplex.allowHalfOpen, true);
  duplex.on("finish", () => unexpected_execution.reject());
  assertEquals(duplex.listenerCount("end"), 0);
  duplex.resume();
  duplex.push(null);

  await Promise.race([
    unexpected_execution,
    delay(100),
  ]);
});

Deno.test("Duplex stream finishes when allowHalfOpen is disabled", async () => {
  let finish_executed = 0;
  const finish_executed_expected = 1;
  const finish_expected_executions = deferred();

  const duplex = new Duplex({
    read() {},
    allowHalfOpen: false,
  });

  assertEquals(duplex.allowHalfOpen, false);
  duplex.on("finish", () => {
    finish_executed++;
    if (finish_executed == finish_executed_expected) {
      finish_expected_executions.resolve();
    }
  });
  assertEquals(duplex.listenerCount("end"), 0);
  duplex.resume();
  duplex.push(null);

  const finish_timeout = setTimeout(
    () => finish_expected_executions.reject(),
    1000,
  );
  await finish_expected_executions;
  clearTimeout(finish_timeout);
  assertEquals(finish_executed, finish_executed_expected);
});

Deno.test("Duplex stream doesn't finish when allowHalfOpen is disabled but stream ended", async () => {
  const unexpected_execution = deferred();

  const duplex = new Duplex({
    read() {},
    allowHalfOpen: false,
  });

  assertEquals(duplex.allowHalfOpen, false);
  duplex._writableState.ended = true;
  duplex.on("finish", () => unexpected_execution.reject());
  assertEquals(duplex.listenerCount("end"), 0);
  duplex.resume();
  duplex.push(null);

  await Promise.race([
    unexpected_execution,
    delay(100),
  ]);
});
