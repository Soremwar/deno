import Buffer from "../buffer.ts";
import Writable from "../_stream/writable.js";
import {
  deferred,
} from "../../async/mod.ts";
import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "../../testing/asserts.ts";

Deno.test("Writable stream writes correctly", async () => {
  let callback;

  let write_executed = 0;
  const write_executed_expected = 1;
  const write_expected_executions = deferred();

  let writev_executed = 0;
  const writev_executed_expected = 1;
  const writev_expected_executions = deferred();

  const writable = new Writable({
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
  callback();

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

Deno.test("Writable stream writes Uint8Array in object mode", async () => {
  let write_executed = 0;
  const write_executed_expected = 1;
  const write_expected_executions = deferred();

  const ABC = new TextEncoder().encode("ABC");

  const writable = new Writable({
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
