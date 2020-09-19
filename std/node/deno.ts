import {
  Readable,
} from "https://cdn.pika.dev/readable-stream@^3.6.0";

async function* generate() {
  yield "hello";
  yield "streams";
}

const readable = Readable.from(generate());

readable.on("data", (chunk: any) => {
  console.log(chunk);
});
