import Buffer from "../buffer.ts";
import Readable from "../_stream/readable.js";
import {
  once,
} from "../events.ts";
import {
  assert,
  assertStrictEquals,
} from "../../testing/asserts.ts";

Deno.test("Readable streams from iterator", async () => {
  function* generate() {
    yield "a";
    yield "b";
    yield "c";
  }

  const stream = Readable.from(generate());

  const expected = ["a", "b", "c"];

  for await (const chunk of stream) {
    assertStrictEquals(chunk, expected.shift());
  }
});

Deno.test("Readable streams from async iterator", async () => {
  async function* generate() {
    yield "a";
    yield "b";
    yield "c";
  }

  const stream = Readable.from(generate());

  const expected = ["a", "b", "c"];

  for await (const chunk of stream) {
    assertStrictEquals(chunk, expected.shift());
  }
});

Deno.test("Readable streams from promise", async () => {
  const promises = [
    Promise.resolve("a"),
    Promise.resolve("b"),
    Promise.resolve("c"),
  ];

  const stream = Readable.from(promises);

  const expected = ["a", "b", "c"];

  for await (const chunk of stream) {
    assertStrictEquals(chunk, expected.shift());
  }
});

Deno.test("Readable streams from string", async () => {
  const string = "abc";
  const stream = Readable.from(string);

  for await (const chunk of stream) {
    assertStrictEquals(chunk, string);
  }
});

Deno.test("Readable streams from Buffer", async () => {
  const string = "abc";
  const stream = Readable.from(Buffer.from(string));

  for await (const chunk of stream) {
    assertStrictEquals(chunk.toString(), string);
  }
});

Deno.test("Readable streams: 'on' event", async () => {
  async function* generate() {
    yield "a";
    yield "b";
    yield "c";
  }

  const stream = Readable.from(generate());

  let iterations = 0;
  const expected = ["a", "b", "c"];

  stream.on("data", (chunk) => {
    iterations++;
    assertStrictEquals(chunk, expected.shift());
  });

  await once(stream, "end");

  assertStrictEquals(iterations, 3);
});

Deno.test("Readable streams: 'data' event", async () => {
  async function* generate() {
    yield "a";
    yield "b";
    yield "c";
  }

  const stream = Readable.from(generate(), { objectMode: false });

  let iterations = 0;
  const expected = ["a", "b", "c"];

  stream.on("data", (chunk) => {
    iterations++;
    assertStrictEquals(chunk instanceof Buffer, true);
    assertStrictEquals(chunk.toString(), expected.shift());
  });

  await once(stream, "end");

  assertStrictEquals(iterations, 3);
});

Deno.test("Readable streams: 'data' event on non-object", async () => {
  async function* generate() {
    yield "a";
    yield "b";
    yield "c";
  }

  const stream = Readable.from(generate(), { objectMode: false });

  let iterations = 0;
  const expected = ["a", "b", "c"];

  stream.on("data", (chunk) => {
    iterations++;
    assertStrictEquals(chunk instanceof Buffer, true);
    assertStrictEquals(chunk.toString(), expected.shift());
  });

  await once(stream, "end");

  assertStrictEquals(iterations, 3);
});

Deno.test("Readable streams gets destroyed on error", async () => {
  // deno-lint-ignore require-yield
  async function* generate() {
    throw new Error("kaboom");
  }

  const stream = Readable.from(generate());

  stream.read();

  const [err] = await once(stream, "error");
  assertStrictEquals(err.message, "kaboom");
  assertStrictEquals(stream.destroyed, true);
});

Deno.test("Readable streams works as Transform stream", async () => {
  async function* generate(stream) {
    for await (const chunk of stream) {
      yield chunk.toUpperCase();
    }
  }

  const source = new Readable({
    objectMode: true,
    read() {
      this.push("a");
      this.push("b");
      this.push("c");
      this.push(null);
    },
  });

  const stream = Readable.from(generate(source));

  const expected = ["A", "B", "C"];

  for await (const chunk of stream) {
    assertStrictEquals(chunk, expected.shift());
  }
});

Deno.test("Readable stream can be paused", () => {
  const readable = new Readable();

  // _read is a noop, here.
  readable._read = Function();

  // Default state of a stream is not "paused"
  assert(!readable.isPaused());

  // Make the stream start flowing...
  readable.on("data", Function());

  // still not paused.
  assert(!readable.isPaused());

  readable.pause();
  assert(readable.isPaused());
  readable.resume();
  assert(!readable.isPaused());
});
