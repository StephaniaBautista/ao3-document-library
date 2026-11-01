import handler from "vinext/server/fetch-handler";
import { processMetadata } from "../lib/catalog/metadata-worker";
import { checkAo3AndNotify } from "../lib/catalog/ao3-scheduler";
import { processRemovalNotifications } from "../lib/catalog/removal-notifications";
import { processObjectDeletions } from "../lib/catalog/object-deletions";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import { secureResponse } from "../lib/security-headers.mjs";

const worker = {
  async scheduled(_event: ScheduledController, env: Cloudflare.Env) {
    if (!env.DB) return;
    const results = await Promise.allSettled([checkAo3AndNotify(env), processMetadata(env), processObjectDeletions(env), processRemovalNotifications(env)]);
    for (const result of results) if (result.status === 'rejected') console.error('A scheduled library task failed.');
  },
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const requestPath = new URL(request.url).pathname;
    if (/^\/api\/translations(?:\/|$)/.test(requestPath)) {
      return secureResponse(Response.json({ error: 'This integration is no longer available.' }, { status: 410, headers: { 'Cache-Control': 'no-store' } }), request.url);
    }
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    const response = await runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
    // Vinext may wrap streamed route responses and lose their known length.
    // Restore it at the Worker boundary so PDF.js can request byte ranges.
    const path = new URL(request.url).pathname;
    const lengthHeader = response.headers.get('X-Catalog-Body-Length');
    if (request.method === 'GET' && /^\/api\/catalog\/stories\/[^/]+\/file$/.test(path) && response.body && (response.status === 200 || response.status === 206) && lengthHeader && /^\d{1,16}$/.test(lengthHeader)) {
      const length = Number(lengthHeader);
      if (Number.isSafeInteger(length)) {
        const stream = new FixedLengthStream(length), headers = new Headers(response.headers);
        headers.delete('X-Catalog-Body-Length');
        headers.set('Content-Length', String(length));
        void response.body.pipeTo(stream.writable).catch(() => {});
        return secureResponse(new Response(stream.readable, { status: response.status, statusText: response.statusText, headers }), request.url);
      }
    }
    return secureResponse(response, request.url);
  },
};

export default worker;
