import pl from "./pipeline.js";
import eos from "./end-of-stream.ts";

function pipeline(...streams) {
  return new Promise((resolve, reject) => {
    pl(...streams, (err, value) => {
      if (err) {
        reject(err);
      } else {
        resolve(value);
      }
    });
  });
}

function finished(stream, opts) {
  return new Promise((resolve, reject) => {
    eos(stream, opts, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

export {
  finished,
  pipeline,
};
