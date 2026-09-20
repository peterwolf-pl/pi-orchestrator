/**
 * Interactive Real-Time Terminal Dashboard with Live Controls.
 * Runs in a single terminal window with instant keybindings to change settings,
 * switch master/worker accounts, toggle security auditor, and view live 5h/weekly quotas.
 */

import * as readline from "node:readline";
import chalk from "chalk";
import { renderDashboard } from "./dashboard.ts";
import type { Orchestrator } from "./orchestrator.ts";
import { clearQuotaCache, getDiscoveredAccounts } from "./quota.ts";

export async function runInteractiveDashboard(orchestrator: Orchestrator): Promise<void> {
	const isTTY = process.stdin.isTTY && process.stdout.isTTY;
	if (!isTTY) {
		const status = await orchestrator.getStatus(true);
		console.log(renderDashboard(status));
		return;
	}

	let running = true;
	let message = "";
	let isInputMode = false;
	let refreshInterval: NodeJS.Timeout | null = null;
	let currentScrollOffset = 0;

	const clearScreen = () => {
		process.stdout.write("\x1b[2J\x1b[0;0H");
	};

	const redraw = async (forceQuota = false) => {
		if (!running || isInputMode) return;
		try {
			const status = await orchestrator.getStatus(forceQuota);
			clearScreen();
			const rendered = renderDashboard(status, Math.min(process.stdout.columns || 80, 95), {
				scrollOffset: currentScrollOffset,
				windowSize: 8,
			});
			process.stdout.write(`${rendered}\n`);
			if (message) {
				process.stdout.write(`\n${message}\n`);
			}
		} catch (err: any) {
			process.stdout.write(`Dashboard refresh error: ${err.message}\n`);
		}
	};

	const promptInput = async (query: string): Promise<string> => {
		isInputMode = true;
		if (process.stdin.isRaw) {
			process.stdin.setRawMode(false);
		}
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		return new Promise<string>((resolve) => {
			rl.question(chalk.yellow.bold(`\n${query} `), (answer) => {
				rl.close();
				if (process.stdin.setRawMode) {
					process.stdin.setRawMode(true);
					process.stdin.resume();
				}
				isInputMode = false;
				resolve(answer.trim());
			});
		});
	};

	// Set terminal raw mode
	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.setEncoding("utf-8");

	// Initial render
	message = chalk.cyan("Dashboard active. Press [H] for help, [Q] to quit.");
	await redraw(true);

	// Periodic auto-refresh every 4 seconds
	refreshInterval = setInterval(() => {
		void redraw(false);
	}, 4000);

	const handleKey = async (key: string) => {
		if (isInputMode) return;

		// Quit on q, Q, or Ctrl+C (\u0003)
		if (key === "q" || key === "Q" || key === "\u0003") {
			running = false;
			if (refreshInterval) clearInterval(refreshInterval);
			if (process.stdin.setRawMode) {
				process.stdin.setRawMode(false);
			}
			process.stdin.pause();
			clearScreen();
			console.log(chalk.green("Dashboard exited. Pi Orchestrator running in background."));
			process.exit(0);
		}

		// R - Force refresh quotas directly from provider APIs
		if (key === "r" || key === "R") {
			clearQuotaCache();
			message = chalk.yellow("Contacting Google Cloud & xAI APIs for real-time quotas...");
			clearScreen();
			process.stdout.write(chalk.yellow("Contacting Google Cloud & xAI APIs for real-time quotas...\n"));
			await redraw(true);
			message = chalk.green.bold("✔ Live quotas fetched directly from Google & xAI API!");
			clearScreen();
			const status = await orchestrator.getStatus(false);
			const rendered = renderDashboard(status, Math.min(process.stdout.columns || 80, 95));
			process.stdout.write(`${rendered}\n\n${message}\n`);
			return;
		}

		// Arrow Up / k - Scroll task feed up (older tasks)
		if (key === "\u001b[A" || key === "k") {
			currentScrollOffset++;
			await redraw(false);
			return;
		}

		// Arrow Down / j - Scroll task feed down (newer tasks)
		if (key === "\u001b[B" || key === "j") {
			currentScrollOffset = Math.max(0, currentScrollOffset - 1);
			await redraw(false);
			return;
		}

		// Page Up - Scroll 5 lines up
		if (key === "\u001b[5~") {
			currentScrollOffset += 5;
			await redraw(false);
			return;
		}

		// Page Down - Scroll 5 lines down
		if (key === "\u001b[6~") {
			currentScrollOffset = Math.max(0, currentScrollOffset - 5);
			await redraw(false);
			return;
		}

		// 1..9 - Direct Toggle Worker Role for Account Number
		const num = Number.parseInt(key, 10);
		if (!Number.isNaN(num) && num >= 1 && num <= 9) {
			const accounts = getDiscoveredAccounts().map((a) => a.id);
			const targetAcc = accounts[num - 1];
			if (!targetAcc) {
				message = chalk.yellow(`No account found at slot [${num}].`);
				await redraw(false);
				return;
			}
			if (targetAcc === orchestrator.config.masterAccount) {
				message = chalk.yellow(
					`Account [${num}] (${targetAcc}) is currently MASTER. Use [M] to change master first.`,
				);
				await redraw(false);
				return;
			}
			const isWorker = orchestrator.getActiveWorkers().includes(targetAcc);
			if (isWorker) {
				orchestrator.setAccountRole(targetAcc, "idle");
				message = chalk.yellow.bold(`Account [${num}] (${targetAcc}) set to: IDLE`);
			} else {
				orchestrator.setAccountRole(targetAcc, "worker");
				message = chalk.blue.bold(`Account [${num}] (${targetAcc}) set to: WORKER`);
			}
			await redraw(false);
			return;
		}

		// S - Toggle Security Auditor or switch auditor account
		if (key === "s" || key === "S") {
			const accounts = getDiscoveredAccounts().map((a) => a.id);
			const candidateAuditors = accounts.filter((id) => id !== orchestrator.config.masterAccount);
			const currentAuditor = orchestrator.securityAuditor.getAuditorAccount();
			const isEnabled = orchestrator.securityAuditor.isEnabled();

			if (isEnabled) {
				const nextIndex = (candidateAuditors.indexOf(currentAuditor) + 1) % (candidateAuditors.length + 1);
				if (nextIndex === candidateAuditors.length) {
					orchestrator.setSecurityAuditor(currentAuditor, false);
					message = chalk.red.bold("Security Auditor DISABLED.");
				} else {
					const nextAuditor = candidateAuditors[nextIndex];
					orchestrator.setAccountRole(nextAuditor, "security_auditor");
					message = chalk.green.bold(`Security Auditor assigned to: ${nextAuditor}`);
				}
			} else {
				const auditorAcc = candidateAuditors[0] || "xai";
				orchestrator.setAccountRole(auditorAcc, "security_auditor");
				message = chalk.green.bold(`Security Auditor ENABLED (Auditor: ${auditorAcc})`);
			}
			await redraw(false);
			return;
		}

		// M - Switch Master Account
		if (key === "m" || key === "M") {
			const accounts = getDiscoveredAccounts().map((a) => a.id);
			const currentMaster = orchestrator.config.masterAccount;
			const currentIndex = accounts.indexOf(currentMaster);
			const nextIndex = (currentIndex + 1) % accounts.length;
			const nextMaster = accounts[nextIndex];

			orchestrator.setAccountRole(nextMaster, "master");
			message = chalk.magenta.bold(`Master account switched to: ${nextMaster}`);
			await redraw(false);
			return;
		}

		// W - Toggle Worker Accounts
		if (key === "w" || key === "W") {
			const accounts = getDiscoveredAccounts().map((a) => a.id);
			const activeWorkers = orchestrator.getActiveWorkers();
			const nonMaster = accounts.filter((id) => id !== orchestrator.config.masterAccount);
			if (nonMaster.length === 0) {
				message = chalk.yellow("No other accounts available to toggle as workers.");
				await redraw(false);
				return;
			}
			const inactive = nonMaster.find((id) => !activeWorkers.includes(id));
			if (inactive) {
				orchestrator.setAccountRole(inactive, "worker");
				message = chalk.blue.bold(`Worker activated: ${inactive}`);
			} else {
				const toDisable = nonMaster[nonMaster.length - 1];
				orchestrator.setAccountRole(toDisable, "idle");
				message = chalk.yellow.bold(`Worker deactivated: ${toDisable}`);
			}
			await redraw(false);
			return;
		}

		// O - Configure Model & Thinking
		if (key === "o" || key === "O") {
			if (refreshInterval) clearInterval(refreshInterval);
			const role = (await promptInput("Configure model for (master / worker / auditor):")).toLowerCase();
			if (role === "master" || role === "worker" || role === "auditor") {
				const thinking = (
					await promptInput(`Thinking level for ${role} (off / low / medium / high):`)
				).toLowerCase();
				if (thinking) {
					orchestrator.setAgentModel(role, orchestrator.config.models[role].model, thinking as any);
					message = chalk.green.bold(`Updated ${role} thinking to: ${thinking.toUpperCase()}`);
				}
			}
			refreshInterval = setInterval(() => {
				void redraw(false);
			}, 4000);
			await redraw(false);
			return;
		}

		// T - Set new main coding task
		if (key === "t" || key === "T") {
			if (refreshInterval) clearInterval(refreshInterval);
			const title = await promptInput("Enter main coding objective:");
			if (title) {
				orchestrator.setMainTask(title);
				message = chalk.green.bold(`Main task set: "${title}"`);
			}
			refreshInterval = setInterval(() => {
				void redraw(false);
			}, 4000);
			await redraw(false);
			return;
		}

		// D - Delegate subtask to worker
		if (key === "d" || key === "D") {
			if (refreshInterval) clearInterval(refreshInterval);
			const taskTitle = await promptInput("Enter subtask description to delegate:");
			if (taskTitle) {
				message = chalk.yellow(`Delegating subtask "${taskTitle}"...`);
				await redraw(false);
				try {
					const task = await orchestrator.createTask({
						title: taskTitle,
						description: taskTitle,
					});
					void orchestrator.runWorkerTask(task.task_id);
					message = chalk.green.bold(`Delegated ${task.task_id} to ${task.agent}!`);
				} catch (err: any) {
					message = chalk.red.bold(`Delegation failed: ${err.message}`);
				}
			}
			refreshInterval = setInterval(() => {
				void redraw(false);
			}, 4000);
			await redraw(false);
			return;
		}

		// A - Toggle Auto-Idle Worker Tasks (Skill Extraction & Docs)
		if (key === "a" || key === "A") {
			const currentState = orchestrator.config.idleWork?.autoIdleWork ?? true;
			orchestrator.setAutoIdleWork(!currentState);
			const newState = !currentState;
			message = newState
				? chalk.green.bold("Auto-Idle Tasks ENABLED: Workers extract skills & update docs when idle.")
				: chalk.yellow.bold("Auto-Idle Tasks PAUSED: Workers do not run background skill tasks.");
			await redraw(false);
			return;
		}

		// K - Extract Skills and generate documentation now
		if (key === "k" || key === "K") {
			const tasks = orchestrator.getTasks();
			const completed = tasks.filter((t) => t.status === "completed");
			if (completed.length === 0) {
				message = chalk.yellow("No completed tasks available to extract skills from yet.");
				await redraw(false);
				return;
			}
			message = chalk.yellow("Extracting skills and updating documentation...");
			await redraw(false);
			try {
				let count = 0;
				for (const rec of completed) {
					if (!rec.skillCreated) {
						await orchestrator.extractSkillFromTask(rec.task.task_id);
						count++;
					}
				}
				await orchestrator.updateDocumentation();
				message = chalk.green.bold(`Skills & Docs updated! (Extracted ${count} new skills, docs generated)`);
			} catch (err: any) {
				message = chalk.red.bold(`Skill extraction failed: ${err.message}`);
			}
			await redraw(false);
			return;
		}

		// H - Help
		if (key === "h" || key === "H") {
			message = chalk.cyan.bold(
				"Keys: [M] Master │ [W] Worker │ [S] Auditor │ [A] Auto-Idle │ [K] Skills/Docs │ [R] Quotas │ [T] Set Task │ [D] Delegate │ [Q] Quit",
			);
			await redraw(false);
		}
	};

	process.stdin.on("data", (data: Buffer | string) => {
		const str = data.toString();
		void handleKey(str);
	});
}
