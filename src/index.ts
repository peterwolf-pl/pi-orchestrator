/**
 * Pi Multi-Agent AI Coding Orchestrator.
 * Extension entrypoint for Pi Coding Agent.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getOrchestrator } from "./cli.ts";
import { renderDashboard } from "./dashboard.ts";
import { registerOrchestratorProvider } from "./provider.ts";
import { fetchAllAccountLimits } from "./quota.ts";
import { registerOrchestratorTools } from "./tools.ts";

export * from "./agent.ts";
export * from "./cli.ts";
export * from "./config.ts";
export * from "./dashboard.ts";
export * from "./file-ownership.ts";
export * from "./logger.ts";
export * from "./master-agent.ts";
export * from "./orchestrator.ts";
export * from "./provider.ts";
export * from "./quota.ts";
export * from "./security-auditor.ts";
export * from "./tools.ts";
export * from "./tui-dashboard.ts";
export * from "./types.ts";
export * from "./worker-agent.ts";
export * from "./workspace.ts";

export default async function orchestratorExtension(pi: ExtensionAPI): Promise<void> {
	const orchestrator = getOrchestrator(process.cwd());

	// 1. Register tools for Master Agent (Antigravity)
	const tools = registerOrchestratorTools(orchestrator);
	for (const tool of tools) {
		pi.registerTool(tool);
	}

	// 2. Register Orchestrator as a selectable model provider in Pi
	//    (pi --model orchestrator/multi-agent)
	await registerOrchestratorProvider(pi, orchestrator.config);

	// 3. UI Status Line & Persistent Banner (Visible in every interactive session)
	const updateUiIndicators = (ui: any) => {
		if (!ui) return;
		const activeWorkers = orchestrator.getActiveWorkers();
		const auditorName = orchestrator.securityAuditor.getAuditorAccount();
		const auditorEnabled = orchestrator.securityAuditor.isEnabled();
		const theme = ui.theme;

		ui.setStatus(
			"orchestrator",
			theme.fg("accent", "⚡ Orchestrator ") +
				theme.fg("dim", `[${activeWorkers.length}w | ${auditorEnabled ? auditorName : "no-sec"}]`),
		);

		ui.setWidget(
			"orchestrator-banner",
			[
				theme.fg("accent", "⚡ Pi Multi-Agent Orchestrator: ") +
					theme.fg("success", "Active") +
					theme.fg(
						"dim",
						` (Master: ${orchestrator.config.masterAccount} | Workers: ${activeWorkers.length} | Auditor: ${auditorEnabled ? auditorName : "off"})`,
					),
			],
			{ placement: "aboveEditor" },
		);
	};

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		updateUiIndicators(ctx.ui);

		// Custom Footer: Displays Pi.ORCHESTRATOR [M: high | W: low] in the bottom right corner!
		ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
			const unsub = footerData?.onBranchChange?.(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					let input = 0,
						output = 0,
						cost = 0;
					try {
						for (const e of ctx.sessionManager.getBranch()) {
							if (e.type === "message" && (e.message as any)?.role === "assistant") {
								const m = e.message as any;
								if (m.usage) {
									input += m.usage.input || 0;
									output += m.usage.output || 0;
									cost += m.usage.cost?.total || 0;
								}
							}
						}
					} catch {
						// ignore
					}

					const branch = footerData?.getGitBranch?.() || "";
					const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

					const left = theme.fg("dim", `↑${fmt(input)} ↓${fmt(output)} $${cost.toFixed(3)}`);
					const branchStr = branch ? ` (${branch})` : "";

					// RIGHT SIDE: Display Pi.ORCHESTRATOR with thinking levels instead of single model!
					const masterCfg = orchestrator.config.models?.master || {
						model: "gemini-3.8-flash",
						thinking: "high",
					};
					const workerCfg = orchestrator.config.models?.worker || {
						model: "gemini-3.8-flash",
						thinking: "low",
					};

					const right =
						theme.fg("accent", theme.bold("Pi.ORCHESTRATOR")) +
						theme.fg("dim", ` [M:${masterCfg.thinking} | W:${workerCfg.thinking}]${branchStr}`);

					const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
					return [truncateToWidth(left + pad + right, width)];
				},
			};
		});

		const activeWorkers = orchestrator.getActiveWorkers();
		const auditorName = orchestrator.securityAuditor.getAuditorAccount();
		const auditorEnabled = orchestrator.securityAuditor.isEnabled();
		ctx.ui.notify(
			`⚡ Pi Multi-Agent Orchestrator is active!\nMaster: ${orchestrator.config.masterAccount} │ Workers: ${activeWorkers.length} │ Security Auditor: ${auditorEnabled ? auditorName : "off"}\nUse /status or run 'pi-orchestrator' in terminal for live dashboard.`,
			"info",
		);
	});

	pi.on("turn_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		updateUiIndicators(ctx.ui);
	});

	pi.on("tool_execution_start", async (event, ctx) => {
		if (!ctx.hasUI) return;
		if (event.toolName === "delegate_task") {
			ctx.ui.setStatus("orchestrator", ctx.ui.theme.fg("warning", "⚡ [Worker Executing in Git Worktree...]"));
			ctx.ui.setWorkingMessage("Worker executing isolated subtask in Git worktree...");
		} else if (event.toolName === "run_security_audit") {
			ctx.ui.setStatus("orchestrator", ctx.ui.theme.fg("warning", "🛡️ [Security Auditor Scanning Diff...]"));
		}
	});

	pi.on("tool_execution_end", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		updateUiIndicators(ctx.ui);
	});

	// 4. Register slash commands
	pi.registerCommand("task", {
		description: "Set main coding objective for Master Agent",
		handler: async (args, ctx) => {
			const title = args.trim();
			if (!title) {
				ctx.ui.notify("Usage: /task <title>", "error");
				return;
			}
			orchestrator.setMainTask(title);
			const status = await orchestrator.getStatus(false);
			const rendered = renderDashboard(status);
			ctx.ui.notify(`Main task set: "${title}"\n\n${rendered}`, "info");
		},
	});

	pi.registerCommand("status", {
		description: "Show multi-agent orchestrator dashboard and account quotas",
		handler: async (_args, ctx) => {
			const status = await orchestrator.getStatus(false);
			const rendered = renderDashboard(status);
			ctx.ui.notify(rendered, "info");
		},
	});

	pi.registerCommand("quotas", {
		description: "Show 5-hour and weekly limits and reset countdowns for all accounts",
		handler: async (_args, ctx) => {
			const limits = await fetchAllAccountLimits(true);
			let msg = `Real-Time Quotas & Limits:\n`;
			for (const acc of limits) {
				const label = acc.label ? ` (${acc.label})` : "";
				if (acc.provider === "xai") {
					msg += `  ${acc.accountId}${label} [xAI Grok]: Status: ${acc.status}, Reset: ${acc.fiveHourReset || "ready"}\n`;
				} else {
					msg += `  ${acc.accountId}${label} [Antigravity]: 5H: ${acc.fiveHourRemaining ?? "--"}% (reset: ${acc.fiveHourReset || "ready"}), WK: ${acc.weeklyRemaining ?? "--"}% (reset: ${acc.weeklyReset || "ready"})\n`;
				}
			}
			ctx.ui.notify(msg, "info");
		},
	});

	pi.registerCommand("security", {
		description: "Toggle security auditor or assign account (/security on | off | <account>)",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on" || arg === "enable") {
				orchestrator.setSecurityAuditor(orchestrator.config.securityAuditorAccount, true);
				ctx.ui.notify(`Security Auditor ENABLED (Account: ${orchestrator.config.securityAuditorAccount})`, "info");
				return;
			}
			if (arg === "off" || arg === "disable") {
				orchestrator.setSecurityAuditor(orchestrator.config.securityAuditorAccount, false);
				ctx.ui.notify("Security Auditor DISABLED.", "info");
				return;
			}
			if (arg) {
				orchestrator.setSecurityAuditor(arg, true);
				ctx.ui.notify(`Security Auditor assigned to ${arg} and ENABLED.`, "info");
				return;
			}
			const st = orchestrator.securityAuditor.isEnabled() ? "ENABLED" : "DISABLED";
			ctx.ui.notify(
				`Security Auditor is currently ${st} (Auditor: ${orchestrator.securityAuditor.getAuditorAccount()})`,
				"info",
			);
		},
	});

	pi.registerCommand("master", {
		description: "Switch Master agent account (/master <account_id>)",
		handler: async (args, ctx) => {
			const acc = args.trim();
			if (!acc) {
				ctx.ui.notify(`Current Master: ${orchestrator.config.masterAccount}\nUsage: /master <account_id>`, "info");
				return;
			}
			orchestrator.setMasterAccount(acc);
			ctx.ui.notify(`Master account switched to: ${acc}`, "info");
		},
	});

	pi.registerCommand("agents", {
		description: "Show multi-agent orchestrator agents and roles",
		handler: async (_args, ctx) => {
			const status = await orchestrator.getStatus(false);
			let msg = `Pi Multi-Agent Pool:\n`;
			msg += `  MASTER   : ${status.master.name} [${status.master.status.toUpperCase()}]\n`;
			for (const w of status.workers) {
				msg += `  WORKER   : ${w.name} [${w.status.toUpperCase()}]\n`;
			}
			const sec = status.securityAuditEnabled ? "ENABLED" : "DISABLED";
			msg += `  AUDITOR  : ${status.securityAuditor?.name || "none"} [${sec}]\n`;
			ctx.ui.notify(msg, "info");
		},
	});

	pi.registerCommand("workers", {
		description: "List all tasks delegated to workers",
		handler: async (_args, ctx) => {
			const tasks = orchestrator.getTasks();
			if (tasks.length === 0) {
				ctx.ui.notify("No worker tasks assigned yet.", "info");
				return;
			}
			let msg = `Worker Tasks:\n`;
			for (const t of tasks) {
				const sec = t.securityAudit ? (t.securityAudit.passed ? " [SEC:PASS]" : " [SEC:FAIL]") : "";
				msg += `  [${t.task.task_id}] (${t.task.agent}) ${t.task.title} - ${t.status.toUpperCase()}${sec}\n`;
			}
			ctx.ui.notify(msg, "info");
		},
	});

	pi.registerCommand("delegate", {
		description: "Delegate a subtask to worker pool (/delegate <description>)",
		handler: async (args, ctx) => {
			const desc = args.trim();
			if (!desc) {
				ctx.ui.notify("Usage: /delegate <task description>", "error");
				return;
			}
			ctx.ui.notify(`Delegating task to worker pool: "${desc}"...`, "info");
			try {
				const result = await orchestrator.delegateTask({
					title: desc,
					description: desc,
				});
				ctx.ui.notify(`Worker finished [${result.task_id}]: ${result.summary}`, "info");
			} catch (err: any) {
				ctx.ui.notify(`Worker task failed: ${err.message}`, "error");
			}
		},
	});

	pi.registerCommand("diff", {
		description: "Show git diff produced by a worker (/diff <task_id>)",
		handler: async (args, ctx) => {
			const taskId = args.trim();
			if (!taskId) {
				ctx.ui.notify("Usage: /diff <task_id>", "error");
				return;
			}
			const record = orchestrator.getTask(taskId);
			if (!record) {
				ctx.ui.notify(`Task ${taskId} not found.`, "error");
				return;
			}
			const diff = record.diff || "";
			if (!diff.trim()) {
				ctx.ui.notify(`Task ${taskId} produced no git diff.`, "info");
			} else {
				ctx.ui.notify(`Diff for ${taskId}:\n\n${diff}`, "info");
			}
		},
	});

	pi.registerCommand("approve", {
		description: "Master approves worker diff and merges changes (/approve <task_id>)",
		handler: async (args, ctx) => {
			const taskId = args.trim();
			if (!taskId) {
				ctx.ui.notify("Usage: /approve <task_id>", "error");
				return;
			}
			const result = await orchestrator.approveTask(taskId);
			if (result.success) {
				ctx.ui.notify(`Task ${taskId} approved! Changes merged into codebase.`, "info");
			} else {
				ctx.ui.notify(`Approval rejected: ${result.message}`, "error");
			}
		},
	});

	pi.registerCommand("reject", {
		description: "Master rejects worker changes and removes workspace (/reject <task_id> [reason])",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const taskId = parts[0];
			const reason = parts.slice(1).join(" ") || "Rejected by Master";
			if (!taskId) {
				ctx.ui.notify("Usage: /reject <task_id> [reason]", "error");
				return;
			}
			const result = await orchestrator.rejectTask(taskId, reason);
			ctx.ui.notify(result.message, "info");
		},
	});
}
