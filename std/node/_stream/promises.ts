import pl from "./pipeline.ts";
import type { PipelineArguments } from "./pipeline.ts";
import eos from "./end-of-stream.ts";
import type {
  FinishedOptions,
  StreamImplementations as FinishedStreams,
} from "./end-of-stream.ts";

export function pipeline(...streams: PipelineArguments) {
  return new Promise((resolve, reject) => {
    pl(
      ...streams,
      (err, value) => {
        if (err) {
          reject(err);
        } else {
          resolve(value);
        }
      },
    );
  });
}

export function finished(
  stream: FinishedStreams,
  opts?: FinishedOptions,
) {
  return new Promise((resolve, reject) => {
    eos(
      stream,
      opts || null,
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      },
    );
  });
}
