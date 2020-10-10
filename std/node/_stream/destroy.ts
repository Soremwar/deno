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
  //if (typeof stream.close === "function") return stream.close();
  if (typeof (stream as Streams).destroy === "function") return (stream as Streams).destroy(err);
}