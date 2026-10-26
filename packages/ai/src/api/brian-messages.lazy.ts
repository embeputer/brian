import type { ProviderStreams } from "../types.ts";
import { lazyApi } from "./lazy.ts";

export const brianMessagesApi = (): ProviderStreams => lazyApi(() => import("./brian-messages.ts"));
