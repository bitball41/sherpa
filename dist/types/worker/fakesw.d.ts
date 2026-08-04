import type { MessageR2W } from "../client/swruntime";
type PendingResponse = {
    resolve: (value: MessageR2W | null) => void;
    timeout: ReturnType<typeof setTimeout>;
};
export declare class FakeServiceWorker {
    syncToken: number;
    promises: Map<number, PendingResponse>;
    messageChannel: MessageChannel;
    connected: boolean;
    disposed: boolean;
    handle: MessagePort;
    origin: string;
    scope: string;
    responseTimeoutMs: number;
    constructor(handle: MessagePort, origin: string, scope: string, responseTimeoutMs?: number);
    handleMessage(data: MessageR2W): void;
    dispose(): void;
    postMessage(data: unknown, transfer?: Transferable[]): boolean;
    fetch(request: Request): Promise<Response | false>;
}
/** Replaces an existing registration for the same virtual origin and scope. */
export declare function replaceFakeServiceWorker(workers: FakeServiceWorker[], next: FakeServiceWorker): void;
/** Removes and disposes one exact virtual-origin registration. */
export declare function removeFakeServiceWorker(workers: FakeServiceWorker[], origin: string, scope: string): boolean;
export {};
