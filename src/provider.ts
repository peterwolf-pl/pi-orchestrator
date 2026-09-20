/**
 * Orchestrator Provider Registration.
 * Registers "orchestrator" as a selectable model provider in Pi,
 * proxying through the installed pi-antigravity stream function.
 *
 * Usage:
 *   pi --model orchestrator/multi-agent
 *   pi --model orchestrator/secure-coding
 */

import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMasterCredentials } from "./quota.ts";
import type { OrchestratorConfig } from "./types.ts";

const ANTIGRAVITY_PKG_PATH = path.join(os.homedir(), ".pi", "agent", "npm", "node_modules", "pi-antigravity");

async function loadAntigravityStream(): Promise<{
	streamFn: (...args: any[]) => any;
	apiType: string;
} | null> {
	try {
		// Dynamic import of pi-antigravity's stream module
		const streamMod = await import(`${ANTIGRAVITY_PKG_PATH}/src/stream/stream.ts`);
		const typesMod = await import(`${ANTIGRAVITY_PKG_PATH}/src/types/types.ts`);
		return {
			streamFn: streamMod.streamAntigravity,
			apiType: typesMod.ANTIGRAVITY_API || "antigravity-api",
		};
	} catch {
		// Fallback: try .js extension
		try {
			const streamMod = await import(`${ANTIGRAVITY_PKG_PATH}/src/stream/stream.js`);
			const typesMod = await import(`${ANTIGRAVITY_PKG_PATH}/src/types/types.js`);
			return {
				streamFn: streamMod.streamAntigravity,
				apiType: typesMod.ANTIGRAVITY_API || "antigravity-api",
			};
		} catch {
			return null;
		}
	}
}

export async function registerOrchestratorProvider(pi: ExtensionAPI, config: OrchestratorConfig): Promise<boolean> {
	const loaded = await loadAntigravityStream();
	if (!loaded) {
		// pi-antigravity not installed; skip provider registration
		return false;
	}

	const { streamFn, apiType } = loaded;
	const masterApiKey = getMasterCredentials(config.masterAccount);

	pi.registerProvider("orchestrator", {
		name: "Multi-Agent Orchestrator",
		baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
		apiKey: masterApiKey,
		api: apiType as any,
		streamSimple: streamFn,
		models: [
			{
				id: "multi-agent",
				name: "Orchestrator: Multi-Agent Swarm (Antigravity Master + Workers)",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1000000,
				maxTokens: 65536,
			},
			{
				id: "secure-coding",
				name: "Orchestrator: Secure Coding Swarm (with xAI Grok Auditor)",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1000000,
				maxTokens: 65536,
			},
			{
				id: "gemini-3.8-flash",
				name: "Gemini 3.8 Flash (Multi-Agent Master)",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1000000,
				maxTokens: 65536,
			},
			{
				id: "claude-opus-4-6",
				name: "Claude Opus 4.6 (Multi-Agent Master)",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 250000,
				maxTokens: 64000,
			},
		],
	});

	return true;
}
