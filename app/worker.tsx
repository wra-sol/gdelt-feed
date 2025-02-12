import { createRequestHandler } from "@react-router/node";
import { type ServerBuild } from "@react-router/dev/server";

// @ts-ignore - this will be replaced by Vite with the actual build
import * as build from "virtual:server-build";

export default {
  async fetch(request: Request, env: any, ctx: any) {
    const handler = createRequestHandler(build as unknown as ServerBuild);
    return handler(request);
  },
}; 