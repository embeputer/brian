import * as bundledBrianAgentCore from "@brian-agent/agent";
import * as bundledBrianAiCompat from "@brian-agent/ai/compat";
import * as bundledBrianAiOauth from "@brian-agent/ai/oauth";
import * as bundledBrianAiProviders from "@brian-agent/ai/providers/all";
import * as bundledTypebox from "typebox";
import * as bundledTypeboxCompile from "typebox/compile";
import * as bundledTypeboxValue from "typebox/value";
// This import is safe because loader.ts exports are not re-exported from index.ts.
// Extensions can therefore import from @brian-agent/cli.
import * as bundledBrianCodingAgent from "../../index.ts";

/** Modules available to extensions in source and compiled binary runtimes. */
export const VIRTUAL_MODULES: Record<string, unknown> = {
	typebox: bundledTypebox,
	"typebox/compile": bundledTypeboxCompile,
	"typebox/value": bundledTypeboxValue,
	"@sinclair/typebox": bundledTypebox,
	"@sinclair/typebox/compile": bundledTypeboxCompile,
	"@sinclair/typebox/value": bundledTypeboxValue,
	"@brian-agent/agent": bundledBrianAgentCore,
	// Extensions resolve the brian-ai root to the compat entrypoint (a strict
	// superset of the core entrypoint): existing extensions using the old
	// global API keep working at runtime until compat is removed.
	"@brian-agent/ai": bundledBrianAiCompat,
	"@brian-agent/ai/compat": bundledBrianAiCompat,
	"@brian-agent/ai/oauth": bundledBrianAiOauth,
	"@brian-agent/ai/providers/all": bundledBrianAiProviders,
	"@brian-agent/cli": bundledBrianCodingAgent,
	"@mariozechner/pi-agent-core": bundledBrianAgentCore,
	"@mariozechner/pi-ai": bundledBrianAiCompat,
	"@mariozechner/pi-ai/compat": bundledBrianAiCompat,
	"@mariozechner/pi-ai/oauth": bundledBrianAiOauth,
	"@mariozechner/pi-ai/providers/all": bundledBrianAiProviders,
	"@mariozechner/pi-coding-agent": bundledBrianCodingAgent,
};
