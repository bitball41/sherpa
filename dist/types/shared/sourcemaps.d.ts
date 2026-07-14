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
/** Decode the compact binary rewrite map emitted by the Rust rewriter. */
export declare function decodeRewrites(buf: ArrayLike<number>): Rewrite[];
