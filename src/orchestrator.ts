/**
 * Central Orchestrator for Pi Multi-Agent Architecture.
 * Coordinates Master, Multiple Workers (Antigravity 1/2/3, xAI),
 * and dedicated Security Auditor.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, loadOrchestratorConfig, saveOrchestratorConfig } from "./config.ts";
import { FileOwnershipManager } from "./file-ownership.ts";
import { OrchestratorLogger } from "./logger.ts";
import { MasterAgent } from "./master-agent.ts";
import { fetchAllAccountLimits } from "./quota.ts";
import { SecurityAuditor } from "./security-auditor.ts";
import { SkillManager } from "./skill-manager.ts";
import type {
	AccountLimits,
	AgentInfo,
	AgentRole,
	DocsGenerationResult,
	MainTaskInfo,
	OrchestratorConfig,
	OrchestratorEvent,
	OrchestratorStatus,
	SkillExtractionResult,
	TaskResult,
	ThinkingLevel,
	WorkerTask,
	WorkerTaskRecord,
} from "./types.ts";
import { WorkerAgent, type WorkerExecutionOptions } from "./worker-agent.ts";
import { type WorkerWorkspace, WorkspaceManager } from "./workspace.ts";

export interface CreateTaskParams {
	title: string;
	description: string;
	agent?: string; // target worker account ID
	scope?: string[];
	allowed_files?: string[];
	run_tests?: boolean;
	test_command?: string;
	timeout_ms?: number;
	taskId?: string;
}

export class Orchestrator {
	readonly cwd: string;
	readonly config: OrchestratorConfig;
	readonly logger: OrchestratorLogger;
	readonly fileOwnership: FileOwnershipManager;
	readonly workspaceManager: WorkspaceManager;
	readonly securityAuditor: SecurityAuditor;
	readonly skillManager: SkillManager;

	private masterAgent: MasterAgent;
	private readonly workerAgents: Map<string, WorkerAgent> = new Map();

	private mainTask?: MainTaskInfo;
	private readonly tasks: Map<string, WorkerTaskRecord> = new Map();
	private readonly workspaces: Map<string, WorkerWorkspace> = new Map();
	private readonly listeners: Set<(event: OrchestratorEvent) => void> = new Set();
	private taskCounter = 0;

	constructor(cwd: string = process.cwd()) {
		this.cwd = cwd;
		this.config = loadOrchestratorConfig(cwd);
		this.logger = new OrchestratorLogger(cwd);
		this.fileOwnership = new FileOwnershipManager(cwd);
		this.workspaceManager = new WorkspaceManager(cwd);

		this.masterAgent = new MasterAgent(this.config.masterAccount);
		this.securityAuditor = new SecurityAuditor(
			this.config.securityAuditorAccount,
			this.config.securityAuditorEnabled,
		);
		this.skillManager = new SkillManager(cwd);

		// Initialize worker agents
		for (const workerId of this.config.activeWorkers) {
			this.workerAgents.set(workerId, new WorkerAgent(workerId));
		}

		this.loadState();
	}

	public get master(): MasterAgent {
		return this.masterAgent;
	}

	public get worker(): WorkerAgent {
		// Return first active worker or fallback
		const first = this.workerAgents.values().next().value;
		return first || new WorkerAgent(this.config.activeWorkers[0] || "worker");
	}

	public getWorkerAgent(workerId: string): WorkerAgent {
		let agent = this.workerAgents.get(workerId);
		if (!agent) {
			agent = new WorkerAgent(workerId);
			this.workerAgents.set(workerId, agent);
		}
		return agent;
	}

	public setMasterAccount(accountId: string): void {
		this.config.masterAccount = accountId;
		this.masterAgent = new MasterAgent(accountId);
		// Remove from active workers if it was one
		this.config.activeWorkers = this.config.activeWorkers.filter((id) => id !== accountId);
		this.workerAgents.delete(accountId);

		// If master was security auditor, move auditor to xai or fallback
		if (this.config.securityAuditorAccount === accountId) {
			const fallback =
				["xai", "google-antigravity-4", "google-antigravity-3", "google-antigravity-2"].find(
					(id) => id !== accountId,
				) || "xai";
			this.config.securityAuditorAccount = fallback;
			this.securityAuditor.setAuditorAccount(fallback);
		}

		saveOrchestratorConfig(this.config, this.cwd);
		this.emitEvent({
			type: "account_switched",
			agentName: accountId,
			timestamp: Date.now(),
			data: { role: "master" },
		});
	}

	public setSecurityAuditor(accountId: string, enabled: boolean): void {
		this.config.securityAuditorAccount = accountId;
		this.config.securityAuditorEnabled = enabled;
		this.securityAuditor.setAuditorAccount(accountId);
		this.securityAuditor.setEnabled(enabled);

		// Remove from active workers so auditor does not execute subtasks or audit own work
		if (enabled) {
			this.config.activeWorkers = this.config.activeWorkers.filter((id) => id !== accountId);
			this.workerAgents.delete(accountId);
		}

		saveOrchestratorConfig(this.config, this.cwd);
		this.emitEvent({
			type: "account_switched",
			agentName: accountId,
			timestamp: Date.now(),
			data: { role: "security_auditor", enabled },
		});
	}

	public toggleWorkerAccount(accountId: string, enabled?: boolean): void {
		const isCurrentlyActive = this.config.activeWorkers.includes(accountId);
		const targetState = enabled !== undefined ? enabled : !isCurrentlyActive;

		if (targetState) {
			// If this account was the security auditor, reassign auditor to fallback
			if (this.config.securityAuditorAccount === accountId) {
				const fallback =
					["xai", "google-antigravity-3", "google-antigravity-2"].find(
						(id) => id !== accountId && id !== this.config.masterAccount,
					) || "xai";
				this.config.securityAuditorAccount = fallback;
				this.securityAuditor.setAuditorAccount(fallback);
			}

			if (!isCurrentlyActive) {
				this.config.activeWorkers.push(accountId);
				this.workerAgents.set(accountId, new WorkerAgent(accountId));
			}
		} else if (isCurrentlyActive) {
			this.config.activeWorkers = this.config.activeWorkers.filter((id) => id !== accountId);
			this.workerAgents.delete(accountId);
		}
		saveOrchestratorConfig(this.config, this.cwd);
	}

	public setAccountRole(accountId: string, role: AgentRole): void {
		if (role === "master") {
			this.setMasterAccount(accountId);
			return;
		}
		if (role === "security_auditor") {
			this.setSecurityAuditor(accountId, true);
			return;
		}
		if (role === "worker") {
			this.toggleWorkerAccount(accountId, true);
			return;
		}
		if (role === "idle") {
			this.toggleWorkerAccount(accountId, false);
			if (this.config.securityAuditorAccount === accountId) {
				const fallback =
					["xai", "google-antigravity-3", "google-antigravity-2"].find(
						(id) => id !== accountId && id !== this.config.masterAccount,
					) || "xai";
				this.config.securityAuditorAccount = fallback;
				this.securityAuditor.setAuditorAccount(fallback);
			}
			saveOrchestratorConfig(this.config, this.cwd);
		}
	}

	public getActiveWorkers(): string[] {
		return [...this.config.activeWorkers];
	}

	public setAgentModel(role: "master" | "worker" | "auditor", model: string, thinking?: ThinkingLevel): void {
		if (!this.config.models) {
			this.config.models = {
				master: { model: "gemini-3.8-flash", thinking: "high" },
				worker: { model: "gemini-3.8-flash", thinking: "low" },
				auditor: { model: "grok-beta", thinking: "off" },
			};
		}
		if (model) {
			this.config.models[role].model = model;
		}
		if (thinking) {
			this.config.models[role].thinking = thinking;
		}
		saveOrchestratorConfig(this.config, this.cwd);
	}

	private getStateFilePath(): string {
		return join(this.cwd, CONFIG_DIR_NAME, "orchestrator-state.json");
	}

	private saveState(): void {
		try {
			const dir = join(this.cwd, CONFIG_DIR_NAME);
			mkdirSync(dir, { recursive: true });
			const serializableTasks = Array.from(this.tasks.entries()).map(([k, v]) => [
				k,
				{
					task: v.task,
					status: v.status,
					result: v.result,
					diff: v.diff,
					workspacePath: v.workspacePath,
					error: v.error,
					securityAudit: v.securityAudit,
				},
			]);
			writeFileSync(
				this.getStateFilePath(),
				JSON.stringify(
					{
						taskCounter: this.taskCounter,
						mainTask: this.mainTask,
						tasks: serializableTasks,
					},
					null,
					2,
				),
				"utf-8",
			);
		} catch {
			// Best-effort
		}
	}

	private loadState(): void {
		try {
			const filePath = this.getStateFilePath();
			if (!existsSync(filePath)) return;
			const data = JSON.parse(readFileSync(filePath, "utf-8"));
			if (data.taskCounter) this.taskCounter = data.taskCounter;
			if (data.mainTask) this.mainTask = data.mainTask;
			if (Array.isArray(data.tasks)) {
				for (const [k, v] of data.tasks) {
					this.tasks.set(k, v);
				}
			}
		} catch {
			// Best-effort
		}
	}

	public addEventListener(listener: (event: OrchestratorEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emitEvent(event: OrchestratorEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (e) {
				console.error("Error in orchestrator event listener:", e);
			}
		}
	}

	public setMainTask(title: string, description?: string): void {
		this.mainTask = {
			title,
			description,
			status: "running",
		};
		this.master.setStatus("running", `Working on main task: ${title}`);
		this.logger.orchestration("INFO", `Main task set: "${title}"`);
		this.emitEvent({
			type: "main_task_updated",
			timestamp: Date.now(),
			data: this.mainTask,
		});
		this.saveState();
	}

	public getMainTask(): MainTaskInfo | undefined {
		return this.mainTask;
	}

	public async createTask(params: CreateTaskParams): Promise<WorkerTask> {
		this.taskCounter++;
		const taskId = params.taskId || `worker-${String(this.taskCounter).padStart(3, "0")}`;

		// Select worker agent (explicit or round-robin)
		let targetAgent = params.agent;
		if (!targetAgent || !this.config.activeWorkers.includes(targetAgent)) {
			// Select least busy worker
			const active = this.config.activeWorkers;
			targetAgent = active.length > 0 ? active[(this.taskCounter - 1) % active.length] : "worker";
		}

		const task: WorkerTask = {
			agent: targetAgent,
			task_id: taskId,
			title: params.title,
			description: params.description,
			scope: params.scope,
			allowed_files: params.allowed_files,
			run_tests: params.run_tests ?? false,
			test_command: params.test_command,
			timeout_ms: params.timeout_ms ?? this.config.delegation.default_timeout_ms,
			createdAt: Date.now(),
		};

		const record: WorkerTaskRecord = {
			task,
			status: "queued",
		};

		this.tasks.set(taskId, record);
		this.logger.orchestration(
			"INFO",
			`[EVENT:task_created] Task ${taskId} created: "${params.title}" -> assigned to ${targetAgent}`,
		);

		this.emitEvent({
			type: "task_created",
			taskId,
			agentName: targetAgent,
			timestamp: Date.now(),
			data: task,
		});

		this.saveState();
		return task;
	}

	public async runWorkerTask(taskId: string, options: WorkerExecutionOptions = {}): Promise<TaskResult> {
		const record = this.tasks.get(taskId);
		if (!record) {
			throw new Error(`Task ${taskId} not found`);
		}

		const task = record.task;
		const workerAgent = this.getWorkerAgent(task.agent);

		record.status = "running";
		record.task.startedAt = Date.now();
		workerAgent.setStatus("running", `Executing: ${task.title}`);

		this.emitEvent({
			type: "task_started",
			taskId,
			agentName: task.agent,
			timestamp: Date.now(),
		});

		let workspace: WorkerWorkspace;
		try {
			workspace = await this.workspaceManager.createWorkspace(taskId);
			this.workspaces.set(taskId, workspace);
			record.workspacePath = workspace.workspacePath;
		} catch (err: any) {
			record.status = "failed";
			record.error = `Failed to create workspace: ${err.message}`;
			workerAgent.setStatus("failed", record.error);
			this.saveState();
			throw err;
		}

		let result: TaskResult;
		try {
			result = await workerAgent.executeTask(task, workspace, options);

			let diff = "";
			try {
				diff = await this.workspaceManager.getDiff(taskId);
				record.diff = diff;
				if (diff && diff.trim().length > 0) {
					result.patch_available = true;
					result.patch = diff;
				}
			} catch {
				// No diff
			}

			// Run Security Auditor check if enabled
			if (this.securityAuditor.isEnabled()) {
				this.emitEvent({
					type: "security_audit_started",
					taskId,
					agentName: this.securityAuditor.getAuditorAccount(),
					timestamp: Date.now(),
				});

				const audit = await this.securityAuditor.auditDiff(diff, result.files_changed, task.title);

				record.securityAudit = audit;
				result.securityAudit = audit;

				this.logger.orchestration(
					audit.passed ? "INFO" : "WARN",
					`Security Audit for ${taskId} (${audit.auditedBy}): ${audit.passed ? "PASSED" : "FAILED"} [severity: ${audit.severity}]`,
				);

				this.emitEvent({
					type: "security_audit_completed",
					taskId,
					agentName: audit.auditedBy,
					timestamp: Date.now(),
					data: audit,
				});

				if (!audit.passed && this.config.review.require_security_approval) {
					record.status = "security_failed";
					result.status = "security_failed";
					workerAgent.setStatus("failed", `Security audit failed: ${audit.findings[0]}`);
					this.saveState();
					return result;
				}
			}

			record.result = result;
			record.status = result.status;
			record.task.completedAt = Date.now();

			workerAgent.setStatus("idle", `Completed: ${task.title}`);
			this.logger.orchestration(
				"INFO",
				`Task ${taskId} completed by ${task.agent}. Files changed: ${result.files_changed.length}`,
			);

			this.emitEvent({
				type: "task_completed",
				taskId,
				agentName: task.agent,
				timestamp: Date.now(),
				data: result,
			});

			// Autonomous Idle Task: Skill Extraction & Documentation update
			if (this.config.idleWork?.autoIdleWork && record.status === "completed") {
				try {
					if (this.config.idleWork.extractSkills) {
						workerAgent.setStatus("extracting_skills", `Extracting skill from ${task.title}`);
						const skill = await this.skillManager.extractSkillFromTask(record, task.agent);
						record.skillCreated = skill;
						result.skillCreated = skill;
						this.emitEvent({
							type: "skill_extracted",
							taskId,
							agentName: task.agent,
							timestamp: Date.now(),
							data: skill,
						});
					}
					if (this.config.idleWork.generateDocs) {
						workerAgent.setStatus("writing_docs", "Updating worker knowledge base docs");
						await this.skillManager.generateDocumentation(this.getTasks(), task.agent);
					}
				} catch {
					// best-effort idle task
				} finally {
					workerAgent.setStatus("idle");
				}
			}
		} catch (err: any) {
			record.status = "failed";
			record.error = err.message;
			workerAgent.setStatus("failed", err.message);

			result = {
				task_id: taskId,
				status: "failed",
				summary: `Task execution failed: ${err.message}`,
				files_changed: [],
				error: err.message,
			};
			record.result = result;

			this.emitEvent({
				type: "task_failed",
				taskId,
				agentName: task.agent,
				timestamp: Date.now(),
				data: { error: err.message },
			});
		}

		this.saveState();
		return result;
	}

	public async delegateTask(params: CreateTaskParams, options: WorkerExecutionOptions = {}): Promise<TaskResult> {
		const task = await this.createTask(params);
		return this.runWorkerTask(task.task_id, options);
	}

	public async approveTask(taskId: string, reviewNotes?: string): Promise<{ success: boolean; message: string }> {
		const record = this.tasks.get(taskId);
		if (!record) {
			return { success: false, message: `Task ${taskId} not found` };
		}

		if (record.status === "security_failed") {
			return {
				success: false,
				message: `Cannot approve task ${taskId}: Security audit flagged critical issues! Run audit review or reject task.`,
			};
		}

		const diff = record.diff || "";
		if (diff.trim().length > 0) {
			const filesChanged = record.result?.files_changed || [];
			const ownershipCheck = this.fileOwnership.canWorkerModify(filesChanged);
			if (!ownershipCheck.allowed) {
				return {
					success: false,
					message: `Approval rejected by FileOwnershipManager: ${ownershipCheck.reason}`,
				};
			}

			try {
				await this.workspaceManager.applyToTarget(taskId);
				this.logger.master("INFO", `Master approved task ${taskId} changes. ${reviewNotes || ""}`);
			} catch (err: any) {
				return {
					success: false,
					message: `Failed to apply worker changes: ${err.message}`,
				};
			}
		}

		record.status = "completed";
		this.emitEvent({
			type: "task_approved",
			taskId,
			timestamp: Date.now(),
			data: { reviewNotes },
		});

		try {
			await this.workspaceManager.cleanupWorkspace(taskId);
		} catch {
			// ignore cleanup errors
		}

		this.saveState();
		return { success: true, message: `Task ${taskId} successfully approved and merged.` };
	}

	public async rejectTask(taskId: string, reason: string): Promise<{ success: boolean; message: string }> {
		const record = this.tasks.get(taskId);
		if (!record) {
			return { success: false, message: `Task ${taskId} not found` };
		}

		record.status = "cancelled";
		record.error = `Rejected by Master: ${reason}`;
		this.logger.master("WARN", `Master rejected task ${taskId}: ${reason}`);

		this.emitEvent({
			type: "task_rejected",
			taskId,
			timestamp: Date.now(),
			data: { reason },
		});

		try {
			await this.workspaceManager.cleanupWorkspace(taskId);
		} catch {
			// ignore cleanup errors
		}

		this.saveState();
		return { success: true, message: `Task ${taskId} rejected. Workspace cleaned.` };
	}

	public async getStatus(forceRefreshQuotas = false): Promise<OrchestratorStatus> {
		const workersList: AgentInfo[] = [];
		for (const [id, agent] of this.workerAgents) {
			workersList.push({
				name: id,
				accountId: id,
				role: "worker",
				status: agent.status,
				currentActivity: agent.currentActivity,
				subtasks: [],
			});
		}

		const securityAuditorInfo: AgentInfo = {
			name: this.securityAuditor.getAuditorAccount(),
			accountId: this.securityAuditor.getAuditorAccount(),
			role: "security_auditor",
			status: this.securityAuditor.isEnabled() ? "idle" : "idle",
			currentActivity: this.securityAuditor.isEnabled() ? "Active / Monitoring code changes" : "Disabled",
			subtasks: [],
		};

		let accountsLimits: AccountLimits[] = [];
		try {
			accountsLimits = await fetchAllAccountLimits(forceRefreshQuotas);
			// Mark roles unambiguously
			for (const acc of accountsLimits) {
				acc.isMaster = acc.accountId === this.config.masterAccount;
				const isDesignatedAuditor =
					this.config.securityAuditorEnabled && acc.accountId === this.config.securityAuditorAccount;
				const isWorker = this.config.activeWorkers.includes(acc.accountId);

				if (acc.isMaster) {
					acc.role = "master";
					acc.isSecurityAuditor = false;
				} else if (isWorker) {
					acc.role = "worker";
					acc.isSecurityAuditor = false;
				} else if (isDesignatedAuditor) {
					acc.role = "security_auditor";
					acc.isSecurityAuditor = true;
				} else {
					acc.role = "idle";
					acc.isSecurityAuditor = false;
				}
			}
		} catch {
			// best effort
		}

		return {
			mainTask: this.mainTask,
			master: {
				name: this.config.masterAccount,
				accountId: this.config.masterAccount,
				role: "master",
				status: this.master.status,
				currentActivity: this.master.currentActivity,
				subtasks: [],
			},
			workers: workersList,
			securityAuditor: securityAuditorInfo,
			tasks: Array.from(this.tasks.values()),
			agentsCount: 1 + workersList.length + (this.securityAuditor.isEnabled() ? 1 : 0),
			accounts: accountsLimits,
			securityAuditEnabled: this.securityAuditor.isEnabled(),
			idleWorkEnabled: this.config.idleWork?.autoIdleWork ?? true,
			skillsCreated: this.skillManager.getSkills(),
			models: this.config.models || {
				master: { model: "gemini-3.8-flash", thinking: "high" },
				worker: { model: "gemini-3.8-flash", thinking: "low" },
				auditor: { model: "grok-beta", thinking: "off" },
			},
		};
	}

	public setAutoIdleWork(enabled: boolean): void {
		if (!this.config.idleWork) {
			this.config.idleWork = {
				autoIdleWork: enabled,
				extractSkills: true,
				generateDocs: true,
				assistSecurityAudit: true,
			};
		} else {
			this.config.idleWork.autoIdleWork = enabled;
		}
		saveOrchestratorConfig(this.config, this.cwd);
	}

	public async extractSkillFromTask(taskId: string): Promise<SkillExtractionResult> {
		const record = this.tasks.get(taskId);
		if (!record) {
			throw new Error(`Task ${taskId} not found`);
		}
		const skill = await this.skillManager.extractSkillFromTask(record, record.task.agent);
		record.skillCreated = skill;
		this.saveState();
		return skill;
	}

	public async updateDocumentation(): Promise<DocsGenerationResult> {
		return this.skillManager.generateDocumentation(this.getTasks(), this.config.masterAccount);
	}

	public getTasks(): WorkerTaskRecord[] {
		return Array.from(this.tasks.values());
	}

	public getTask(taskId: string): WorkerTaskRecord | undefined {
		return this.tasks.get(taskId);
	}
}
