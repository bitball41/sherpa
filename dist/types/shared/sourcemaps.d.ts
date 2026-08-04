export declare const RewriteType: {
    readonly Insert: 0;
    readonly Replace: 1;
};
export type RewriteType = (typeof RewriteType)[keyof typeof RewriteType];
export type Rewrite = {
    start: number;
} & ({
    type: (typeof RewriteType)["Insert"];
    size: number;
} | {
    type: (typeof RewriteType)["Replace"];
    end: number;
    str: string;
});
export type SourceMaps = Record<string, Rewrite[]>;
/**
 * A map exactly as a rewritten script hands it over: base64 when the service
 * worker serialized it into the script text, the rewriter's own bytes when the
 * rewrite happened in this realm. (A plain number array is still accepted so
 * scripts rewritten by an older worker keep working.)
 */
export type RawSourceMap = string | Uint8Array | Array<number>;
/** Decode the compact binary rewrite map emitted by the Rust rewriter. */
export declare function decodeRewrites(buf: ArrayLike<number> | Uint8Array): Rewrite[];
