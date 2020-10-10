import Buffer from "../buffer.ts";
import PassThrough from "./passthrough.ts";
import pipeline from "./pipeline.ts";
import Readable from "./readable.ts";
import Transform from "./transform.ts";
import Writable from "./writable.ts";
import {
  mustCall,
} from "../_utils.ts";
import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "../../testing/asserts.ts";
import type {
  NodeErrorAbstraction,
} from "../_errors.ts";

Deno.test("Pipeline ends on stream finished", async () => {
  let finished = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processed: any[] = [];
  const expected = [
    Buffer.from('a'),
    Buffer.from('b'),
    Buffer.from('c')
  ];

  const read = new Readable({
    read() {}
  });

  const write = new Writable({
    write(data, _enc, cb) {
      processed.push(data);
      cb();
    }
  });

  write.on('finish', () => {
    finished = true;
  });

  for (let i = 0; i < expected.length; i++) {
    read.push(expected[i]);
  }
  read.push(null);

  const [finished_completed, finished_cb] = mustCall((err?: NodeErrorAbstraction | null) => {
    assert(!err);
    assert(finished);
    assertEquals(processed, expected);
  }, 1);

  pipeline(read, write, finished_cb);

  await finished_completed;
});

Deno.test("Pipeline fails on stream destroyed", async () => {
  const read = new Readable({
    read() {}
  });

  const write = new Writable({
    write(_data, _enc, cb) {
      cb();
    }
  });

  read.push('data');
  queueMicrotask(() => read.destroy());

  const [pipeline_executed, pipeline_cb] = mustCall((err?: NodeErrorAbstraction | null) => {
    assert(err);
  }, 1);
  pipeline(read, write, pipeline_cb);

  await pipeline_executed;
});

Deno.test("Pipeline exits on stream error", async() => {
  const read = new Readable({
    read() {}
  });

  const transform = new Transform({
    transform(_data, _enc, cb) {
      cb(new Error('kaboom'));
    }
  });

  const write = new Writable({
    write(_data, _enc, cb) {
      cb();
    }
  });

  const [read_execution, read_cn] = mustCall();
  read.on('close', read_cn);
  const [close_execution, close_cn] = mustCall();
  transform.on('close', close_cn);
  const [write_execution, write_cn] = mustCall();
  write.on('close', write_cn);

  const error_executions = [read, transform, write]
    .map((stream) => {
      const [execution, cb] = mustCall((err?: NodeErrorAbstraction | null) => {
        assertEquals(err, new Error('kaboom'));
      });

      stream.on('error', cb);
      return execution;
    });

  const [pipeline_execution, pipeline_cb] = mustCall((err?: NodeErrorAbstraction | null) => {
    assertEquals(err, new Error('kaboom'));
  });
  const dst = pipeline(read, transform, write, pipeline_cb);

  assertStrictEquals(dst, write);

  read.push('hello');

  await read_execution;
  await close_execution;
  await write_execution;
  await Promise.all(error_executions);
  await pipeline_execution;
});

Deno.test("Pipeline exits on stream error 2", async () => {
  const transform_executions: Promise<void>[] = [];

  const makeTransform = () => {
    const tr = new Transform({
      transform(data, _enc, cb) {
        cb(null, data);
      }
    });

    const [execution, cb] = mustCall();
    tr.on('close', cb);
    transform_executions.push(execution);
    return tr;
  };

  const rs = new Readable({
    read() {
      rs.push('hello');
    }
  });

  let cnt = 10;

  const ws = new Writable({
    write(_data, _enc, cb) {
      cnt--;
      if (cnt === 0) return cb(new Error('kaboom'));
      cb();
    }
  });

  const [r_close_execution, r_close_cb] = mustCall();
  rs.on('close', r_close_cb);
  const [w_close_execution, w_close_cb] = mustCall();
  ws.on('close', w_close_cb);

  const [pipeline_execution, pipeline_cb] = mustCall((err?: NodeErrorAbstraction | null) => {
    assertEquals(err, new Error('kaboom'));
  });

  pipeline(
    rs,
    makeTransform(),
    makeTransform(),
    makeTransform(),
    makeTransform(),
    makeTransform(),
    makeTransform(),
    ws,
    pipeline_cb,
  );

  await r_close_execution;
  await w_close_execution;
  await Promise.all(transform_executions);
  await pipeline_execution;
});

Deno.test("Pipeline processes iterators correctly", async () => {
  let res = '';
  const w = new Writable({
    write(chunk, _encoding, callback) {
      res += chunk;
      callback();
    }
  });

  const [pipeline_execution, pipeline_cb] = mustCall((err?: NodeErrorAbstraction | null) => {
    assert(!err);
    assertEquals(res, 'helloworld');
  });
  pipeline(
    function*() {
      yield 'hello';
      yield 'world';
    }(),
    w,
    pipeline_cb,
  );

  await pipeline_execution;
});

