import { readFile } from "node:fs/promises";

import { createLinter } from "actionlint";
import { glob } from "glob";

const lint = await createLinter();
const files = await glob(".github/workflows/*.{yml,yaml}");
let errorCount = 0;

for (const file of files.sort()) {
	const source = await readFile(file, "utf8");
	for (const error of lint(source, file)) {
		// The WASM package currently embeds an actionlint release from before the
		// GitHub Actions `vars` context, so this one diagnostic is a known parser
		// limitation rather than a workflow error.
		if (
			error.kind === "expression" &&
			error.message ===
				'undefined variable "vars". available variables are "env", "github", "inputs", "job", "matrix", "needs", "runner", "secrets", "steps", "strategy"'
		)
			continue;

		console.error(
			`${error.file}:${error.line}:${error.column}: ${error.message} [${error.kind}]`
		);
		errorCount++;
	}
}

if (errorCount) process.exitCode = 1;
