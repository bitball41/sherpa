import { spawn } from "node:child_process";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const children = [
	spawn(npx, ["--no-install", "typedoc", "--watch"], { stdio: "inherit" }),
	spawn(npx, ["--yes", "serve", "_docs"], { stdio: "inherit" }),
];
let closing = false;

function stop(exitCode) {
	if (closing) return;
	closing = true;
	process.exitCode = exitCode;
	for (const child of children) {
		if (child.exitCode === null && child.signalCode === null) child.kill();
	}
}

for (const child of children) {
	child.on("error", (error) => {
		console.error(error);
		stop(1);
	});
	child.on("exit", (code, signal) => {
		if (!closing) stop(code ?? (signal ? 1 : 0));
	});
}

process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));
