export declare class SherpaHeaders {
    headers: Record<string, string>;
    set(key: string, v: string): void;
    delete(key: string): void;
}
export type HeaderValue = string | string[];
export declare function flattenResponseHeaders(headers: Record<string, HeaderValue>): Record<string, string>;
