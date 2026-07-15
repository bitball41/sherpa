// Dev server imports
import { createBareServer } from "@nebula-services/bare-server-node";
import { createServer } from "http";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { join } from "node:path";
import rspackConfig from "./rspack.config.js";
import { rspack } from "@rspack/core";
import { fileURLToPath } from "node:url";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";

//transports
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { bareModulePath } from "@mercuryworkshop/bare-as-module3";

const PORT = process.env.PORT ? parseInt(process.env.PORT) || 1337 : 1337;
const HOST = process.env.HOST || "127.0.0.1";
const ALLOW_PRIVATE_NETWORKS = process.env.ALLOW_PRIVATE_NETWORKS === "1";

const bare = createBareServer("/bare/", {
	logErrors: true,
	blockLocal: !ALLOW_PRIVATE_NETWORKS,
});

wisp.options.allow_loopback_ips = ALLOW_PRIVATE_NETWORKS;
wisp.options.allow_private_ips = ALLOW_PRIVATE_NETWORKS;

const fastify = Fastify({
	serverFactory: (handler) => {
		return createServer()
			.on("request", (req, res) => {
				res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
				res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");

				if (bare.shouldRoute(req)) {
					bare.routeRequest(req, res);
				} else {
					handler(req, res);
				}
			})
			.on("upgrade", (req, socket, head) => {
				if (bare.shouldRoute(req)) {
					bare.routeUpgrade(req, socket, head);
				} else if (req.url?.startsWith("/wisp/")) {
					wisp.routeRequest(req, socket, head);
				} else {
					socket.destroy();
				}
			});
	},
});

fastify.register(fastifyStatic, {
	root: join(fileURLToPath(new URL(".", import.meta.url)), "./static"),
	decorateReply: false,
});
fastify.register(fastifyStatic, {
	root: join(fileURLToPath(new URL(".", import.meta.url)), "./dist"),
	prefix: "/scram/",
	decorateReply: false,
});
fastify.register(fastifyStatic, {
	root: join(fileURLToPath(new URL(".", import.meta.url)), "./assets"),
	prefix: "/assets/",
	decorateReply: false,
});
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
fastify.register(fastifyStatic, {
	root: libcurlPath,
	prefix: "/libcurl/",
	decorateReply: false,
});
fastify.register(fastifyStatic, {
	root: bareModulePath,
	prefix: "/baremod/",
	decorateReply: false,
});

fastify.setNotFoundHandler((request, reply) => {
	console.error("PAGE PUNCHED THROUGH SW - " + request.url);
	reply.code(593).send("punch through");
});

await fastify.listen({
	port: PORT,
	host: HOST,
});
console.log(`Listening on http://localhost:${PORT}/`);
if (!process.env.CI) {
	const compiler = rspack(rspackConfig);
	compiler.watch({}, (err, stats) => {
		if (err) {
			console.error("Sherpa build failed", err);
			return;
		}

		console.log(
			stats
				? stats.toString({
						preset: "minimal",
						colors: true,
						version: false,
					})
				: ""
		);
	});
}
