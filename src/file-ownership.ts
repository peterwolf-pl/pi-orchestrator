/**
 * Lightweight file ownership manager for Pi Multi-Agent Orchestration.
 * Prevents race conditions and accidental overwrites between Master and Worker.
 */

import { relative, resolve } from "node:path";

export interface OwnershipDecision {
	allowed: boolean;
	isReadOnly: boolean;
	owner: "master" | "worker" | "unassigned";
	reason?: string;
}

export class FileOwnershipManager {
	private readonly masterFiles: Set<string> = new Set();
	private readonly workerAllowedFiles: Map<string, Set<string>> = new Map(); // taskId -> relative normalized file paths
	private readonly rootDir: string;

	constructor(rootDir: string = process.cwd()) {
		this.rootDir = resolve(rootDir);
	}

	private normalize(filePath: string): string {
		const abs = resolve(this.rootDir, filePath);
		const rel = relative(this.rootDir, abs).replace(/\\/g, "/");
		return rel;
	}

	registerMasterFiles(files: string[]): void {
		for (const file of files) {
			this.masterFiles.add(this.normalize(file));
		}
	}

	claimFile(filePath: string, owner: "master" | "worker" = "master"): void {
		if (owner === "master") {
			this.masterFiles.add(this.normalize(filePath));
		}
	}

	assignWorkerFiles(taskId: string, files: string[]): void {
		const set = this.workerAllowedFiles.get(taskId) ?? new Set();
		for (const file of files) {
			set.add(this.normalize(file));
		}
		this.workerAllowedFiles.set(taskId, set);
	}

	clearWorkerFiles(taskId: string): void {
		this.workerAllowedFiles.delete(taskId);
	}

	getMasterFiles(): string[] {
		return Array.from(this.masterFiles);
	}

	getWorkerAllowedFiles(taskId: string): string[] {
		const files = this.workerAllowedFiles.get(taskId);
		return files ? Array.from(files) : [];
	}

	checkWorkerFileAccess(taskId: string, filePath: string, isWriteOperation: boolean = false): OwnershipDecision {
		const normalized = this.normalize(filePath);
		const allowedSet = this.workerAllowedFiles.get(taskId);

		// Read access is generally allowed for inspection/analysis
		if (!isWriteOperation) {
			return {
				allowed: true,
				isReadOnly: false,
				owner: this.masterFiles.has(normalized) ? "master" : "unassigned",
			};
		}

		// Write operation checks:
		// 1. If file is master-owned, worker is strictly read-only on it!
		if (this.masterFiles.has(normalized)) {
			return {
				allowed: false,
				isReadOnly: true,
				owner: "master",
				reason: `File "${normalized}" is owned by Master (Antigravity). Antigravity2 must return a patch/diff instead of modifying directly.`,
			};
		}

		// 2. If task has an explicit allowed_files list, check if it's included
		if (allowedSet && allowedSet.size > 0) {
			const isAllowed = allowedSet.has(normalized);
			return {
				allowed: isAllowed,
				isReadOnly: !isAllowed,
				owner: isAllowed ? "worker" : "unassigned",
				reason: isAllowed
					? undefined
					: `File "${normalized}" is outside worker task allowed_files scope. Modifications must be reviewed by Master.`,
			};
		}

		// If no explicit allowed_files were specified, but it's not a master file
		return {
			allowed: true,
			isReadOnly: false,
			owner: "worker",
		};
	}

	canWorkerModify(files: string[], taskId = "general"): { allowed: boolean; reason?: string } {
		for (const file of files) {
			const decision = this.checkWorkerFileAccess(taskId, file, true);
			if (!decision.allowed) {
				return { allowed: false, reason: decision.reason };
			}
		}
		return { allowed: true };
	}
}
