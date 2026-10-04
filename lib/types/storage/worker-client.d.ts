/** 所有数据库操作在专用 Worker 串行执行。停止时拒绝尚未完成的请求。 */
export declare class StorageWorker {
    private worker;
    private seq;
    private pending;
    private stopped;
    private cancelledReservations;
    readonly ready: Promise<unknown>;
    constructor(root: string, owner: string, trust: string, profile: string);
    call<T = unknown>(op: string, args: object, signal?: AbortSignal): Promise<T>;
    private fail;
    close(): Promise<void>;
}
