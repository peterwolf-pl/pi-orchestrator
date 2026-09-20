/**
 * Terminal Dashboard for Pi Multi-Agent Orchestrator.
 * Renders an informative real-time terminal box showing:
 * - Multi-account quota tracking (5h and weekly limits with reset timers)
 * - Security Auditor status & findings
 * - Master & Worker agents state
 * - General coding tasks & delegated work
 */

import chalk from "chalk";
import type { OrchestratorStatus } from "./types.ts";

function renderProgressBar(pct?: number, width = 10): string {
	if (pct === undefined || Number.isNaN(pct)) {
		return chalk.dim(`[${"-".repeat(width)}] --%`);
	}
	const clamped = Math.max(0, Math.min(100, pct));
	const filled = Math.round((clamped / 100) * width);
	const empty = width - filled;

	let color = chalk.green;
	if (clamped < 20) {
		color = chalk.red.bold;
	} else if (clamped < 50) {
		color = chalk.yellow;
	}

	const bar = color("█".repeat(filled)) + chalk.dim("-".repeat(empty));
	const pctStr = `${clamped.toFixed(0)}%`.padStart(4);
	return `[${bar}] ${color(pctStr)}`;
}

export interface DashboardRenderOptions {
	scrollOffset?: number; // 0 = at bottom / most recent tasks
	windowSize?: number; // default 8 lines
}

