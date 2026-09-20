/**
 * Custom tools for Master Agent (Antigravity) to orchestrate Worker Agents and Security Auditor.
 */

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import type { Orchestrator } from "./orchestrator.ts";
import { fetchAllAccountLimits } from "./quota.ts";

export const ORCHESTRATOR_SYSTEM_PROMPT_GUIDELINES = [
	"You are the MASTER software-engineering agent. You orchestrate a pool of worker agents (Antigravity 2/3, xAI Grok) and a Security Auditor.",
	"GENERAL CODING: You handle any programming language, stack, and software architecture.",
	"DELEGATION ECONOMICS: Delegate tasks when estimated_worker_value > delegation_overhead.",
	"GOOD delegation candidates: error/log investigation, API research, writing isolated unit/integration tests, auditing specific classes, refactoring standalone modules, security scans.",
	"POOR delegation candidates: single-line edits, core architectural decisions, tightly coupled code requiring master's full attention.",
	"FILE & SECURITY SAFETY: Workers run in isolated git worktrees. Diffs are audited by the Security Auditor (secret leaks, shell injection, OWASP flaws) before master approval.",
];

export function createDelegateTaskTool(orchestrator: Orchestrator): ToolDefinition {
	const schema = Type.Object({
		title: Type.String({ description: "Short title describing the task for the worker" }),
		description: Type.String({
			description: "Detailed instructions, error logs, requirements, and constraints for the worker",
		}),
		agent: Type.Optional(
			Type.String({
				description:
					"Specific worker account to assign (e.g. 'google-antigravity-2', 'google-antigravity-3', 'xai'). If omitted, orchestrator auto-assigns.",
			}),
		),
		scope: Type.Optional(
			Type.Array(Type.String(), {
				description: "Directories or file patterns within the worker's scope",
			}),
		),
		allowed_files: Type.Optional(
			Type.Array(Type.String(), {
				description: "Exact list of files the worker is permitted to modify or create",
			}),
		),
		run_tests: Type.Optional(
			Type.Boolean({
				description: "Whether the worker should execute verification tests in its workspace",
			}),
		),
		test_command: Type.Optional(
			Type.String({
				description: "Shell test command for the worker to execute (e.g. 'npm test', './gradlew test', 'pytest')",
			}),
		),
		timeout_ms: Type.Optional(
			Type.Number({
				description: "Worker timeout in milliseconds (default: 300000 / 5 minutes)",
			}),
		),
		wait_for_result: Type.Optional(
			Type.Boolean({
				description: "Whether to wait synchronously for worker result (default: true)",
			}),
		),
	});

	return defineTool({
		name: "delegate_task",
		label: "Delegate Subtask to Worker Pool",
		description:
			"Delegate a scoped coding subtask (investigation, test writing, standalone module, refactoring) to an available worker agent in an isolated workspace.",
		promptSnippet: "delegate_task - Delegate an isolated coding subtask to a worker agent",
		promptGuidelines: ORCHESTRATOR_SYSTEM_PROMPT_GUIDELINES,
		parameters: schema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const {
				title,
				description,
				agent,
				scope,
				allowed_files,
				run_tests,
				test_command,
				timeout_ms,
				wait_for_result,
			} = params as Static<typeof schema>;

			const evalResult = orchestrator.master.evaluateDelegation({
				title,
				description,
				isTinyEdit: false,
				requiresSharedContext: false,
			});

			if (!evalResult.shouldDelegate) {
				return {
					content: [
						{
							type: "text",
							text: `Delegation not recommended by Master economics: ${evalResult.reason}. Execute this task directly in master session.`,
						},
					],
					details: { evalResult },
				};
			}

			const shouldWait = wait_for_result ?? true;
			if (shouldWait) {
				if (_ctx.hasUI) {
					_ctx.ui.notify(
						`⚡ [Pi Orchestrator] Delegating subtask to worker (${agent || "pool"}): "${title}"`,
						"info",
					);
				}
				try {
					const result = await orchestrator.delegateTask({
						title,
						description,
						agent,
						scope,
						allowed_files,
						run_tests,
						test_command,
						timeout_ms,
					});

					const secAudit = result.securityAudit
						? `\nSecurity Audit (${result.securityAudit.auditedBy}): ${result.securityAudit.passed ? "PASSED [CLEAN]" : `FAILED [${result.securityAudit.severity.toUpperCase()}]`}\nFindings: ${result.securityAudit.findings.join("; ")}`
						: "";

					return {
						content: [
							{
								type: "text",
								text: `Worker completed task [${result.task_id}].\nStatus: ${result.status}\nSummary: ${result.summary}\nFiles Changed: ${result.files_changed.join(", ") || "none"}\nPatch Available: ${result.patch_available ? "yes (inspect with get_worker_diff)" : "no"}${secAudit}`,
							},
						],
						details: { result },
					};
				} catch (err: any) {
					return {
						content: [
							{
								type: "text",
								text: `Worker task failed with error: ${err.message}`,
							},
						],
						details: { error: err.message },
					};
				}
			} else {
				const task = await orchestrator.createTask({
					title,
					description,
					agent,
					scope,
					allowed_files,
					run_tests,
					test_command,
					timeout_ms,
				});

				void orchestrator.runWorkerTask(task.task_id);

				return {
					content: [
						{
							type: "text",
							text: `Task [${task.task_id}] queued and executing in background with worker ${task.agent}. Use check_worker_task to poll progress.`,
						},
					],
					details: { task },
				};
			}
		},
	});
}

