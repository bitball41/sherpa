import { createServer } from "node:http";

const host = process.env.FIXTURE_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.FIXTURE_PORT || "1338", 10);

function send(response, status, type, body) {
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-type": type,
	});
	response.end(body);
}

function page(body, script = "") {
	return `<!doctype html>
<html>
	<head>
		<meta charset="utf-8">
		<title>Sherpa integration fixture</title>
		<style>
			body { font-family: sans-serif; }
			iframe { width: 320px; height: 120px; border: 0; }
			img { width: 160px; height: 90px; }
		</style>
	</head>
	<body>
		${body}
		${script ? `<script>${script}</script>` : ""}
	</body>
</html>`;
}

const server = createServer((request, response) => {
	const url = new URL(request.url || "/", `http://${host}:${port}`);

	switch (url.pathname) {
		case "/health":
			send(response, 200, "text/plain; charset=utf-8", "ok");
			return;
		case "/document":
			send(
				response,
				200,
				"text/html; charset=utf-8",
				page(`
					<main data-page="document">Fixture document</main>
					<label>Search <textarea title="Search"></textarea></label>
				`)
			);
			return;
		case "/nested":
			send(
				response,
				200,
				"text/html; charset=utf-8",
				page(
					`
					<a href="/apps" aria-label="Fixture apps">Open apps</a>
					<iframe name="app" src="/apps" hidden></iframe>
					`,
					`
					const link = document.querySelector("[aria-label='Fixture apps']");
					const frame = document.querySelector("iframe[name='app']");
					link.addEventListener("click", (event) => {
						event.preventDefault();
						frame.hidden = false;
					});
					`
				)
			);
			return;
		case "/apps":
			send(
				response,
				200,
				"text/html; charset=utf-8",
				page("<c-wiz>Fixture apps loaded</c-wiz>")
			);
			return;
		case "/media":
			send(
				response,
				200,
				"text/html; charset=utf-8",
				page(`
					<div id="logo-icon"><span><div>Fixture logo</div></span></div>
				`)
			);
			return;
		case "/results": {
			const query = url.searchParams.get("search_query") || "";
			const safeQuery = query
				.replaceAll("&", "&amp;")
				.replaceAll("<", "&lt;")
				.replaceAll(">", "&gt;")
				.replaceAll('"', "&quot;");
			send(
				response,
				200,
				"text/html; charset=utf-8",
				page(`
					<div id="contents">
						<ytd-video-renderer>
							<div id="dismissible">
								<ytd-thumbnail>
									<a href="/media">
										<yt-image><img src="/thumbnail.svg" alt="fixture thumbnail"></yt-image>
									</a>
								</ytd-thumbnail>
							</div>
							<div id="video-title"><yt-formatted-string>${safeQuery}</yt-formatted-string></div>
						</ytd-video-renderer>
					</div>
				`)
			);
			return;
		}
		case "/thumbnail.svg":
			send(
				response,
				200,
				"image/svg+xml",
				`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#4c8bf5"/></svg>`
			);
			return;
		default:
			send(response, 404, "text/plain; charset=utf-8", "not found");
	}
});

server.listen(port, host, () => {
	console.log(`Sherpa test fixture listening on http://${host}:${port}`);
});

function close() {
	server.close(() => process.exit(0));
	server.closeAllConnections();
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
