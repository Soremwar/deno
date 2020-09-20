import { HTTPOptions, HTTPSOptions, ServerRequest } from "../http/server.ts";
import { NetAgent } from "./_http/net_agent.ts";
import { Server } from "./_http/_http_server.ts";

export class Https extends NetAgent {
  public Server(
    options: HTTPSOptions,
    requestListener: (req: ServerRequest, res: Response) => void,
  ): Server {
    return new Server(options, requestListener);
  }

  /**
   * Create a HTTPS server
   *
   *      const server = https.createServer(...)
   *      for await (const req of server) {
   *        ...
   *      }
   *
   * @param options - Configs to start the server on
   * @param requestListener - Callback for when a request is made
   */
  public createServer(
    options: HTTPSOptions | ((req: ServerRequest, res: Response) => void),
    requestListener: (req: ServerRequest, res: Response) => void,
  ): Server {
    return new Server(options, requestListener);
  }
}
