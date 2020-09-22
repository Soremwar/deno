import { assert, assertEquals } from "../testing/asserts.ts";
import { deferred } from "../async/mod.ts";
import Buffer from "./buffer.ts";
import Readable from "./_stream/readable.js";
import Writable from "./_stream/writable.js";

Deno.test("Readable and Writable stream backpressure test", async () => {
  let pushes = 0;
  const total = 65500 + 40 * 1024;

  let rs_executed = 0;
  const rs_executed_expected = 11;
  const rs_expected_executions = deferred();

  let ws_executed = 0;
  const ws_executed_expected = 410;
  const ws_expected_executions = deferred();

  const rs = new Readable({
    read: function () {
      rs_executed++;
      if (rs_executed == rs_executed_expected) {
        rs_expected_executions.resolve();
      }

      if (pushes++ === 10) {
        this.push(null);
        return;
      }

      assert(this._readableState.length <= total);

      this.push(Buffer.alloc(65500));
      for (let i = 0; i < 40; i++) {
        this.push(Buffer.alloc(1024));
      }
    },
  });

  const ws = new Writable({
    write: function (_data, _enc, cb) {
      ws_executed++;
      if (ws_executed == ws_executed_expected) {
        ws_expected_executions.resolve();
      }
      cb();
    },
  });

  rs.pipe(ws);

  const rs_timeout = setTimeout(() => rs_expected_executions.reject(), 1000);
  const ws_timeout = setTimeout(() => ws_expected_executions.reject(), 1000);
  await rs_expected_executions;
  await ws_expected_executions;
  clearTimeout(rs_timeout);
  clearTimeout(ws_timeout);
  assertEquals(rs_executed, rs_executed_expected);
  assertEquals(ws_executed, ws_executed_expected);
});
