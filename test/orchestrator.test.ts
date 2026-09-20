/**
 * Automated test suite for Pi Antigravity Multi-Agent Orchestrator.
 * Tests cover:
 * 1. Master agent setup & multi-account discovery
 * 2. Worker pool setup
 * 3. Task creation with structured schema
 * 4. Isolated worktree & prompt execution
 * 5. Task completion & result propagation
 * 6. Worker failure isolation (does not block master)
 * 7. Worker timeout handling
 * 8. File ownership protection
 * 9. Git diff reviewing
 * 10. Manual approval requirement
 * 11. Security Auditor secret leak detection
 * 12. Security Auditor dangerous shell command detection
 * 13. Security Auditor clean approval
 * 14. Real-time Quota reset formatting
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	FileOwnershipManager,
	formatResetCountdown,
	Orchestrator,
	SecurityAuditor,
	WorkerAgent,
	type WorkerTask,
} from "../src/index.ts";

describe("Pi Multi-Agent Orchestrator (Multi-Account & Security)", () => {
	let testDir: string;
	let orchestrator: Orchestrator;

	beforeEach(() => {
		testDir = join(process.cwd(), `.tmp-orchestrator-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		orchestrator = new Orchestrator(testDir);
	});

	afterEach(() => {
		try {
			rmSync(testDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup error
		}
	});

	it("1. master starts with correct identity and role", () => {
		const master = orchestrator.master;
		expect(master.name).toBeDefined();
		expect(master.role).toBe("master");
		expect(master.status).toBe("idle");
	});

	it("2. worker agents are active in pool", () => {
		const workers = orchestrator.getActiveWorkers();
		expect(workers.length).toBeGreaterThan(0);
	});

	it("3. master creates worker task with structured schema", async () => {
		const task = await orchestrator.createTask({
			title: "Investigate database connection leak",
			description: "Find why connection pool runs out of sockets under load.",
			scope: ["src/db"],
			allowed_files: ["src/db/pool.ts"],
			run_tests: true,
			test_command: "echo test-passed",
		});

		expect(task.task_id).toBeDefined();
		expect(task.agent).toBeDefined();
		expect(task.title).toBe("Investigate database connection leak");
		expect(task.allowed_files).toEqual(["src/db/pool.ts"]);

		const record = orchestrator.getTask(task.task_id);
		expect(record).toBeDefined();
		expect(record?.status).toBe("queued");
	});

	it("4. worker builds isolated prompt context", () => {
		const task: WorkerTask = {
			agent: "worker-agent",
			task_id: "worker-001",
			title: "Optimize API latency",
			description: "Profile redis queries",
			scope: ["src/cache"],
			allowed_files: ["src/cache/redis.ts"],
			run_tests: true,
			test_command: "npm test",
			createdAt: Date.now(),
		};

		const agent = new WorkerAgent("worker-agent");
		const prompt = agent.buildWorkerPrompt(task, "/tmp/workspace");
		expect(prompt).toContain("worker-agent");
		expect(prompt).toContain("Optimize API latency");
		expect(prompt).toContain("/tmp/workspace");
		expect(prompt).toContain("npm test");
	});

	it("5. worker runs task and produces task result", async () => {
		const task = await orchestrator.createTask({
			title: "Refactor auth middleware",
			description: "Replace legacy session checks with JWT verification.",
		});

		const result = await orchestrator.runWorkerTask(task.task_id, {
			runTurn: async (_prompt, workspacePath) => {
				writeFileSync(join(workspacePath, "auth.ts"), "// JWT auth\nexport const auth = () => true;");
				return "Refactor complete. Updated auth.ts.";
			},
		});

		expect(result.status).toBe("completed");
		expect(result.summary).toContain("Refactor complete");
		expect(result.files_changed).toContain("auth.ts");
	});

	it("6. worker failure does not block master agent", async () => {
		const task = await orchestrator.createTask({
			title: "Failing subtask",
			description: "This task throws an error.",
		});

		const result = await orchestrator.runWorkerTask(task.task_id, {
			runTurn: async () => {
				throw new Error("Worker out of memory simulated error");
			},
		});

		expect(result.status).toBe("failed");
		expect(result.error).toContain("Worker out of memory");
		expect(orchestrator.master.status).toBe("idle");
	});

	it("7. worker timeout terminates cleanly", async () => {
		const worker = new WorkerAgent("worker-test");
		const task: WorkerTask = {
			agent: "worker-test",
			task_id: "worker-timeout-test",
			title: "Infinite loop task",
			description: "Task that hangs",
			timeout_ms: 100,
			createdAt: Date.now(),
		};

		const result = await worker.executeTask(task, testDir, {
			runTurn: async () => {
				await new Promise((resolve) => setTimeout(resolve, 500));
				return "done";
			},
		});

		expect(result.status).toBe("timeout");
		expect(result.summary).toContain("timed out");
	});

	it("8. file ownership prevents unauthorized worker overwrite", () => {
		const ownership = new FileOwnershipManager(testDir);
		ownership.claimFile("src/core/security.ts", "master");

		const check1 = ownership.canWorkerModify(["src/core/security.ts"]);
		expect(check1.allowed).toBe(false);
		expect(check1.reason).toContain("owned by Master");

		const check2 = ownership.canWorkerModify(["src/utils/math.ts"]);
		expect(check2.allowed).toBe(true);
	});

	it("9. diff is inspectable in worker record", async () => {
		const task = await orchestrator.createTask({
			title: "Add helper utility",
			description: "Create string helper",
		});

		await orchestrator.runWorkerTask(task.task_id, {
			runTurn: async (_prompt, workspacePath) => {
				writeFileSync(join(workspacePath, "helper.ts"), "export const capitalize = (s: string) => s;");
				return "Created helper.ts";
			},
		});

		const diff = await orchestrator.workspaceManager.getDiff(task.task_id);
		expect(diff).toContain("helper.ts");
	});

	it("10. worker changes require explicit master approval", async () => {
		const task = await orchestrator.createTask({
			title: "Add config option",
			description: "Add new config field",
		});

		await orchestrator.runWorkerTask(task.task_id, {
			runTurn: async (_prompt, workspacePath) => {
				writeFileSync(join(workspacePath, "config.json"), '{"port": 8080}');
				return "Added port config";
			},
		});

		// Ensure file does not exist in master target directory before approval
		expect(existsSync(join(testDir, "config.json"))).toBe(false);

		// Now master approves
		const approval = await orchestrator.approveTask(task.task_id, "Looks good");
		expect(approval.success).toBe(true);
		expect(existsSync(join(testDir, "config.json"))).toBe(true);
	});

	it("11. Security Auditor detects leaked AWS access keys", async () => {
		const auditor = new SecurityAuditor("xai", true);
		const leakedDiff = `
diff --git a/aws.ts b/aws.ts
+ const AWS_KEY = "AKIA1234567890ABCDEF";
`;
		const audit = await auditor.auditDiff(leakedDiff, ["aws.ts"], "AWS Integration");
		expect(audit.passed).toBe(false);
		expect(audit.severity).toBe("critical");
		expect(audit.findings.some((f) => f.includes("AWS Access Key"))).toBe(true);
	});

	it("12. Security Auditor detects dangerous shell commands", async () => {
		const auditor = new SecurityAuditor("xai", true);
		const dangerousDiff = `
diff --git a/install.sh b/install.sh
+ rm -rf /
`;
		const audit = await auditor.auditDiff(dangerousDiff, ["install.sh"], "Installer");
		expect(audit.passed).toBe(false);
		expect(audit.severity).toBe("critical");
		expect(audit.findings.some((f) => f.includes("root/system deletion"))).toBe(true);
	});

	it("13. Security Auditor approves clean code changes", async () => {
		const auditor = new SecurityAuditor("xai", true);
		const cleanDiff = `
diff --git a/math.ts b/math.ts
+ export function add(a: number, b: number): number {
+   return a + b;
+ }
`;
		const audit = await auditor.auditDiff(cleanDiff, ["math.ts"], "Math utility");
		expect(audit.passed).toBe(true);
		expect(audit.severity).toBe("clean");
		expect(audit.findings[0]).toContain("passed");
	});

	it("14. formatResetCountdown formats durations correctly", () => {
		const future1 = new Date(Date.now() + 2 * 3600 * 1000 + 15 * 60 * 1000).toISOString();
		expect(formatResetCountdown(future1)).toContain("in 2h");

		const future2 = new Date(Date.now() + 5 * 24 * 3600 * 1000 + 4 * 3600 * 1000).toISOString();
		expect(formatResetCountdown(future2)).toContain("in 5d");

		const past = new Date(Date.now() - 1000).toISOString();
		expect(formatResetCountdown(past)).toBe("ready / now");
	});

	it("15. Skill Manager extracts reusable skill to .pi/skills/ from completed task", async () => {
		const task = await orchestrator.createTask({
			title: "Redis rate limiting configuration",
			description: "Configure sliding window rate limiting in Redis.",
		});

		await orchestrator.runWorkerTask(task.task_id, {
			runTurn: async (_prompt, workspacePath) => {
				writeFileSync(join(workspacePath, "rate-limit.ts"), "// Rate limiter\nexport const limit = 100;");
				return "Configured Redis rate limiting with sliding window.";
			},
		});

		const skill = await orchestrator.extractSkillFromTask(task.task_id);
		expect(skill.skillName).toBe("redis-rate-limiting-configuration");
		expect(existsSync(join(testDir, skill.filePath))).toBe(true);

		const content = readFileSync(join(testDir, skill.filePath), "utf-8");
		expect(content).toContain("Redis rate limiting configuration");
		expect(content).toContain("Context & Problem");
	});

	it("16. Autonomous Documentation updates knowledge base docs", async () => {
		const task = await orchestrator.createTask({
			title: "Setup PostgreSQL connection pool",
			description: "Configure max connection pooling and keep-alives.",
		});

		await orchestrator.runWorkerTask(task.task_id, {
			runTurn: async (_prompt, workspacePath) => {
				writeFileSync(join(workspacePath, "pool.ts"), "export const poolSize = 20;");
				return "Completed pool configuration.";
			},
		});

		const docResult = await orchestrator.updateDocumentation();
		expect(existsSync(join(testDir, docResult.filePath))).toBe(true);

		const docContent = readFileSync(join(testDir, docResult.filePath), "utf-8");
		expect(docContent).toContain("Setup PostgreSQL connection pool");
		expect(docContent).toContain("Worker Knowledge Base");
	});
});
