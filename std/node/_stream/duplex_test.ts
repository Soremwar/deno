import Buffer from "../buffer.ts";
import Duplex from "./duplex.ts";
import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "../../testing/asserts.ts";
import { deferred } from "../../async/mod.ts";

Deno.test("Duplex stream works normally", () => {
  const stream = new Duplex({ objectMode: true });

  assert(stream._readableState.objectMode);
  assert(stream._writableState.objectMode);
  assert(stream.allowHalfOpen);
  assertEquals(stream.listenerCount("end"), 0);

  let written: {val: number};
  let read: {val: number};

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