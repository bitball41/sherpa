import { SherpaClient } from "./index";
export declare class SherpaServiceWorkerRuntime {
    client: SherpaClient;
    recvport: MessagePort;
    constructor(client: SherpaClient);
    hook(): void;
}
export type TransferrableResponse = {
    body: ReadableStream | null;
    headers: [string, string][];
    status: number;
    statusText: string;
};
export type TransferrableResponseError = {
    error: string;
};
export type TransferrableRequest = {
    body: ReadableStream | null;
    headers: [string, string][];
    destination: RequestDestination;
    method: Request["method"];
    mode: Request["mode"];
    credentials: RequestCredentials;
    cache: RequestCache;
    redirect: RequestRedirect;
    referrer: string;
    referrerPolicy: ReferrerPolicy;
    integrity: string;
    keepalive: boolean;
    url: string;
};
type FetchResponseMessage = {
    sherpa$type: "fetch";
    sherpa$response: TransferrableResponse | TransferrableResponseError | false;
};
type FetchRequestMessage = {
    sherpa$type: "fetch";
    sherpa$request: TransferrableRequest;
};
type RuntimeMessage = {
    sherpa$type: "message";
    sherpa$data: unknown;
};
type MessageTypeR2W = FetchResponseMessage;
type MessageTypeW2R = FetchRequestMessage;
type MessageCommon = {
    sherpa$type: string;
    sherpa$token: number;
};
export type MessageR2W = MessageCommon & MessageTypeR2W;
export type MessageW2R = (MessageCommon & MessageTypeW2R & {
    sherpa$port?: MessagePort;
}) | RuntimeMessage;
export {};
