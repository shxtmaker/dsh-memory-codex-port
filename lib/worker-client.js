// src/storage/worker-client.ts
import { Worker } from "node:worker_threads";
var StorageWorker = class {
  worker;
  seq = 0;
  pending = /* @__PURE__ */ new Map();
  stopped = false;
  cancelledReservations = /* @__PURE__ */ new Set();
  ready;
  constructor(root, owner, trust, profile) {
    this.worker = new Worker(new URL("./storage-worker.js", import.meta.url), { workerData: { root, owner, trust, profile }, execArgv: [] });
    this.worker.on("message", (m) => {
      const pending = this.pending.get(m.id);
      if (this.cancelledReservations.delete(m.id) && m.value && typeof m.value === "object" && "id" in m.value) void this.call("releaseEvidence", { id: m.value.id }).catch(() => {
      });
      if (!pending) return;
      this.pending.delete(m.id);
      if (m.error) pending.reject(new Error(m.error));
      else pending.resolve(m.value);
    });
    this.worker.on("error", () => this.fail("STORAGE_UNAVAILABLE"));
    this.worker.on("exit", () => this.fail("STORAGE_STOPPED"));
    this.ready = this.call("probe", {});
  }
  call(op, args, signal) {
    if (this.stopped) return Promise.reject(new Error("STORAGE_STOPPED"));
    if (signal?.aborted) return Promise.reject(new Error("CANCELLED"));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        if (op === "reserveEvidence") this.cancelledReservations.add(id);
        this.worker.postMessage({ cancel: id });
        reject(new Error("CANCELLED"));
      };
      this.pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener("abort", abort);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", abort);
          reject(error);
        }
      });
      signal?.addEventListener("abort", abort, { once: true });
      this.worker.postMessage({ id, op, args });
    });
  }
  fail(code) {
    this.stopped = true;
    for (const p of this.pending.values()) p.reject(new Error(code));
    this.pending.clear();
    this.cancelledReservations.clear();
  }
  async close() {
    if (!this.stopped) {
      try {
        await this.call("close", {});
      } catch {
      }
    }
    this.fail("STORAGE_STOPPED");
    await this.worker.terminate();
  }
};
export {
  StorageWorker
};
//# sourceMappingURL=worker-client.js.map
