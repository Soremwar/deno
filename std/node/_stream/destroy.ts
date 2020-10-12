import type Duplex from "./duplex.ts";
import type Readable from "./readable.ts";
import type Stream from "./stream.ts";
import type Writable from "./writable.ts";

//This whole module acts as a 'normalizer'
//Idea behind it is you can pass any kind of streams and functions will execute anyways

//TODO(Soremwar)
//Should be any implementation of stream
//This is a guard to check executed methods exist inside the implementation
type Streams = Duplex | Readable | Writable;

// TODO(Soremwar)
// Bring back once requests are implemented
// function isRequest(stream: any) {
//   return stream && stream.setHeader && typeof stream.abort === "function";
// }

export function destroyer(stream: Stream, err?: Error | null) {
  // TODO(Soremwar)
  // Bring back once requests are implemented
  // if (isRequest(stream)) return stream.abort();
  // if (isRequest(stream.req)) return stream.req.abort();
  if (
    typeof (stream as Streams).destroy === "function"
  ) {
    return (stream as Streams).destroy(err);
  }
  //A test of async iterator mocks an upcoming implementation of stream
  //This is casted to any in the meanwhile
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (stream as any).close === "function") {
    return (stream as any).close();
  }
}
