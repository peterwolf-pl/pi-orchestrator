/**
 * Antigravity2 - Secondary/Worker Agent for Pi Multi-Agent Orchestrator.
 * Receives narrowly scoped tasks, operates in an isolated workspace, and returns structured results.
 */

import { spawnSync } from "node:child_process";
import { Agent } from "./agent.ts";
import type { FileOwnershipManager } from "./file-ownership.ts";
import type { OrchestratorLogger } from "./logger.ts";
import type { TaskResult, TaskTestResult, WorkerTask } from "./types.ts";
import type { WorkerWorkspace } from "./workspace.ts";

function spawnProcessSync(command: string, args: string[], options: any) {
	return spawnSync(command, args, options);
}

export interface WorkerExecutionOptions {
	logger?: OrchestratorLogger;
	fileOwnership?: FileOwnershipManager;
	/** Custom session executor or LLM runner */
	runTurn?: (prompt: string, workspacePath: string, signal: AbortSignal) => Promise<string>;
}

export class WorkerAgent extends Agent {
	constructor(name: string = "antigravity2") {
		super(name, "worker");
	}

	buildIsolatedPrompt(task: WorkerTask): string {
		return `You are ${this.name}, a specialized worker coding agent assisting Master Agent (Antigravity).

TASK ID: ${task.task_id}
TITLE: ${task.title}
DESCRIPTION: ${task.description}

CONSTRAINTS:
1. Work strictly within the assigned task scope. Do not redesign the project architecture.
2. Only modify files within your allowed scope: ${
			task.allowed_files && task.allowed_files.length > 0 ? task.allowed_files.join(", ") : "isolated worker scope"
		}.
3. If you need to suggest changes to files outside your scope, provide recommendations or diffs for Master review.
${task.run_tests ? `4. Verify your solution by running test command: ${task.test_command || "project tests"}` : ""}

REQUIRED OUTPUT:
Provide a clear structured report containing:
- Summary of actions and analysis
- Specific findings / root cause
- Files modified or created
- Test execution results
- Recommendation for Master review
`;
	}

	buildWorkerPrompt(task: WorkerTask, workspacePath?: string): string {
		const base = this.buildIsolatedPrompt(task);
		return workspacePath ? `${base}\nWorkspace Directory: ${workspacePath}` : base;
	}

	async executeTask(
		task: WorkerTask,
		workspaceOrPath: WorkerWorkspace | string,
		options?: WorkerExecutionOptions,
	): Promise<TaskResult> {
		const workspace: WorkerWorkspace =
			typeof workspaceOrPath === "string"
				? {
						taskId: task.task_id,
						workspacePath: workspaceOrPath,
						isGit: false,
						initialStatus: "",
						getDiff: async () => "",
						getStatus: async () => "",
						applyToTarget: async () => ({ success: true }),
						cleanup: async () => {},
					}
				: workspaceOrPath;
		this.setStatus("running");
		this.setActivity(task.title);
		this.clearSubtasks();
		this.addSubtask(task.title);

		const timeoutMs = task.timeout_ms ?? 300000;
		const abortController = new AbortController();
		let timeoutTimer: NodeJS.Timeout | undefined;

		task.startedAt = Date.now();
		options?.logger?.logWorker(task.task_id, `Starting worker task: "${task.title}"`);

		const timeoutPromise = new Promise<TaskResult>((resolve) => {
			timeoutTimer = setTimeout(() => {
				abortController.abort();
				this.setStatus("idle");
				this.setActivity(undefined);
				options?.logger?.logWorker(task.task_id, `Worker task timed out after ${timeoutMs}ms`, undefined, "WARN");
				resolve({
					task_id: task.task_id,
					status: "timeout",
					summary: `Task timed out after ${Math.round(timeoutMs / 1000)}s. Control returned to Master.`,
					files_changed: [],
					problems: `Worker execution exceeded maximum allowed time (${timeoutMs}ms).`,
					recommendation: "Master should decide whether to retry with a narrower scope or handle directly.",
					patch_available: false,
				});
			}, timeoutMs);
		});

		const executionPromise = (async (): Promise<TaskResult> => {
			try {
				let rawOutput = "";
				const prompt = this.buildIsolatedPrompt(task);

				// 1. Run LLM turn if executor provided
				if (options?.runTurn) {
					this.addSubtask("executing agent turn");
					rawOutput = await options.runTurn(prompt, workspace.workspacePath, abortController.signal);
				}

				// 2. Run tests if requested
				let testResult: TaskTestResult | undefined;
				if (task.run_tests && task.test_command) {
					this.addSubtask(`running tests: ${task.test_command}`);
					options?.logger?.logWorker(task.task_id, `Running tests: ${task.test_command}`);

					try {
						const parts = task.test_command.split(" ").filter((p) => p.length > 0);
						const cmd = parts[0];
						const args = parts.slice(1);
						const res = spawnProcessSync(cmd, args, {
							cwd: workspace.workspacePath,
							encoding: "utf-8",
						});
						const passed = res.status === 0;
						testResult = {
							command: task.test_command,
							status: passed ? "passed" : "failed",
							output: (res.stdout || "") + (res.stderr || ""),
						};
						options?.logger?.logWorker(
							task.task_id,
							`Test command "${task.test_command}" finished with status: ${testResult.status}`,
						);
					} catch (testErr) {
						testResult = {
							command: task.test_command,
							status: "failed",
							output: String(testErr),
						};
					}
				}

				// 3. Inspect workspace diff and file changes
				this.addSubtask("inspecting diff and changes");
				const diff = await workspace.getDiff();
				const statusOutput = await workspace.getStatus();
				const filesChanged: string[] = [];

				if (statusOutput) {
					const lines = statusOutput.split("\n");
					for (const line of lines) {
						const trimmed = line.trim();
						if (trimmed.length > 3) {
							const file = trimmed.slice(3).trim();
							if (file) filesChanged.push(file);
						}
					}
				}

				task.completedAt = Date.now();

				// Parse structured summary and recommendations
				const summary = rawOutput ? rawOutput.slice(0, 300) : `Worker completed task: ${task.title}`;
				const recommendation = `Review worker findings and test results before merging into main branch.`;

				const result: TaskResult = {
					task_id: task.task_id,
					status: "completed",
					summary,
					findings: rawOutput || `Analysis complete for ${task.title}`,
					files_changed: filesChanged,
					tests: testResult,
					recommendation,
					patch_available: diff.length > 0,
					patch: diff.length > 0 ? diff : undefined,
					raw_output: rawOutput,
				};

				options?.logger?.logWorker(
					task.task_id,
					`Task completed successfully. Files changed: ${filesChanged.length}`,
				);
				return result;
			} catch (error: unknown) {
				const errMsg = error instanceof Error ? error.message : String(error);
				options?.logger?.logWorker(task.task_id, `Worker task failed: ${errMsg}`, undefined, "ERROR");

				return {
					task_id: task.task_id,
					status: "failed",
					summary: `Worker encountered an error: ${errMsg}`,
					files_changed: [],
					error: errMsg,
					problems: errMsg,
					recommendation: "Master should inspect the error and choose to retry or resolve manually.",
					patch_available: false,
				};
			} finally {
				this.setStatus("idle");
				this.setActivity(undefined);
			}
		})();

		try {
			const winner = await Promise.race([executionPromise, timeoutPromise]);
			return winner;
		} finally {
			if (timeoutTimer) {
				clearTimeout(timeoutTimer);
			}
		}
	}
}
