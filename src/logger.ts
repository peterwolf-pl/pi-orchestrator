/**
 * Logging subsystem for Pi Multi-Agent AI Coding Orchestrator.
 * Records master.log, worker.log, orchestration.log.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "./config.ts";

function getAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export interface LogEntry {
	timestamp: string;
	level: "INFO" | "WARN" | "ERROR" | "DEBUG";
	component: "master" | "worker" | "orchestrator";
	taskId?: string;
	message: string;
	metadata?: Record<string, unknown>;
}

export class OrchestratorLogger {
	private readonly logDir: string;
	private readonly inMemoryLogs: LogEntry[] = [];
	private readonly maxInMemory: number = 500;

	constructor(cwd: string = process.cwd(), agentDirOverride?: string) {
		const baseDir = join(cwd, CONFIG_DIR_NAME);
		this.logDir = join(baseDir, "logs");
		try {
			mkdirSync(this.logDir, { recursive: true });
		} catch {
			// Fall back to agent dir logs if cwd is not writable
			const agentDir = agentDirOverride || getAgentDir();
			this.logDir = join(agentDir, "logs");
			try {
				mkdirSync(this.logDir, { recursive: true });
			} catch {
				// in-memory only fallback
			}
		}
	}

	getLogDirectory(): string {
		return this.logDir;
	}

	private writeToFile(filename: string, entry: LogEntry): void {
		const line = `[${entry.timestamp}] [${entry.level}] ${entry.taskId ? `[${entry.taskId}] ` : ""}${entry.message}${
			entry.metadata ? ` | ${JSON.stringify(entry.metadata)}` : ""
		}\n`;

		this.inMemoryLogs.push(entry);
		if (this.inMemoryLogs.length > this.maxInMemory) {
			this.inMemoryLogs.shift();
		}

		try {
			appendFileSync(join(this.logDir, filename), line, "utf-8");
		} catch {
			// Ignore file append errors (e.g. read-only filesystem)
		}
	}

	logMaster(message: string, metadata?: Record<string, unknown>, level: LogEntry["level"] = "INFO"): void {
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			component: "master",
			message,
			metadata,
		};
		this.writeToFile("master.log", entry);
		this.writeToFile("orchestration.log", entry);
	}

	logWorker(
		taskId: string,
		message: string,
		metadata?: Record<string, unknown>,
		level: LogEntry["level"] = "INFO",
	): void {
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			component: "worker",
			taskId,
			message,
			metadata,
		};
		this.writeToFile("worker.log", entry);
		this.writeToFile("orchestration.log", entry);
	}

	logOrchestration(
		event: string,
		message: string,
		taskId?: string,
		metadata?: Record<string, unknown>,
		level: LogEntry["level"] = "INFO",
	): void {
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			component: "orchestrator",
			taskId,
			message: `[EVENT:${event}] ${message}`,
			metadata,
		};
		this.writeToFile("orchestration.log", entry);
	}

	master(level: "INFO" | "WARN" | "ERROR" | "DEBUG", message: string): void {
		this.logMaster(message, undefined, level);
	}

	worker(level: "INFO" | "WARN" | "ERROR" | "DEBUG", message: string, taskId?: string): void {
		this.logWorker(taskId || "general", message, undefined, level);
	}

	orchestration(level: "INFO" | "WARN" | "ERROR" | "DEBUG", message: string, taskId?: string): void {
		this.logOrchestration("general", message, taskId, undefined, level);
	}

	readLogFile(filename: "master.log" | "worker.log" | "orchestration.log"): string {
		const filePath = join(this.logDir, filename);
		if (existsSync(filePath)) {
			try {
				return readFileSync(filePath, "utf-8");
			} catch {
				return "";
			}
		}
		return "";
	}

	getRecentLogs(options?: {
		component?: "master" | "worker" | "orchestrator";
		taskId?: string;
		limit?: number;
	}): LogEntry[] {
		let logs = [...this.inMemoryLogs];

		if (logs.length === 0) {
			const filename = options?.component
				? options.component === "master"
					? "master.log"
					: options.component === "worker"
						? "worker.log"
						: "orchestration.log"
				: "orchestration.log";
			const content = this.readLogFile(filename as any);
			if (content) {
				const lines = content.split("\n").filter((l) => l.trim().length > 0);
				for (const l of lines) {
					const match = l.match(/^\[(.*?)\] \[(.*?)\] (?:\[(.*?)\] )?(.*)$/);
					if (match) {
						logs.push({
							timestamp: match[1],
							level: match[2] as any,
							component: options?.component || "orchestrator",
							taskId: match[3],
							message: match[4],
						});
					} else {
						logs.push({
							timestamp: new Date().toISOString(),
							level: "INFO",
							component: options?.component || "orchestrator",
							message: l,
						});
					}
				}
			}
		}

		if (options?.component) {
			logs = logs.filter((l) => l.component === options.component);
		}
		if (options?.taskId) {
			logs = logs.filter((l) => l.taskId === options.taskId);
		}
		const limit = options?.limit ?? 50;
		return logs.slice(-limit);
	}
}
