import Buffer from "../buffer.ts";
import Transform from "./transform.ts";
import finished from "./end-of-stream.ts";
import { deferred } from "../../async/mod.ts";
import { assert, assertEquals } from "../../testing/asserts.ts";

Deno.test("Transform stream finishes correctly", async () => {
  let finished_executed = 0;
  const finished_executed_expected = 1;
  const finished_execution = deferred();

  const tr = new Transform({
    transform(_data, _enc, cb) {
      cb();
    },
  });

  let finish = false;
  let ended = false;

  tr.on("end", () => {
    ended = true;
  });

  tr.on("finish", () => {
    finish = true;
  });

  finished(tr, (err) => {
    finished_executed++;
    if (finished_executed === finished_executed_expected) {
      finished_execution.resolve();
    }
    assert(!err, "no error");
    assert(finish);
    assert(ended);
  });

  tr.end();
  tr.resume();

  const finished_timeout = setTimeout(
    () => finished_execution.reject(),
    1000,
  );
  await finished_execution;
  clearTimeout(finished_timeout);
  assertEquals(finished_executed, finished_executed_expected);
});

Deno.test("Transform stream flushes data correctly", async () => {
  const expected = "asdf";

  const t = new Transform({
    transform: (_d, _e, n) => {
      n();
    },
    flush: (n) => {
      n(null, expected);
    },
  });

  t.end(Buffer.from("blerg"));
  t.on("data", (data) => {
    assertEquals(data.toString(), expected);
  });
});
