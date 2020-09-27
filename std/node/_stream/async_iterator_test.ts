import Readable from "./readable.ts";
import Stream from "./stream.ts";
import toReadableAsyncIterator from "./async_iterator.ts";
import {
  deferred,
} from "../../async/mod.ts";
import {
  assertEquals,
  assertThrowsAsync,
} from "../../testing/asserts.ts";

Deno.test("Stream to async iterator", async () => {
  let destroy_executed = 0;
  const destroy_executed_expected = 1;
  const destroy_expected_executions = deferred();

  class AsyncIteratorStream extends Stream {
    constructor() {
      super();
    }

    destroy() {
      destroy_executed++;
      if (destroy_executed == destroy_executed_expected) {
        destroy_expected_executions.resolve();
      }
    }

    [Symbol.asyncIterator] = Readable.prototype[Symbol.asyncIterator];
  }

  const stream = new AsyncIteratorStream();

  queueMicrotask(() => {
    stream.emit("data", "hello");
    stream.emit("data", "world");
    stream.emit("end");
  });

  let res = "";

  for await (const d of stream) {
    res += d;
  }
  assertEquals(res, "helloworld");

  const destroy_timeout = setTimeout(
    () => destroy_expected_executions.reject(),
    1000,
  );
  await destroy_expected_executions;
  clearTimeout(destroy_timeout);
  assertEquals(destroy_executed, destroy_executed_expected);
});

Deno.test("Stream to async iterator throws on 'error' emitted", async () => {
  let close_executed = 0;
  const close_executed_expected = 1;
  const close_expected_executions = deferred();

  let error_executed = 0;
  const error_executed_expected = 1;
  const error_expected_executions = deferred();

  class StreamImplementation extends Stream {
    close() {
      close_executed++;
      if (close_executed == close_executed_expected) {
        close_expected_executions.resolve();
      }
    }
  }

  const stream = new StreamImplementation();
  queueMicrotask(() => {
    stream.emit("data", 0);
    stream.emit("data", 1);
    stream.emit("error", new Error("asd"));
  });

  toReadableAsyncIterator(stream)
    .next()
    .catch((err) => {
      error_executed++;
      if (error_executed == error_executed_expected) {
        error_expected_executions.resolve();
      }
      assertEquals(err.message, "asd");
    });

  const close_timeout = setTimeout(
    () => close_expected_executions.reject(),
    1000,
  );
  const error_timeout = setTimeout(
    () => error_expected_executions.reject(),
    1000,
  );
  await close_expected_executions;
  await error_expected_executions;
  clearTimeout(close_timeout);
  clearTimeout(error_timeout);
  assertEquals(close_executed, close_executed_expected);
  assertEquals(error_executed, error_executed_expected);
});

Deno.test("Async iterator matches values of Readable", async () => {
  const readable = new Readable({
    objectMode: true,
    read() {},
  });
  readable.push(0);
  readable.push(1);
  readable.push(null);

  const iter = readable[Symbol.asyncIterator]();

  assertEquals(
    await iter.next().then(({ value }) => value),
    0,
  );
  for await (const d of iter) {
    assertEquals(d, 1);
  }
});

Deno.test("Async iterator throws on Readable destroyed sync", async () => {
  const message = "kaboom from read";

  const readable = new Readable({
    objectMode: true,
    read() {
      this.destroy(new Error(message));
    },
  });

  await assertThrowsAsync(
    async () => {
      // eslint-disable-next-line
      for await (const k of readable) {}
    },
    Error,
    message,
  );
});

Deno.test("Async iterator throws on Readable destroyed async", async () => {
  const message = "kaboom";
  const readable = new Readable({
    read() {},
  });
  const iterator = readable[Symbol.asyncIterator]();

  readable.destroy(new Error(message));

  await assertThrowsAsync(
    iterator.next.bind(iterator),
    Error,
    message,
  );
});

Deno.test("Async iterator finishes the iterator when Readable destroyed", async () => {
  const readable = new Readable({
    read() {},
  });

  readable.destroy();

  const { done } = await readable[Symbol.asyncIterator]().next();
  assertEquals(done, true);
});

Deno.test("Async iterator finishes all item promises when Readable destroyed", async () => {
  const r = new Readable({
    objectMode: true,
    read() {
    },
  });

  const b = r[Symbol.asyncIterator]();
  const c = b.next();
  const d = b.next();
  r.destroy();
  assertEquals(await c, { done: true, value: undefined });
  assertEquals(await d, { done: true, value: undefined });
});

Deno.test("Async iterator: 'next' is triggered by Readable push", async () => {
  const max = 42;
  let readed = 0;
  let received = 0;
  const readable = new Readable({
    objectMode: true,
    read() {
      this.push("hello");
      if (++readed === max) {
        this.push(null);
      }
    },
  });

  for await (const k of readable) {
    received++;
    assertEquals(k, "hello");
  }

  assertEquals(readed, received);
});

Deno.test("Async iterator: 'close' called on forced iteration end", async () => {
  let close_executed = 0;
  const close_executed_expected = 1;
  const close_expected_executions = deferred();

  class IndestructibleReadable extends Readable {
    constructor() {
      super({
        autoDestroy: false,
        read() {},
      });
    }

    close() {
      close_executed++;
      if (close_executed == close_executed_expected) {
        close_expected_executions.resolve();
      }
      readable.emit("close");
    }

    // deno-lint-ignore ban-ts-comment
    //@ts-ignore
    destroy = null;
  }

  const readable = new IndestructibleReadable();
  readable.push("asd");
  readable.push("asd");
  
  // eslint-disable-next-line
  for await (const d of readable) {
    break;
  }

  const close_timeout = setTimeout(
    () => close_expected_executions.reject(),
    1000,
  );
  await close_expected_executions;
  clearTimeout(close_timeout);
  assertEquals(close_executed, close_executed_expected);
});
