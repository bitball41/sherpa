// Minimal Sherpa integration server.
//
// This is the smallest backend that makes Sherpa work in a browser. It serves:
//   1. the app itself            (examples/minimal/public/ -> /)
//   2. the built Sherpa engine   (dist/ -> /scram/)
//   3. bare-mux + a transport    (/baremux/, /epoxy/)
//   4. a Wisp server             (/wisp/ upgrades) for outbound traffic
// plus the cross-origin-isolation headers Sherpa needs. None of this is
// Sherpa-specific plumbing you have to invent — it's the standard bare-mux/Wisp
// setup any browser proxy uses.
//
// Run from the repo root (after `pnpm build`):  node examples/minimal/server.mjs

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const PORT = Number(process.env.PORT) || 8989;
const HOST = process.env.HOST || "127.0.0.1";
const ALLOW_PRIVATE_NETWORKS =
	process.env.ALLOW_PRIVATE_NETWORKS === "1" ||
	["127.0.0.1", "::1", "localhost"].includes(HOST);

// Local-only demos may reach private hosts; public bindings must opt in.
wisp.options.allow_loopback_ips = ALLOW_PRIVATE_NETWORKS;
wisp.options.allow_private_ips = ALLOW_PRIVATE_NETWORKS;

const fastify = Fastify({
	serverFactory: (handler) =>
		createServer()
			.on("request", (req, res) => {
				// Cross-origin isolation is required for Sherpa's SharedArrayBuffer
				// features (e.g. synchronous XHR) and for the epoxy transport.
				res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
				res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
				handler(req, res);
			})
			// Only the configured transport endpoint accepts WebSocket upgrades.
			.on("upgrade", (req, socket, head) => {
				if (req.url?.startsWith("/wisp/")) {
					wisp.routeRequest(req, socket, head);
				} else {
					socket.destroy();
				}
			}),
});

// 1. The app (index.html + sw.js).
fastify.register(fastifyStatic, {
	root: here("./public"),
	decorateReply: false,
});
// 2. The built engine: bundle + wasm + sync runtime.
fastify.register(fastifyStatic, {
	root: here("../../dist"),
	prefix: "/scram/",
	decorateReply: false,
});
// 3. bare-mux and the epoxy transport.
fastify.register(fastifyStatic, {
	root: baremuxPath,
	prefix: "/baremux/",
	decorateReply: false,
});
fastify.register(fastifyStatic, {
	root: epoxyPath,
	prefix: "/epoxy/",
	decorateReply: false,
});

await fastify.listen({ port: PORT, host: HOST });
console.log(`Sherpa minimal example → http://localhost:${PORT}/`);
