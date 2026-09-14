import { AsyncLocalStorage } from "node:async_hooks";
import type { UntrustedBlock } from "./prompt";
const context = new AsyncLocalStorage<UntrustedBlock[]>();
export function withSourceContext<T>(blocks: UntrustedBlock[], work: () => T): T { return context.run(blocks, work); }
export function sourceContext() { return context.getStore() ?? []; }
