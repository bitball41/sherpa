export const RewriteType = {
	Insert: 0,
	Replace: 1,
} as const;

export type RewriteType = (typeof RewriteType)[keyof typeof RewriteType];

export type Rewrite = {
	start: number;
} & (
	| {
			type: (typeof RewriteType)["Insert"];
			size: number;
	  }
	| {
			type: (typeof RewriteType)["Replace"];
			end: number;
			str: string;
	  }
);

export type SourceMaps = Record<string, Rewrite[]>;

/** Decode the compact binary rewrite map emitted by the Rust rewriter. */
export function decodeRewrites(buf: ArrayLike<number>): Rewrite[] {
	const sourcemap = Uint8Array.from(buf);
	const view = new DataView(sourcemap.buffer);
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let cursor = 0;

	const ensure = (size: number) => {
		if (cursor + size > sourcemap.byteLength) {
			throw new RangeError("truncated Sherpa source map");
		}
	};
	const readUint32 = () => {
		ensure(4);
		const value = view.getUint32(cursor, true);
		cursor += 4;

		return value;
	};

	const rewriteCount = readUint32();
	const rewrites: Rewrite[] = [];
	for (let index = 0; index < rewriteCount; index++) {
		const start = readUint32();
		const size = readUint32();
		ensure(1);
		const type = view.getUint8(cursor++) as RewriteType;

		if (type === RewriteType.Insert) {
			rewrites.push({ type, start, size });
			continue;
		}
		if (type !== RewriteType.Replace) {
			throw new TypeError(`unknown Sherpa source-map rewrite type ${type}`);
		}

		const oldLength = readUint32();
		ensure(oldLength);
		const oldString = decoder.decode(
			sourcemap.subarray(cursor, cursor + oldLength)
		);
		cursor += oldLength;
		rewrites.push({
			type,
			start,
			end: start + size,
			str: oldString,
		});
	}

	return rewrites;
}
