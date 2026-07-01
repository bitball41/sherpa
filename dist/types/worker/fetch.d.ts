import { BareResponseFetch } from "@mercuryworkshop/bare-mux";
import { SherpaServiceWorker } from "./";
export declare function handleFetch(this: SherpaServiceWorker, request: Request, client: Client | null): Promise<Response>;
type BodyType = string | ArrayBuffer | Blob | ReadableStream<any>;
export declare class SherpaHandleResponseEvent extends Event {
    responseBody: BodyType;
    responseHeaders: Record<string, string>;
    status: number;
    statusText: string;
    destination: string;
    url: URL;
    rawResponse: BareResponseFetch;
    client: Client;
    constructor(responseBody: BodyType, responseHeaders: Record<string, string>, status: number, statusText: string, destination: string, url: URL, rawResponse: BareResponseFetch, client: Client);
}
export declare class SherpaRequestEvent extends Event {
    url: URL;
    requestHeaders: Record<string, string>;
    body: BodyType;
    method: string;
    destination: string;
    client: Client;
    constructor(url: URL, requestHeaders: Record<string, string>, body: BodyType, method: string, destination: string, client: Client);
    response?: BareResponseFetch | Promise<BareResponseFetch>;
}
export {};
