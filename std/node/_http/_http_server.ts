// TODO(any) Finish: https://github.com/nodejs/node/blob/c205f672e9cf0c70ea26f87eb97342947a244e18/lib/_http_server.js#L334
import {
  HTTPOptions,
  serve,
  Server as DenoServer,
  ServerRequest,
} from "../../http/server.ts";

export class Server {
  private readonly request_listener: (
    req: ServerRequest,
    res: Response,
  ) => void;

  private server: DenoServer;

  public options: HTTPOptions;

  constructor(
    options: HTTPOptions | ((req: ServerRequest, res: Response) => void),
    requestListener?: (req: ServerRequest, res: Response) => void,
  ) {
    if (typeof options === "function") {
      this.request_listener = options;
      this.options = {};
    } else {
      this.request_listener = requestListener;
      this.options = options;
    }
  }

  public async listen(address: string | HTTPOptions) {
    this.server = serve(address);
    await this._listen();
  }

  private async _listen() {
    try {
      for await (const request of this.server) {
        const response = new Response(request);
        this.request_listener(request as ServerRequest, response);
      }
    } catch (e) {
      this.server.close();
    }
  }
}
