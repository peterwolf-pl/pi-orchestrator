/**
 * Configuration manager for Pi Multi-Agent AI Coding Orchestrator.
 * Supports multi-account setups (Antigravity 1/2/3, xAI, etc.), role assignments,
 * and Security Auditor configuration.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { getDiscoveredAccounts } from "./quota.ts";
import type { AccountConfig, OrchestratorConfig } from "./types.ts";

export const CONFIG_DIR_NAME = ".pi";

export function getDefaultConfig(): OrchestratorConfig {
	const accounts = getDiscoveredAccounts();

	// Default master is "antigravity" (or first found)
	const masterAccount = accounts.find((a) => a.id === "antigravity")?.id || accounts[0]?.id || "antigravity";

	// Default security auditor is "xai" (if present) or third account
	const securityAuditorAccount =
		accounts.find((a) => a.id === "xai")?.id || accounts.find((a) => a.id === "google-antigravity-3")?.id || "xai";

	// Active workers are all other accounts except master
	const activeWorkers = accounts.map((a) => a.id).filter((id) => id !== masterAccount);

	const accountsMap: Record<string, AccountConfig> = {};
	for (const a of accounts) {
		const isMaster = a.id === masterAccount;
		const isAuditor = a.id === securityAuditorAccount;
		accountsMap[a.id] = {
			id: a.id,
			provider: a.provider,
			label: a.label,
			enabled: true,
			role: isMaster ? "master" : isAuditor ? "security_auditor" : "worker",
		};
	}

	return {
		masterAccount,
		securityAuditorAccount,
		securityAuditorEnabled: true,
		activeWorkers,
		accounts: accountsMap,
		models: {
			master: {
				model: "gemini-3.8-flash",
				thinking: "high",
			},
			worker: {
				model: "gemini-3.8-flash",
				thinking: "low",
			},
			auditor: {
				model: "grok-beta",
				thinking: "off",
			},
		},
		idleWork: {
			autoIdleWork: true,
			extractSkills: true,
			generateDocs: true,
			assistSecurityAudit: true,
		},
		delegation: {
			enabled: true,
			automatic: true,
			max_workers: 4,
			default_timeout_ms: 300000, // 5 minutes
		},
		workspace: {
			isolated_workers: true,
		},
		review: {
			automatic_merge: false,
			require_security_approval: true,
		},
	};
}

export function getOrchestratorConfigPath(cwd: string = process.cwd()): string | undefined {
	const candidates = [
		join(cwd, CONFIG_DIR_NAME, "orchestrator.yaml"),
		join(cwd, CONFIG_DIR_NAME, "orchestrator.yml"),
		join(cwd, CONFIG_DIR_NAME, "orchestrator.json"),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

export function loadOrchestratorConfig(cwd: string = process.cwd()): OrchestratorConfig {
	const defaultConfig = getDefaultConfig();
	const configPath = getOrchestratorConfigPath(cwd);
	if (!configPath) {
		return defaultConfig;
	}

	try {
		const raw = readFileSync(configPath, "utf-8");
		let parsed: any;
		if (configPath.endsWith(".yaml") || configPath.endsWith(".yml")) {
			parsed = YAML.parse(raw);
		} else {
			parsed = JSON.parse(raw);
		}

		return {
			masterAccount: parsed?.masterAccount || parsed?.agents?.master || defaultConfig.masterAccount,
			securityAuditorAccount: parsed?.securityAuditorAccount || defaultConfig.securityAuditorAccount,
			securityAuditorEnabled:
				parsed?.securityAuditorEnabled !== undefined
					? Boolean(parsed.securityAuditorEnabled)
					: defaultConfig.securityAuditorEnabled,
			activeWorkers: Array.isArray(parsed?.activeWorkers) ? parsed.activeWorkers : defaultConfig.activeWorkers,
			accounts: parsed?.accounts || defaultConfig.accounts,
			models: {
				master: {
					model: parsed?.models?.master?.model || defaultConfig.models.master.model,
					thinking: parsed?.models?.master?.thinking || defaultConfig.models.master.thinking,
				},
				worker: {
					model: parsed?.models?.worker?.model || defaultConfig.models.worker.model,
					thinking: parsed?.models?.worker?.thinking || defaultConfig.models.worker.thinking,
				},
				auditor: {
					model: parsed?.models?.auditor?.model || defaultConfig.models.auditor.model,
					thinking: parsed?.models?.auditor?.thinking || defaultConfig.models.auditor.thinking,
				},
			},
			idleWork: {
				autoIdleWork: parsed?.idleWork?.autoIdleWork ?? defaultConfig.idleWork.autoIdleWork,
				extractSkills: parsed?.idleWork?.extractSkills ?? defaultConfig.idleWork.extractSkills,
				generateDocs: parsed?.idleWork?.generateDocs ?? defaultConfig.idleWork.generateDocs,
				assistSecurityAudit: parsed?.idleWork?.assistSecurityAudit ?? defaultConfig.idleWork.assistSecurityAudit,
			},
			delegation: {
				enabled: parsed?.delegation?.enabled ?? defaultConfig.delegation.enabled,
				automatic: parsed?.delegation?.automatic ?? defaultConfig.delegation.automatic,
				max_workers: parsed?.delegation?.max_workers ?? defaultConfig.delegation.max_workers,
				default_timeout_ms: parsed?.delegation?.default_timeout_ms ?? defaultConfig.delegation.default_timeout_ms,
			},
			workspace: {
				isolated_workers: parsed?.workspace?.isolated_workers ?? defaultConfig.workspace.isolated_workers,
				worktree_dir: parsed?.workspace?.worktree_dir,
			},
			review: {
				automatic_merge: parsed?.review?.automatic_merge ?? defaultConfig.review.automatic_merge,
				require_security_approval:
					parsed?.review?.require_security_approval ?? defaultConfig.review.require_security_approval,
			},
		};
	} catch {
		return defaultConfig;
	}
}

export function saveOrchestratorConfig(config: OrchestratorConfig, cwd: string = process.cwd()): void {
	const configDir = join(cwd, CONFIG_DIR_NAME);
	if (!existsSync(configDir)) {
		mkdirSync(configDir, { recursive: true });
	}
	const configPath = join(configDir, "orchestrator.yaml");
	const yaml = YAML.stringify(config, { indent: 2 });
	writeFileSync(configPath, yaml, "utf-8");
}
