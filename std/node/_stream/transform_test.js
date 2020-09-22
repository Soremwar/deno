import Transform from "./transform.js";
import finished from "../internal/streams/end-of-stream.js";
import {
  deferred,
} from "../../async/mod.ts";
import {
  assert,
  assertEquals,
} from "../../testing/asserts.ts";

Deno.test("Transform stream finishes correctly", async () => {
  const finished_executed = 0;
  const finished_executed_expected = 1;
  const finished_execution = deferred();

  const tr = new Transform({
    transform(_data, _enc, cb) {
      cb();
    }
  });

  let finish = false;
  let ended = false;

  tr.on('end', () => {
    ended = true;
  });

  tr.on('finish', () => {
    finish = true;
  });

  finished(tr, (err) => {
    if(finished_executed === finished_executed_expected){
      finished_execution.resolve();
    }
    assert(!err, 'no error');
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

const tr = new Transform({
  transform(_data, _enc, cb) {
    cb();
  }
});

let finish = false;
let ended = false;

tr.on('end', () => {
  ended = true;
});

tr.on('finish', () => {
  finish = true;
});

tr.on('prefinish', () => {
  console.log("prefinish is emitted correctly")
})

finished(tr, (err) => {
  assert(!err, 'no error');
  assert(finish);
  assert(ended);
});

tr.end();
tr.resume();