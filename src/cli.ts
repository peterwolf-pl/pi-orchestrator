/**
 * CLI command handlers for Pi Multi-Agent AI Coding Orchestrator.
 */

import chalk from "chalk";
import { renderDashboard } from "./dashboard.ts";
import { Orchestrator } from "./orchestrator.ts";
import { fetchAllAccountLimits } from "./quota.ts";
import { runInteractiveDashboard } from "./tui-dashboard.ts";

let orchestratorInstance: Orchestrator | null = null;

export function getOrchestrator(cwd: string = process.cwd()): Orchestrator {
	if (!orchestratorInstance || orchestratorInstance.cwd !== cwd) {
		orchestratorInstance = new Orchestrator(cwd);
	}
	return orchestratorInstance;
}

export async function handleOrchestratorCommand(
	args: string[],
	options?: { cwd?: string; agentDir?: string },
): Promise<boolean> {
	const cwd = options?.cwd || process.cwd();
	const orchestrator = getOrchestrator(cwd);

	if (args.length === 0) {
		// Default: launch interactive real-time dashboard!
		await runInteractiveDashboard(orchestrator);
		return true;
	}

	const cmd = args[0].toLowerCase();

	switch (cmd) {
		case "dashboard":
		case "tui": {
			await runInteractiveDashboard(orchestrator);
			return true;
		}

		case "task": {
			const taskTitle = args.slice(1).join(" ").trim();
			if (!taskTitle) {
				console.error(
					chalk.red('Error: Task title is required.\nUsage: pi-orchestrator task "<task description>"'),
				);
				process.exit(1);
			}

			orchestrator.setMainTask(taskTitle);
			console.log(chalk.green(`Main coding task set: "${taskTitle}"\n`));
			const status = await orchestrator.getStatus(false);
			console.log(renderDashboard(status));
			return true;
		}

		case "agents": {
			const status = await orchestrator.getStatus(false);
			console.log(chalk.bold("\nPi Configured Multi-Agent Pool:"));
			console.log(
				`  ${chalk.magenta.bold("MASTER")}   : ${chalk.bold(status.master.name)} [${status.master.status.toUpperCase()}]`,
			);
			for (const w of status.workers) {
				console.log(`  ${chalk.blue.bold("WORKER")}   : ${chalk.bold(w.name)} [${w.status.toUpperCase()}]`);
			}
			const secText = status.securityAuditEnabled ? "ENABLED" : "DISABLED";
			console.log(
				`  ${chalk.yellow.bold("AUDITOR")}  : ${chalk.bold(status.securityAuditor?.name || "none")} [${secText}]`,
			);
			console.log("");
			return true;
		}

		case "accounts":
		case "quotas":
		case "limits": {
			console.log(chalk.yellow("Fetching real-time quotas from Google Antigravity & xAI..."));
			const limits = await fetchAllAccountLimits(true);
			console.log(chalk.bold("\nReal-Time Accounts & Limits (5H / Weekly):"));
			for (const acc of limits) {
				const label = acc.label ? `(${acc.label})` : "";
				const idStr = `${acc.accountId} ${label}`.padEnd(28);
				const role =
					acc.accountId === orchestrator.config.masterAccount
						? chalk.magenta.bold("MASTER")
						: acc.accountId === orchestrator.config.securityAuditorAccount
							? chalk.yellow.bold("AUDITOR")
							: orchestrator.config.activeWorkers.includes(acc.accountId)
								? chalk.blue.bold("WORKER")
								: chalk.dim("IDLE");

				console.log(`\n  ${role} ${chalk.white.bold(idStr)} [${acc.provider.toUpperCase()}]`);
				if (acc.provider === "xai") {
					console.log(
						`     └─ OAuth Status: ${chalk.green(acc.status.toUpperCase())} │ Reset: ${acc.fiveHourReset || "ready"}`,
					);
				} else {
					console.log(
						`     └─ 5-Hour Limit: ${chalk.cyan(acc.fiveHourRemaining ?? "--")}% (Reset: ${acc.fiveHourReset || "ready"})`,
					);
					console.log(
						`     └─ Weekly Limit: ${chalk.cyan(acc.weeklyRemaining ?? "--")}% (Reset: ${acc.weeklyReset || "ready"})`,
					);
				}
			}
			console.log("");
			return true;
		}

		case "master": {
			const targetAccount = args[1]?.trim();
			if (!targetAccount) {
				console.log(`Current Master Account: ${chalk.magenta.bold(orchestrator.config.masterAccount)}`);
				console.log(`Usage: pi-orchestrator master <account_id>`);
				return true;
			}
			orchestrator.setAccountRole(targetAccount, "master");
			console.log(chalk.green(`Master account updated to: ${chalk.bold(targetAccount)}`));
			return true;
		}

		case "role": {
			const targetAcc = args[1]?.trim();
			const targetRole = args[2]?.toLowerCase()?.trim();
			if (!targetAcc || !targetRole) {
				console.log("Usage: pi-orchestrator role <account_id> <worker|auditor|master|idle>");
				return true;
			}
			const normalizedRole = targetRole === "auditor" ? "security_auditor" : (targetRole as any);
			orchestrator.setAccountRole(targetAcc, normalizedRole);
			console.log(
				chalk.green(`Account ${chalk.bold(targetAcc)} role updated to: ${chalk.cyan.bold(normalizedRole)}`),
			);
			return true;
		}

		case "model": {
			const role = args[1]?.toLowerCase() as "master" | "worker" | "auditor";
			const model = args[2];
			const thinking = args[3] as any;
			if (!role || !orchestrator.config.models?.[role]) {
				const m = orchestrator.config.models;
				console.log(chalk.bold("\nOrchestrator Models & Thinking:"));
				console.log(
					`  MASTER  : ${chalk.white.bold(m.master.model)} (thinking: ${chalk.yellow.bold(m.master.thinking)})`,
				);
				console.log(
					`  WORKER  : ${chalk.white.bold(m.worker.model)} (thinking: ${chalk.green.bold(m.worker.thinking)})`,
				);
				console.log(
					`  AUDITOR : ${chalk.white.bold(m.auditor.model)} (thinking: ${chalk.dim(m.auditor.thinking)})`,
				);
				console.log(`\nUsage: pi-orchestrator model <master|worker|auditor> <model_id> [thinking]`);
				return true;
			}
			orchestrator.setAgentModel(role, model || orchestrator.config.models[role].model, thinking);
			console.log(
				chalk.green(
					`Updated ${role} model to: ${orchestrator.config.models[role].model} (thinking: ${orchestrator.config.models[role].thinking})`,
				),
			);
			return true;
		}

		case "security": {
			const sub = args[1]?.toLowerCase();
			if (sub === "on" || sub === "enable") {
				orchestrator.setSecurityAuditor(orchestrator.config.securityAuditorAccount, true);
				console.log(
					chalk.green(`Security Auditor ENABLED (Auditor: ${orchestrator.config.securityAuditorAccount})`),
				);
				return true;
			}
			if (sub === "off" || sub === "disable") {
				orchestrator.setSecurityAuditor(orchestrator.config.securityAuditorAccount, false);
				console.log(chalk.red(`Security Auditor DISABLED.`));
				return true;
			}
			if (sub) {
				// Assign account
				orchestrator.setSecurityAuditor(sub, true);
				console.log(chalk.green(`Security Auditor assigned to: ${chalk.bold(sub)} and ENABLED.`));
				return true;
			}
			const st = orchestrator.securityAuditor.isEnabled() ? "ENABLED" : "DISABLED";
			console.log(
				`Security Auditor: ${chalk.bold(st)} (Account: ${chalk.bold(orchestrator.securityAuditor.getAuditorAccount())})`,
			);
			return true;
		}

		case "workers": {
			const tasks = orchestrator.getTasks();
			console.log(chalk.bold("\nPi Delegated Worker Tasks:"));
			if (tasks.length === 0) {
				console.log(chalk.dim("  No worker tasks recorded yet."));
			} else {
				for (const t of tasks) {
					const auditVerdict = t.securityAudit
						? t.securityAudit.passed
							? chalk.green(" [SEC:PASS]")
							: chalk.red(" [SEC:FAIL]")
						: "";
					console.log(
						`  ${chalk.bold(t.task.task_id)} | Agent: ${chalk.blue(t.task.agent)} | ${t.task.title} | Status: ${chalk.cyan(t.status.toUpperCase())}${auditVerdict}`,
					);
					if (t.result?.summary) {
						console.log(chalk.dim(`    Summary: ${t.result.summary}`));
					}
				}
			}
			console.log("");
			return true;
		}

		case "skills": {
			const sub = args[1]?.toLowerCase();
			if (sub === "extract") {
				const taskId = args[2];
				if (!taskId) {
					console.error(chalk.red("Error: taskId is required.\nUsage: pi-orchestrator skills extract <task_id>"));
					process.exit(1);
				}
				const skill = await orchestrator.extractSkillFromTask(taskId);
				console.log(chalk.green(`Skill extracted and written to: ${skill.filePath}`));
				return true;
			}
			const skills = orchestrator.skillManager.getSkills();
			console.log(chalk.bold("\nPi Auto-Generated Skills (.pi/skills/):"));
			if (skills.length === 0) {
				console.log(chalk.dim("  No auto-generated skills recorded yet."));
			} else {
				for (const s of skills) {
					console.log(`  - ${chalk.green.bold(s.skillName)}: ${s.title} (${chalk.dim(s.filePath)})`);
				}
			}
			console.log("");
			return true;
		}

		case "docs": {
			const res = await orchestrator.updateDocumentation();
			console.log(chalk.green(`Worker Knowledge Base documentation generated: ${res.filePath}`));
			return true;
		}

		case "idle": {
			const sub = args[1]?.toLowerCase();
			if (sub === "on" || sub === "enable") {
				orchestrator.setAutoIdleWork(true);
				console.log(chalk.green("Autonomous Idle Worker Tasks ENABLED (Skills & Docs extraction)."));
				return true;
			}
			if (sub === "off" || sub === "disable") {
				orchestrator.setAutoIdleWork(false);
				console.log(chalk.yellow("Autonomous Idle Worker Tasks DISABLED."));
				return true;
			}
			const current = orchestrator.config.idleWork?.autoIdleWork ?? true;
			console.log(`Autonomous Idle Worker Tasks: ${current ? chalk.green("ENABLED") : chalk.yellow("DISABLED")}`);
			return true;
		}

		case "delegate": {
			const description = args.slice(1).join(" ").trim();
			if (!description) {
				console.error(
					chalk.red(
						'Error: Delegation description is required.\nUsage: pi-orchestrator delegate "<subtask description>"',
					),
				);
				process.exit(1);
			}

			console.log(chalk.cyan(`Delegating subtask to worker pool: "${description}"...`));
			const res = await orchestrator.delegateTask({
				title: description,
				description,
			});

			console.log(chalk.green(`\nWorker Result for [${res.task_id}]:`));
			console.log(`  Status: ${res.status}`);
			console.log(`  Summary: ${res.summary}`);
			if (res.findings) {
				console.log(`  Findings: ${res.findings}`);
			}
			if (res.securityAudit) {
				console.log(
					`  Security Audit (${res.securityAudit.auditedBy}): ${res.securityAudit.passed ? chalk.green("PASSED") : chalk.red("FAILED")}`,
				);
			}
			return true;
		}

		case "status":
		case "worker": {
			if (args[1]?.toLowerCase() === "logs") {
				const taskId = args[2];
				const entries = orchestrator.logger.getRecentLogs({ taskId, limit: 20 });
				console.log(chalk.bold("\nPi Orchestrator Logs:"));
				if (entries.length === 0) {
					console.log(chalk.dim("  No log entries."));
				} else {
					for (const l of entries) {
						console.log(`  [${l.timestamp}] [${l.level}] [${l.component}] ${l.message}`);
					}
				}
				console.log("");
				return true;
			}

			const status = await orchestrator.getStatus(false);
			console.log(renderDashboard(status));
			return true;
		}

		case "diff": {
			const taskId = args[1]?.trim();
			if (!taskId) {
				console.error(chalk.red("Error: taskId is required.\nUsage: pi-orchestrator diff <task_id>"));
				process.exit(1);
			}

			const task = orchestrator.getTask(taskId);
			if (!task) {
				console.error(chalk.red(`Error: Task ${taskId} not found.`));
				process.exit(1);
			}

			const diff = task.diff || "";
			if (!diff.trim()) {
				console.log(chalk.dim(`No diff available for task ${taskId}.`));
			} else {
				console.log(chalk.bold(`\nDiff for ${taskId} (${task.task.title}):`));
				console.log(diff);
			}
			return true;
		}

		case "approve": {
			const taskId = args[1]?.trim();
			if (!taskId) {
				console.error(chalk.red("Error: taskId is required.\nUsage: pi-orchestrator approve <task_id>"));
				process.exit(1);
			}

			const res = await orchestrator.approveTask(taskId);
			if (res.success) {
				console.log(chalk.green(`Task ${taskId} approved! Changes merged into codebase.`));
			} else {
				console.error(chalk.red(`Approval rejected: ${res.message}`));
			}
			return true;
		}

		case "reject": {
			const taskId = args[1]?.trim();
			const reason = args.slice(2).join(" ").trim() || "Rejected by user";
			if (!taskId) {
				console.error(chalk.red("Error: taskId is required.\nUsage: pi-orchestrator reject <task_id> [reason]"));
				process.exit(1);
			}

			const res = await orchestrator.rejectTask(taskId, reason);
			console.log(chalk.yellow(res.message));
			return true;
		}

		default:
			return false;
	}
}
