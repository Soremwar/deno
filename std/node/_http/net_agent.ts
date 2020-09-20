/**
 * This class was created to be inherited by both the
 * `http` (../http.ts) and `https` (../https.ts) classes,
 * to re-use logic and avoid duplicate code
 */

import { Agent, AgentOptions } from "./_http_agent.ts";
import { ClientRequest } from "./_http_client.ts";

export class NetAgent {
  public Agent(options: AgentOptions): Agent {
    return new Agent(options);
  }

  // TODO(any) This method has a 3rd parameter in node, a callback. should we still have that here?
  public get(url: string, options: RequestInit): ClientRequest {
    return this.request(url, options);
  }

  // TODO(any) This method has a 3rd parameter in node, a callback. should we still have that here?
  // TODO(any) This method could be abstracted into the inherited class, and made public
  public request(url: string, options: TODO): ClientRequest {
    return new ClientRequest(url, options);
  }

  public ClientRequest(input: string | URL, options, cb) { // TODO(any) Sort out params
    return new ClientRequest(input, options, cb);
  }
}