Deno.test("Pipeline processes async iterators correctly", async () => {
  let res = '';
  const w = new Writable({
    write(chunk, _encoding, callback) {
      res += chunk;
      callback();
    }
  });

  const [pipeline_execution, pipeline_cb] = mustCall((err?: NodeErrorAbstraction | null) => {
    assert(!err);
    assertEquals(res, 'helloworld');
  });
  pipeline(
    async function*() {
      await Promise.resolve();
      yield 'hello';
      yield 'world';
    }(),
    w,
    pipeline_cb,
  );

  await pipeline_execution;
});

Deno.test("Pipeline processes generators correctly", async () => {
  let res = '';
  const w = new Writable({
    write(chunk, _encoding, callback) {
      res += chunk;
      callback();
    }
  });

  const [pipeline_execution, pipeline_cb] = mustCall((err?: NodeErrorAbstraction | null) => {
    assert(!err);
    assertEquals(res, 'helloworld');
  });
  pipeline(
    function*() {
      yield 'hello';
      yield 'world';
    },
    w,
    pipeline_cb,
  );

  await pipeline_execution;
});

Deno.test("Pipeline processes async generators correctly", async () => {
  let res = '';
  const w = new Writable({
    write(chunk, _encoding, callback) {
      res += chunk;
      callback();
    }
  });

  const [pipeline_execution, pipeline_cb] = mustCall((err?: NodeErrorAbstraction | null) => {
    assert(!err);
    assertEquals(res, 'helloworld');
  });
  pipeline(
    async function*() {
      await Promise.resolve();
      yield 'hello';
      yield 'world';
    },
    w,
    pipeline_cb,
  );

  await pipeline_execution;
});

Deno.test("Pipeline handles generator transforms", async () => {
  let res = '';

  const [pipeline_executed, pipeline_cb] = mustCall((err?: NodeErrorAbstraction | null) => {
    assert(!err);
    assertEquals(res, 'HELLOWORLD');
  });
  pipeline(
    async function*() {
      await Promise.resolve();
      yield 'hello';
      yield 'world';
    },
    async function*(source: string[]) {
      for await (const chunk of source) {
        yield chunk.toUpperCase();
      }
    },
    async function(source: string[]) {
      for await (const chunk of source) {
        res += chunk;
      }
    },
    pipeline_cb,
  );

  await pipeline_executed;
});

Deno.test("Pipeline passes result to final callback", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pipeline_executed, pipeline_cb] = mustCall((err?: NodeErrorAbstraction | null, val?: any) => {
    assert(!err);
    assertEquals(val, 'HELLOWORLD');
  });
  pipeline(
    async function*() {
      await Promise.resolve();
      yield 'hello';
      yield 'world';
    },
    async function*(source: string[]) {
      for await (const chunk of source) {
        yield chunk.toUpperCase();
      }
    },
    async function(source: string[]) {
      let ret = '';
      for await (const chunk of source) {
        ret += chunk;
      }
      return ret;
    },
    pipeline_cb,
  );

  await pipeline_executed;
});

Deno.test("Pipeline returns a stream after ending", async () => {
  const [pipeline_executed, pipeline_cb] = mustCall((err?: NodeErrorAbstraction | null) => {
    assertEquals(err, undefined);
  });
  const ret = pipeline(
    async function*() {
      await Promise.resolve();
      yield 'hello';
    },
    // deno-lint-ignore require-yield
    async function*(source: string[]) {
      for await (const chunk of source) {
        chunk;
      }
    },
    pipeline_cb,
  );

  ret.resume();

  assertEquals(typeof ret.pipe, 'function');

  await pipeline_executed;
});

Deno.test("Pipeline returns a stream after erroring", async () => {
  const error_text = "kaboom";

  const [pipeline_executed, pipeline_cb] = mustCall((err?: NodeErrorAbstraction | null) => {
    assertEquals(err?.message, error_text);
  });
  const ret = pipeline(
    // deno-lint-ignore require-yield
    async function*() {
      await Promise.resolve();
      throw new Error(error_text);
    },
    // deno-lint-ignore require-yield
    async function*(source: string[]) {
      for await (const chunk of source) {
        chunk;
      }
    },
    pipeline_cb,
  );

  ret.resume();

  assertEquals(typeof ret.pipe, 'function');

  await pipeline_executed;
});

Deno.test("Pipeline destination gets destroyed on error", async () => {
  const error_text = "kaboom";
  const s = new PassThrough();

  const [pipeline_execution, pipeline_cb] = mustCall((err?: NodeErrorAbstraction | null) => {
    assertEquals(err?.message, error_text);
    assertEquals(s.destroyed, true);
  });
  pipeline(
    // deno-lint-ignore require-yield
    async function*() {
      throw new Error(error_text);
    },
    s,
    pipeline_cb,
  );

  await pipeline_execution;
});