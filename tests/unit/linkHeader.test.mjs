import assert from "node:assert/strict";
import test from "node:test";

import { rewriteLinkHeader } from "../../src/shared/rewriters/linkHeader.ts";

const rewrite = (url) => `proxy:${url}`;

test("rewrites one Link target without consuming its brackets", () => {
	assert.equal(
		rewriteLinkHeader(
			'<https://cdn.test/app.js>; rel="preload"; as="script"',
			rewrite
		),
		'<proxy:https://cdn.test/app.js>; rel="preload"; as="script"'
	);
});

test("rewrites every target in a combined Link header", () => {
	const header =
		'<https://cdn.test/a.css>; rel="preload"; title="a,b", <icons.svg>; rel="icon"';

	assert.equal(
		rewriteLinkHeader(header, rewrite),
		'<proxy:https://cdn.test/a.css>; rel="preload"; title="a,b", <proxy:icons.svg>; rel="icon"'
	);
});

test("leaves malformed text outside valid angle-bracket targets alone", () => {
	assert.equal(
		rewriteLinkHeader("not-a-link, <>; rel=next", rewrite),
		"not-a-link, <>; rel=next"
	);
});
