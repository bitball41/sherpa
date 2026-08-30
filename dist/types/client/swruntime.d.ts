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
    scramjet$type: "fetch";
    scramjet$response: TransferrableResponse | TransferrableResponseError | false;
};
type FetchRequestMessage = {
    scramjet$type: "fetch";
    scramjet$request: TransferrableRequest;
};
type RuntimeMessage = {
    scramjet$type: "message";
    scramjet$data: unknown;
};
type MessageTypeR2W = FetchResponseMessage;
type MessageTypeW2R = FetchRequestMessage;
type MessageCommon = {
    scramjet$type: string;
    scramjet$token: number;
};
export type MessageR2W = MessageCommon & MessageTypeR2W;
export type MessageW2R = (MessageCommon & MessageTypeW2R & {
    scramjet$port?: MessagePort;
}) | RuntimeMessage;
export {};