export function renderDashboard(status: OrchestratorStatus, width = 78, options: DashboardRenderOptions = {}): string {
	const w = Math.max(70, Math.min(width, 100));
	const innerWidth = w - 2;

	const pad = (text: string, len: number) => {
		const stripped = text.replace(/\x1b\[[0-9;]*m/g, "");
		const diff = len - stripped.length;
		return diff > 0 ? text + " ".repeat(diff) : text.slice(0, len);
	};

	const line = (content: string) => `│ ${pad(content, innerWidth - 2)} │`;
	const separator = () => `├${"─".repeat(innerWidth)}┤`;
	const topBorder = () => `┌${"─".repeat(innerWidth)}┐`;
	const bottomBorder = () => `└${"─".repeat(innerWidth)}┘`;

	const formatStatus = (s: string) => {
		switch (s.toLowerCase()) {
			case "running":
				return chalk.green.bold("RUNNING");
			case "completed":
				return chalk.cyan.bold("COMPLETED");
			case "failed":
				return chalk.red.bold("FAILED");
			case "security_failed":
				return chalk.red.bgBlack.bold("SEC_FAILED");
			case "timeout":
				return chalk.yellow.bold("TIMEOUT");
			case "queued":
				return chalk.dim("QUEUED");
			case "cancelled":
				return chalk.gray("CANCELLED");
			default:
				return chalk.white(s.toUpperCase());
		}
	};

	const formatRole = (role: string) => {
		switch (role.toLowerCase()) {
			case "master":
				return chalk.magenta.bold("MASTER");
			case "worker":
				return chalk.blue.bold("WORKER");
			case "security_auditor":
				return chalk.yellow.bold("AUDITOR");
			default:
				return chalk.dim("IDLE");
		}
	};

	const out: string[] = [];

	// Header
	out.push(topBorder());
	out.push(
		line(`${chalk.bold.cyan("PI MULTI-AGENT CODING ORCHESTRATOR")} ${chalk.dim("│ Antigravity & xAI & Security")}`),
	);
	out.push(separator());

	// ACCOUNTS & LIVE QUOTA MONITORING TABLE
	out.push(line(chalk.bold.underline("ACCOUNTS & REAL-TIME QUOTAS (5H / WEEKLY LIMITS)")));
	out.push(line(""));

	if (!status.accounts || status.accounts.length === 0) {
		out.push(line(chalk.dim("  No accounts discovered in ~/.pi/agent/auth.json")));
	} else {
		let idx = 1;
		for (const acc of status.accounts) {
			const numTag = chalk.cyan.bold(`[${idx}]`);
			const roleTag = formatRole(acc.role).padEnd(16);
			const label = acc.label ? `(${acc.label})` : "";
			const nameStr = `${acc.accountId} ${label}`.slice(0, 23).padEnd(23);

			let quotaLine = "";
			if (acc.provider === "xai") {
				quotaLine = `OAuth Token: ${chalk.green("Active")} (Reset: ${acc.fiveHourReset || "ready"})`;
			} else {
				const fiveHBar = renderProgressBar(acc.fiveHourRemaining, 8);
				const fiveHReset = acc.fiveHourReset ? chalk.dim(`(5h: ${acc.fiveHourReset})`) : "";
				const weeklyBar = renderProgressBar(acc.weeklyRemaining, 8);
				const weeklyReset = acc.weeklyReset ? chalk.dim(`(wk: ${acc.weeklyReset})`) : "";
				quotaLine = `5H ${fiveHBar} ${fiveHReset} │ WK ${weeklyBar} ${weeklyReset}`;
			}

			out.push(line(`  ${numTag} ${roleTag} ${chalk.white.bold(nameStr)}`));
			out.push(line(`       └─ ${quotaLine}`));
			idx++;
		}
	}

	out.push(separator());

	// SECURITY AUDITOR PANEL
	out.push(line(chalk.bold.underline("SECURITY AUDITOR INSPECTION")));
	out.push(line(""));

	const secEnabled = status.securityAuditEnabled;
	const auditorName = status.securityAuditor?.name || "none";
	const secStatusText = secEnabled
		? `${chalk.green.bold("ACTIVE")} ${chalk.dim(`(Assigned account: `)}${chalk.cyan.bold(auditorName)}${chalk.dim(`)`)}`
		: `${chalk.red.bold("DISABLED")} ${chalk.dim("(Changes merged without security scans)")}`;

	out.push(line(`  Status  : ${secStatusText}`));
	out.push(
		line(
			`  Checks  : ${chalk.yellow("Secrets / Keys Leakage")} │ ${chalk.yellow(
				"Shell Injection",
			)} │ ${chalk.yellow("OWASP & Permissions")}`,
		),
	);

	// Find any security audits from tasks
	const securityAuditedTasks = status.tasks.filter((t) => t.securityAudit);
	if (securityAuditedTasks.length > 0) {
		const latest = securityAuditedTasks[securityAuditedTasks.length - 1];
		const audit = latest.securityAudit!;
		const auditVerdict = audit.passed
			? chalk.green.bold("PASSED [CLEAN]")
			: chalk.red.bold(`FAILED [${audit.severity.toUpperCase()}]`);
		out.push(
			line(
				`  Latest  : Task ${chalk.bold(latest.task.task_id)} -> ${auditVerdict}: ${chalk.dim(
					audit.findings[0] || "",
				)}`,
			),
		);
	}

	out.push(separator());

	// AUTONOMOUS SKILLS & DOCUMENTATION AGENT (IDLE WORKER TASKS)
	out.push(line(chalk.bold.underline("SKILL MANAGER & DOCS GENERATOR (IDLE AGENTS)")));
	out.push(line(""));

	const idleWorkStatus = status.idleWorkEnabled
		? `${chalk.green.bold("ACTIVE")} ${chalk.dim("(Idle workers extract skills & update docs)")}`
		: `${chalk.yellow.bold("PAUSED")} ${chalk.dim("(Workers rest when idle)")}`;
	out.push(line(`  Mode    : ${idleWorkStatus}`));

	const skills = status.skillsCreated || [];
	if (skills.length === 0) {
		out.push(line(chalk.dim("  Skills  : No auto-generated skills yet (.pi/skills/)")));
	} else {
		const latestSkills = skills
			.slice(-2)
			.map((s) => s.skillName)
			.join(", ");
		out.push(
			line(
				`  Skills  : ${chalk.green.bold(String(skills.length))} skills ready ${chalk.dim(`(Latest: ${latestSkills})`)}`,
			),
		);
	}

	out.push(
		line(`  Docs    : ${chalk.cyan("docs/WORKER_KNOWLEDGE_BASE.md")} ${chalk.dim("auto-synced from task results")}`),
	);

	out.push(separator());

	// MODELS & THINKING BUDGET
	out.push(line(chalk.bold.underline("MODELS & THINKING CONFIGURATION")));
	out.push(line(""));
	const mCfg = status.models?.master || { model: "gemini-3.8-flash", thinking: "high" };
	const wCfg = status.models?.worker || { model: "gemini-3.8-flash", thinking: "low" };
	const aCfg = status.models?.auditor || { model: "grok-beta", thinking: "off" };

	out.push(
		line(
			`  Master  : ${chalk.bold.white(mCfg.model)} (${chalk.yellow.bold(`thinking: ${mCfg.thinking.toUpperCase()}`)}) - Deep architecture`,
		),
	);
	out.push(
		line(
			`  Worker  : ${chalk.bold.white(wCfg.model)} (${chalk.green.bold(`thinking: ${wCfg.thinking.toUpperCase()}`)}) - Fast subtasks`,
		),
	);
	out.push(
		line(
			`  Auditor : ${chalk.bold.white(aCfg.model)} (${chalk.dim(`thinking: ${aCfg.thinking.toUpperCase()}`)}) - Rapid scans`,
		),
	);

	out.push(separator());

	// GENERAL CODING MAIN TASK
	out.push(line(chalk.bold.underline("MAIN CODING OBJECTIVE")));
	out.push(line(""));
	const mainTitle = status.mainTask?.title || "Interactive General Coding Session";
	out.push(line(`  ${chalk.bold.green("▶")} ${chalk.bold.white(mainTitle)}`));
	out.push(
		line(
			`    Master (${chalk.magenta(status.master.name)}): ${chalk.dim(
				status.master.currentActivity || "Analyzing codebase / delegating work",
			)}`,
		),
	);

	out.push(separator());

	// DELEGATED LIVE SUBTASKS & ACTIVITY FEED (SCROLLABLE WINDOW)
	const taskLines: string[] = [];

	if (status.tasks.length === 0) {
		taskLines.push(chalk.dim("  (No subtasks delegated yet. Workers idle / awaiting instructions)"));
	} else {
		for (const rec of status.tasks) {
			const id = chalk.bold.cyan(rec.task.task_id.padEnd(11));
			const agent = chalk.blue(rec.task.agent.slice(0, 16).padEnd(16));
			const title = rec.task.title.slice(0, 24).padEnd(25);
			const st = formatStatus(rec.status);
			taskLines.push(`  ${id} ${agent} ${title} ${st}`);

			if (rec.status === "running") {
				const workerObj = status.workers.find((w) => w.name === rec.task.agent);
				const act = workerObj?.currentActivity || "Executing instructions in worktree...";
				taskLines.push(`     ${chalk.green.bold("▶")} ${chalk.yellow(act.slice(0, innerWidth - 12))}`);
			} else if (rec.result?.summary) {
				taskLines.push(`     └─ ${chalk.dim(rec.result.summary.slice(0, innerWidth - 12))}`);
			}

			if (rec.securityAudit) {
				const audit = rec.securityAudit;
				const auditText = audit.passed
					? chalk.green("✔ Security Clean")
					: chalk.red(`✘ Security Flagged [${audit.severity.toUpperCase()}]`);
				taskLines.push(`     🛡️ ${auditText} ${chalk.dim(`(Auditor: ${audit.auditedBy})`)}`);
			}

			if (rec.skillCreated) {
				taskLines.push(`     💡 ${chalk.cyan(`Skill saved: .pi/skills/${rec.skillCreated.skillName}.md`)}`);
			}

			// Add separator line between tasks in feed
			taskLines.push(chalk.dim(`  ${"┄".repeat(innerWidth - 8)}`));
		}
	}

	const windowSize = Math.max(5, options.windowSize || 7);
	const totalLines = taskLines.length;
	const maxOffset = Math.max(0, totalLines - windowSize);
	const offset = Math.max(0, Math.min(maxOffset, options.scrollOffset || 0));

	const endIndex = totalLines - offset;
	const startIndex = Math.max(0, endIndex - windowSize);
	const visibleLines = taskLines.slice(startIndex, endIndex);

	const olderCount = startIndex;
	const newerCount = offset;

	let scrollHeader = chalk.bold.underline("LIVE TASKS & REAL-TIME ACTIVITY FEED");
	if (olderCount > 0) {
		scrollHeader += ` ${chalk.yellow(`▲ ${olderCount} older [↑/k]`)}`;
	} else {
		scrollHeader += ` ${chalk.dim("▲ Top")}`;
	}
	if (newerCount > 0) {
		scrollHeader += ` ${chalk.cyan(`▼ ${newerCount} newer [↓/j]`)}`;
	} else {
		scrollHeader += ` ${chalk.green("● Live")}`;
	}

	out.push(line(scrollHeader));
	out.push(line(""));

	for (let i = 0; i < windowSize; i++) {
		const content = visibleLines[i] || "";
		// Scrollbar indicator on the right edge
		let scrollChar = " ";
		if (totalLines > windowSize) {
			const thumbIndex = Math.round((startIndex / maxOffset) * (windowSize - 1));
			scrollChar = i === thumbIndex ? chalk.cyan.bold("█") : chalk.dim("│");
		}
		const textWidth = innerWidth - 5;
		const padded = pad(content, textWidth);
		out.push(`│ ${padded} ${scrollChar} │`);
	}

	out.push(separator());

	// KEYBOARD SHORTCUTS LEGEND
	out.push(
		line(
			`${chalk.dim("[↑/↓]")} Scroll  ${chalk.dim("[1-5]")} Worker  ${chalk.dim(
				"[M]",
			)} Master  ${chalk.dim("[S]")} Auditor  ${chalk.dim("[O]")} Model  ${chalk.dim(
				"[A]",
			)} Auto  ${chalk.dim("[Q]")} Exit`,
		),
	);
	out.push(bottomBorder());

	return out.join("\n");
}
