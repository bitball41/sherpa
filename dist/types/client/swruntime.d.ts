import { SherpaClient } from "./index";
export declare class SherpaServiceWorkerRuntime {
    client: SherpaClient;
    recvport: MessagePort;
    constructor(client: SherpaClient);
    hook(): void;
}
export type TransferrableResponse = {
    body: ReadableStream;
    headers: [string, string][];
    status: number;
    statusText: string;
};
export type TransferrableRequest = {
    body: ReadableStream;
    headers: [string, string][];
    destinitation: RequestDestination;
    method: Request["method"];
    mode: Request["mode"];
    url: string;
};
type FetchResponseMessage = {
    sherpa$type: "fetch";
    sherpa$response: TransferrableResponse;
};
type FetchRequestMessage = {
    sherpa$type: "fetch";
    sherpa$request: TransferrableRequest;
};
type MessageTypeR2W = FetchResponseMessage;
type MessageTypeW2R = FetchRequestMessage;
type MessageCommon = {
    sherpa$type: string;
    sherpa$token: number;
};
export type MessageR2W = MessageCommon & MessageTypeR2W;
export type MessageW2R = MessageCommon & MessageTypeW2R & {
    sherpa$port?: MessagePort;
};
export {};
