import { config, flagEnabled } from "@/shared";
import { ProxyCtx, SherpaClient } from "@client/index";
import {
	decodeRewrites,
	Rewrite,
	RewriteType,
	SourceMaps,
} from "@/shared/sourcemaps";

export type { SourceMaps };

function getEnd(rewrite: Rewrite): number {
	if (rewrite.type === RewriteType.Insert) {
		return rewrite.start + rewrite.size;
	} else if (rewrite.type === RewriteType.Replace) {
		return rewrite.end;
	}
	throw "unreachable";
}

function registerRewrites(
	client: SherpaClient,
	buf: Array<number>,
	tag: string
) {
	client.box.sourcemaps[tag] = decodeRewrites(buf);
}

const SCRAMTAG = "/*scramtag ";

function extractTag(fn: string): [string, number, number] | null {
	// every function rewritten will have a scramtag comment
	// it will look like this:
	// function name()[possible whitespace]/*scramtag [index] [tag]*/[possible whitespace]{ ... }

	const start = fn.indexOf(SCRAMTAG);
	// no scramtag, probably native function or stolen from sherpa
	if (start === -1) return null;

	const end = fn.indexOf("*/", start);
	if (end === -1) {
		console.log(fn, start, end);
		throw new Error("unreachable");
	}

	const tag = fn.substring(start + 2, end).split(" ");

	if (
		tag.length !== 3 ||
		tag[0] !== "scramtag" ||
		!Number.isSafeInteger(+tag[1])
	) {
		console.log(fn, start, end, tag);
		throw new Error("invalid tag");
	}

	return [tag[2], start, +tag[1]];
}

function doUnrewrite(client: SherpaClient, ctx: ProxyCtx) {
	const stringified: string = ctx.fn.call(ctx.this);

	const extracted = extractTag(stringified);
	if (!extracted) return ctx.return(stringified);
	const [tag, tagOffset, tagStart] = extracted;

	const fnStart = tagStart - tagOffset;
	const fnEnd = fnStart + stringified.length;
	const rewrites = client.box.sourcemaps[tag];

	if (!rewrites) {
		console.warn("failed to get rewrites for tag", tag);

		return ctx.return(stringified);
	}

	let i = 0;
	// skip all rewrites in the file before the fn
	while (i < rewrites.length) {
		if (rewrites[i].start < fnStart) i++;
		else break;
	}

	let end = i;
	while (end < rewrites.length) {
		if (getEnd(rewrites[end]) <= fnEnd) end++;
		else break;
	}
	const fnrewrites = rewrites.slice(i, end);

	let newString = "";
	let lastpos = 0;

	for (const rewrite of fnrewrites) {
		newString += stringified.slice(lastpos, rewrite.start - fnStart);

		if (rewrite.type === RewriteType.Insert) {
			lastpos = rewrite.start + rewrite.size - fnStart;
		} else if (rewrite.type === RewriteType.Replace) {
			newString += rewrite.str;
			lastpos = rewrite.end - fnStart;
		} else {
			throw "unreachable";
		}
	}

	newString += stringified.slice(lastpos);
	newString = newString.replace(`${SCRAMTAG}${tagStart} ${tag}*/`, "");

	return ctx.return(newString);
}

export const enabled = (client: SherpaClient) =>
	flagEnabled("sourcemaps", client.url);

export default function (client: SherpaClient, self: Self) {
	// every script will push a sourcemap
	Object.defineProperty(self, config.globals.pushsourcemapfn, {
		value: (buf: Array<number>, tag: string) => {
			const before = performance.now();
			registerRewrites(client, buf, tag);
			dbg.time(client.meta, before, `scramtag parse for ${tag}`);
		},
		enumerable: false,
		writable: false,
		configurable: false,
	});

	// when we rewrite javascript it will make function.toString leak internals
	// this can lead to double rewrites which is bad
	client.Proxy("Function.prototype.toString", {
		apply(ctx) {
			doUnrewrite(client, ctx);
		},
	});
}
