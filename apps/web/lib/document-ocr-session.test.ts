import { afterEach, expect, it, vi } from "vitest";
import { createDocumentOcrSession } from "./document-ocr-session";
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | undefined;
  onerror: (() => void) | undefined;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
}
const canvas = {
  toBlob: (cb: (b: Blob) => void) => cb(new Blob(["fixture"])),
} as HTMLCanvasElement;
afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});
it("aborts initialization immediately and terminates the owning worker", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const abort = new AbortController();
  const session = createDocumentOcrSession(abort.signal, vi.fn()),
    result = session.recognize(canvas);
  await new Promise((resolve) => setTimeout(resolve, 0));
  abort.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(FakeWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
});
it("reuses one worker across pages and cancellation during recognition rejects", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const abort = new AbortController();
  const session = createDocumentOcrSession(abort.signal, vi.fn()),
    first = session.recognize(canvas);
  await new Promise((resolve) => setTimeout(resolve, 0));
  FakeWorker.instances[0]?.onmessage?.({
    data: { kind: "result", id: 1, text: "Fictitious", confidence: 95 },
  } as MessageEvent<unknown>);
  expect((await first).text).toBe("Fictitious");
  const second = session.recognize(canvas);
  await new Promise((resolve) => setTimeout(resolve, 0));
  abort.abort();
  await expect(second).rejects.toMatchObject({ name: "AbortError" });
  expect(FakeWorker.instances).toHaveLength(1);
});
it("preserves a worker error while canvas encoding is still pending", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  let encoded: ((value: Blob) => void) | undefined;
  const session = createDocumentOcrSession(
    new AbortController().signal,
    vi.fn(),
  );
  const result = session.recognize({
    toBlob: (callback: (value: Blob) => void) => {
      encoded = callback;
    },
  } as HTMLCanvasElement);
  FakeWorker.instances[0]?.onerror?.();
  encoded?.(new Blob(["fixture"]));
  await expect(result).rejects.toThrow(/cargarlo manualmente/);
  expect(FakeWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
});
