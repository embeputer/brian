import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { installA2a, isBrianA2aEnabled } from "./a2a.ts";
import { startBrianA2aListener, stopBrianA2aListener } from "./a2a-listen.ts";
import { installPlanGate } from "./plan-gate.ts";
import { installRoutines } from "./routines-tool.ts";
import { getTodoStore } from "./todo-store.ts";
import { installTodos } from "./todos.ts";

export default function brianExtension(brian: ExtensionAPI): void {
	installTodos(brian, getTodoStore());
	installPlanGate(brian);
	installRoutines(brian);
	installA2a(brian);
	if (isBrianA2aEnabled()) {
		void startBrianA2aListener();
		brian.on("session_shutdown", () => {
			void stopBrianA2aListener();
		});
	}
}
