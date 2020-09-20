/**
 * Only test the specific HTTPS methods.
 * All HTTP related methods are tested in `./http_test.ts`.
 * This file is only to test the secure side.
 */

import { Https } from "./https.ts";

// TODO(any) Start a https server, make a request, assert request was successful
Deno.test("Can run a HTTPS server", async () => {
  const https = new Https();
});
