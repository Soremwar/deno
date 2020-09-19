//import { Http } from "./http.ts";
import {serve, ServerRequest} from "../http/server.ts";
import {assertEquals} from "../testing/asserts.ts";

// TODO(any) Covers: Http#Server
Deno.test("Can return a Server object and then listen", () => {
  // const http = new Http()
  // let response;
  // const server = http.Server({
  //   hostname: "localhost",
  //   port: 1337
  // }, (req: ServerRequest, res: Response) => {
  //   response = res
  // })
  // TODO(any) Send request, and assert response is set with correct properties
})

// TODO(any) Covers: Http#createServer
Deno.test("Can start a server", () => {
  // const http = new Http()
  // let response;
  // const server = http.createServer({
  //   hostname: "localhost",
  //   port: 1337
  // }, (req: ServerRequest, res: Response) => {
  //   response = res
  // })
  // TODO(any) Send request, and assert response is set with correct properties
})

// TODO(any) Covers: Http#Agent
Deno.test("Can create an agent", () => {
})

// TODO(any) Covers: Http#ClientRequest
Deno.test("Can create a client request", () => {

})

// TODO(any) Covers: Http#IncomingMessage
Deno.test("Can do whatever this method needs to do", () => {

})

// TODO(any) Covers: Http#OutgoingMessage
Deno.test("Can do whatever this method needs to do", () => {

})

// TODO(any) Covers: Http#ServerResponse
Deno.test("Can do whatever this method needs to do", () => {

})

// TODO(any) Covers: Http#validateHeaderName
Deno.test("Can correctly validate HTTP headers", () => {
  const invalidHTTPHeaderNames = []
  const validHTTPHeaderNames = []
  //const http = new Http()
  // TODO(any) Loop over each invalid header name, asserting error was thrown
  // TODO(any) Loop over each valid header name, asserting no errors were thrown
})

// TODO(any) Covers: Http#validateHeaderValue
Deno.test("Can correctly validate HTTP header values", () => {
  const invalidHTTPHeaderValues = []
  const validHTTPHeaderValues = []
  //const http = new Http()
  // TODO(any) Loop over each invalid header value, asserting error was thrown
  // TODO(any) Loop over each valid header value, asserting no errors were thrown
})

// TODO(any) Covers: Http#get
Deno.test("Can send a GET request and return the expected response", async () => {
  // const http = new Http()
  // const server = serve({ port: 1337 });
  // const response = await http.get("http://localhost:1337")
  // assertEquals(response.status_code, 200)
  // server.close()
})

// TODO(any) Covers: Http#request
Deno.test("Can send requests matching all HTTP verbs and return the expected responses", async () => {
  // const http = new Http()
  // const server = serve({ port: 1337 });
  // let response = await http.request("http://localhost:1337", {
  //   method: "GET"
  // })
  // assertEquals(response.status_code, 200)
  // response = await http.request("http://localhost:1337", {
  //   method: "POST"
  // })
  // assertEquals(response.status_code, 200);
  // response = await http.request("http://localhost:1337", {
  //   method: "PUT"
  // })
  // assertEquals(response.status_code, 200)
  // response = await http.request("http://localhost:1337", {
  //   method: "DELETE"
  // })
  // assertEquals(response.status_code, 200)
  // server.close()
})