export function createCheckWorkerTaskTool(orchestrator: Orchestrator): ToolDefinition {
	const schema = Type.Object({
		task_id: Type.String({ description: "ID of the task to check (e.g. 'worker-001')" }),
	});

	return defineTool({
		name: "check_worker_task",
		label: "Check Worker Task Status",
		description: "Check the status, summary, and results of a delegated worker task.",
		parameters: schema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { task_id } = params as Static<typeof schema>;
			const record = orchestrator.getTask(task_id);

			if (!record) {
				return {
					content: [{ type: "text", text: `Task ${task_id} not found.` }],
					details: { notFound: true },
				};
			}

			const sec = record.securityAudit
				? `\nSecurity Audit: ${record.securityAudit.passed ? "PASSED" : "FAILED"} (${record.securityAudit.findings.join("; ")})`
				: "";

			return {
				content: [
					{
						type: "text",
						text: `Task [${task_id}] (${record.task.title})\nAgent: ${record.task.agent}\nStatus: ${record.status}\nSummary: ${record.result?.summary || "In progress"}\nFiles: ${record.result?.files_changed.join(", ") || "none"}${sec}`,
					},
				],
				details: { record },
			};
		},
	});
}

export function createGetWorkerDiffTool(orchestrator: Orchestrator): ToolDefinition {
	const schema = Type.Object({
		task_id: Type.String({ description: "ID of the task to inspect diff for" }),
	});

	return defineTool({
		name: "get_worker_diff",
		label: "Get Worker Git Diff",
		description: "View the git diff produced by a worker in its isolated worktree.",
		parameters: schema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { task_id } = params as Static<typeof schema>;
			const record = orchestrator.getTask(task_id);

			if (!record) {
				return {
					content: [{ type: "text", text: `Task ${task_id} not found.` }],
					details: { notFound: true },
				};
			}

			const diff = record.diff || "";
			if (!diff.trim()) {
				return {
					content: [{ type: "text", text: `Task ${task_id} produced no git changes (empty diff).` }],
					details: { hasDiff: false },
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Git diff for task [${task_id}] (${record.task.title}):\n\n${diff}`,
					},
				],
				details: { hasDiff: true },
			};
		},
	});
}

export function createSecurityAuditTool(orchestrator: Orchestrator): ToolDefinition {
	const schema = Type.Object({
		task_id: Type.String({ description: "ID of the task to audit" }),
	});

	return defineTool({
		name: "run_security_audit",
		label: "Run Security Audit",
		description:
			"Perform a security vulnerability and secret leak scan on a worker's diff using the Security Auditor.",
		parameters: schema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { task_id } = params as Static<typeof schema>;
			const record = orchestrator.getTask(task_id);
			if (!record) {
				return {
					content: [{ type: "text", text: `Task ${task_id} not found.` }],
					details: { notFound: true },
				};
			}

			const diff = record.diff || "";
			const files = record.result?.files_changed || [];
			const audit = await orchestrator.securityAuditor.auditDiff(diff, files, record.task.title);

			return {
				content: [
					{
						type: "text",
						text: `Security Audit Results for [${task_id}] (Audited by ${audit.auditedBy}):\nVerdict: ${audit.passed ? "PASSED [CLEAN]" : `FAILED [${audit.severity.toUpperCase()}]`}\nFindings:\n- ${audit.findings.join("\n- ")}\nRecommendations:\n- ${audit.recommendations.join("\n- ")}`,
					},
				],
				details: { audit },
			};
		},
	});
}

export function createAccountsStatusTool(_orchestrator: Orchestrator): ToolDefinition {
	const schema = Type.Object({
		force_refresh: Type.Optional(Type.Boolean({ description: "Force refresh quota from APIs" })),
	});

	return defineTool({
		name: "get_accounts_status",
		label: "Get Multi-Account Quotas",
		description:
			"Check real-time remaining 5-hour and weekly limits and reset countdowns for all configured accounts (Antigravity & xAI).",
		parameters: schema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { force_refresh } = params as Static<typeof schema>;
			const limits = await fetchAllAccountLimits(force_refresh ?? false);

			const lines = limits.map((acc) => {
				if (acc.provider === "xai") {
					return `[${acc.accountId}] (xAI Grok): Status: ${acc.status}, Reset: ${acc.fiveHourReset || "ready"}`;
				}
				return `[${acc.accountId}] (${acc.label || "Antigravity"}): 5h Limit: ${acc.fiveHourRemaining ?? "--"}% (reset: ${acc.fiveHourReset || "ready"}), Weekly Limit: ${acc.weeklyRemaining ?? "--"}% (reset: ${acc.weeklyReset || "ready"}), Status: ${acc.status}`;
			});

			return {
				content: [
					{
						type: "text",
						text: `Configured Accounts & Live Quotas:\n${lines.join("\n")}`,
					},
				],
				details: { limits },
			};
		},
	});
}

export function createApproveWorkerTaskTool(orchestrator: Orchestrator): ToolDefinition {
	const schema = Type.Object({
		task_id: Type.String({ description: "ID of the task to approve" }),
		review_notes: Type.Optional(Type.String({ description: "Master review notes explaining the approval" })),
	});

	return defineTool({
		name: "approve_worker_task",
		label: "Approve and Merge Worker Task",
		description:
			"Master approves worker changes and safely merges them into the main codebase after reviewing diff and security checks.",
		parameters: schema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { task_id, review_notes } = params as Static<typeof schema>;
			const result = await orchestrator.approveTask(task_id, review_notes);
			if (_ctx.hasUI && result.success) {
				_ctx.ui.notify(`⚡ [Pi Orchestrator] Master approved & merged changes for [${task_id}]`, "info");
			}
			return {
				content: [
					{
						type: "text",
						text: result.success
							? `Approved and merged task ${task_id}.`
							: `Approval rejected: ${result.message}`,
					},
				],
				details: { result },
			};
		},
	});
}

export function createRejectWorkerTaskTool(orchestrator: Orchestrator): ToolDefinition {
	const schema = Type.Object({
		task_id: Type.String({ description: "ID of the task to reject" }),
		reason: Type.String({ description: "Master reason for rejecting worker changes" }),
	});

	return defineTool({
		name: "reject_worker_task",
		label: "Reject Worker Task",
		description: "Master rejects worker changes and discards the isolated worktree without merging.",
		parameters: schema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { task_id, reason } = params as Static<typeof schema>;
			const result = await orchestrator.rejectTask(task_id, reason);
			return {
				content: [{ type: "text", text: result.message }],
				details: { result },
			};
		},
	});
}

export function registerOrchestratorTools(orchestrator: Orchestrator): ToolDefinition[] {
	return [
		createDelegateTaskTool(orchestrator),
		createCheckWorkerTaskTool(orchestrator),
		createGetWorkerDiffTool(orchestrator),
		createSecurityAuditTool(orchestrator),
		createAccountsStatusTool(orchestrator),
		createApproveWorkerTaskTool(orchestrator),
		createRejectWorkerTaskTool(orchestrator),
	];
}
