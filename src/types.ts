/**
 * Core type definitions for Pi Multi-Agent AI Coding Orchestrator.
 * Orchestrates Master, Multiple Workers (Antigravity & xAI), Security Auditor,
 * and autonomous Skill & Documentation managers.
 */

export type AgentRole = "master" | "worker" | "security_auditor" | "skill_manager" | "docs_generator" | "idle";

export type AgentState =
	| "idle"
	| "running"
	| "waiting"
	| "reviewing"
	| "auditing"
	| "extracting_skills"
	| "writing_docs"
	| "failed";

export type WorkerStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "blocked"
	| "needs_master_review"
	| "needs_security_audit"
	| "security_failed"
	| "timeout";

export interface TaskTestResult {
	command?: string;
	status: "passed" | "failed" | "skipped";
	output?: string;
}

export interface SecurityAuditResult {
	passed: boolean;
	severity: "clean" | "low" | "medium" | "high" | "critical";
	findings: string[];
	recommendations: string[];
	auditedBy: string; // accountId
	auditedAt: number;
}

export interface SkillExtractionResult {
	skillName: string;
	filePath: string;
	title: string;
	description: string;
	tags: string[];
	createdAt: number;
	extractedFromTaskId?: string;
}

export interface DocsGenerationResult {
	filePath: string;
	summary: string;
	generatedAt: number;
}

export interface WorkerTask {
	agent: string; // e.g. "google-antigravity-2", "google-antigravity-3", "google-antigravity-4", "xai"
	task_id: string; // e.g. "worker-001"
	title: string;
	description: string;
	scope?: string[];
	allowed_files?: string[];
	run_tests?: boolean;
	test_command?: string;
	timeout_ms?: number;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
}

export interface TaskResult {
	task_id: string;
	status: WorkerStatus;
	summary: string;
	findings?: string;
	files_changed: string[];
	tests?: TaskTestResult;
	securityAudit?: SecurityAuditResult;
	skillCreated?: SkillExtractionResult;
	problems?: string;
	recommendation?: string;
	patch_available?: boolean;
	patch?: string;
	raw_output?: string;
	error?: string;
}

export interface WorkerTaskRecord {
	task: WorkerTask;
	status: WorkerStatus;
	result?: TaskResult;
	diff?: string;
	workspacePath?: string;
	error?: string;
	securityAudit?: SecurityAuditResult;
	skillCreated?: SkillExtractionResult;
}

export interface QuotaBucketInfo {
	displayName: string;
	window?: string; // "5h", "weekly", etc.
	remainingFraction: number; // 0..1
	resetTime?: string;
	resetFormatted: string; // e.g. "2h 15m", "5d 14h", "now"
}

export interface AccountLimits {
	accountId: string; // "antigravity", "google-antigravity-2", "google-antigravity-3", "google-antigravity-4", "xai"
	provider: "antigravity" | "xai" | "google" | "other";
	label?: string; // "liam", "3", "4", etc.
	planLabel?: string; // "Google AI Pro (g1-pro-tier)"
	role: AgentRole;
	enabled: boolean;
	isMaster: boolean;
	isSecurityAuditor: boolean;
	fiveHourRemaining?: number; // percentage 0..100
	weeklyRemaining?: number; // percentage 0..100
	fiveHourReset?: string;
	weeklyReset?: string;
	modelsQuota?: Array<{
		modelId: string;
		remainingFraction: number;
		resetTime?: string;
		resetFormatted: string;
	}>;
	lastUpdated?: number;
	status: "active" | "cooling_down" | "rate_limited" | "error" | "ready";
	error?: string;
}

export interface AccountConfig {
	id: string;
	role: AgentRole;
	enabled: boolean;
	label?: string;
	provider: string;
}

export interface IdleWorkConfig {
	autoIdleWork: boolean; // if true, idle workers automatically extract skills and update documentation
	extractSkills: boolean;
	generateDocs: boolean;
	assistSecurityAudit: boolean;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentModelConfig {
	model: string;
	thinking: ThinkingLevel;
}

export interface OrchestratorModelSettings {
	master: AgentModelConfig;
	worker: AgentModelConfig;
	auditor: AgentModelConfig;
}

export interface OrchestratorConfig {
	masterAccount: string; // default "antigravity"
	securityAuditorAccount: string; // default "xai" or "google-antigravity-3"
	securityAuditorEnabled: boolean; // toggle whether security audit is active
	activeWorkers: string[]; // which accounts participate as workers
	accounts: Record<string, AccountConfig>;
	models: OrchestratorModelSettings;
	idleWork: IdleWorkConfig;
	delegation: {
		enabled: boolean;
		automatic: boolean;
		max_workers: number;
		default_timeout_ms: number;
	};
	workspace: {
		isolated_workers: boolean;
		worktree_dir?: string;
	};
	review: {
		automatic_merge: boolean;
		require_security_approval: boolean;
	};
}

export interface AgentInfo {
	name: string;
	accountId: string;
	role: AgentRole;
	status: AgentState;
	currentActivity?: string;
	subtasks: string[];
}

export interface MainTaskInfo {
	title: string;
	description?: string;
	status: "pending" | "running" | "completed" | "failed";
}

export interface OrchestratorStatus {
	mainTask?: MainTaskInfo;
	master: AgentInfo;
	workers: AgentInfo[];
	securityAuditor?: AgentInfo;
	skillManager?: AgentInfo;
	tasks: WorkerTaskRecord[];
	agentsCount: number;
	accounts: AccountLimits[];
	securityAuditEnabled: boolean;
	idleWorkEnabled: boolean;
	skillsCreated: SkillExtractionResult[];
	models?: OrchestratorModelSettings;
}

export type OrchestratorEventType =
	| "task_created"
	| "task_started"
	| "task_completed"
	| "task_failed"
	| "task_cancelled"
	| "task_timeout"
	| "task_approved"
	| "task_rejected"
	| "security_audit_started"
	| "security_audit_completed"
	| "skill_extracted"
	| "documentation_generated"
	| "agent_state_changed"
	| "account_switched"
	| "quota_updated"
	| "main_task_updated";

export interface OrchestratorEvent {
	type: OrchestratorEventType;
	taskId?: string;
	agentName?: string;
	accountId?: string;
	timestamp: number;
	data?: unknown;
}
