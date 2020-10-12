import Buffer from "../buffer.ts";
import Readable from "./readable.ts";
import Writable from "./writable.ts";
import { pipeline } from "./promises.ts";
import { deferred } from "../../async/mod.ts";
import {
  assert,
  assertEquals,
  assertThrowsAsync,
} from "../../testing/asserts.ts";

Deno.test("Promise pipeline works correctly", async () => {
  let pipeline_executed = 0;
  const pipeline_executed_expected = 1;
  const pipeline_expected_executions = deferred();

  let finished = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processed: any[] = [];
  const expected = [
    Buffer.from("a"),
    Buffer.from("b"),
    Buffer.from("c"),
  ];

  const read = new Readable({
    read() {},
  });

  const write = new Writable({
    write(data, _enc, cb) {
      processed.push(data);
      cb();
    },
  });

  write.on("finish", () => {
    finished = true;
  });

  for (let i = 0; i < expected.length; i++) {
    read.push(expected[i]);
  }
  read.push(null);

  pipeline(read, write).then(() => {
    pipeline_executed++;
    if (pipeline_executed == pipeline_executed_expected) {
      pipeline_expected_executions.resolve();
    }
    assert(finished);
    assertEquals(processed, expected);
  });

  const pipeline_timeout = setTimeout(
    () => pipeline_expected_executions.reject(),
    1000,
  );
  await pipeline_expected_executions;
  clearTimeout(pipeline_timeout);
  assertEquals(pipeline_executed, pipeline_executed_expected);
});

Deno.test("Promise pipeline throws on readable destroyed", async () => {
  const read = new Readable({
    read() {},
  });

  const write = new Writable({
    write(_data, _enc, cb) {
      cb();
    },
  });

  read.push("data");
  read.destroy();

  await assertThrowsAsync(
    () => pipeline(read, write),
    Error,
    "Premature close",
  );
});
