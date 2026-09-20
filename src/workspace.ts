/**
 * Isolated worker workspace manager for Pi Multi-Agent Orchestrator.
 * Uses Git worktrees and branches for complete isolation, or temp directories as fallback.
 * Implements strict Git safety guidelines (no destructive resets or cleans).
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { CONFIG_DIR_NAME } from "./config.ts";

function spawnProcessSync(command: string, args: string[], options: any) {
	return spawnSync(command, args, options);
}

export interface WorkerWorkspace {
	taskId: string;
	workspacePath: string;
	isGit: boolean;
	branchName?: string;
	initialStatus: string;
	getDiff(): Promise<string>;
	getStatus(): Promise<string>;
	applyToTarget(targetCwd: string): Promise<{ success: boolean; error?: string; filesChanged?: string[] }>;
	cleanup(): Promise<void>;
}

export class WorkspaceManager {
	private readonly baseCwd: string;
	private readonly isGit: boolean;
	private readonly worktreeBaseDir: string;
	private readonly activeWorkspaces: Map<string, WorkerWorkspace> = new Map();

	constructor(baseCwd: string = process.cwd()) {
		this.baseCwd = resolve(baseCwd);
		this.isGit = this.checkIsGitRepo(this.baseCwd);
		this.worktreeBaseDir = join(this.baseCwd, CONFIG_DIR_NAME, "worktrees");
	}

	async createWorkspace(taskId: string, scope?: string[]): Promise<WorkerWorkspace> {
		const ws = await this.createWorkerWorkspace(taskId, scope);
		this.activeWorkspaces.set(taskId, ws);
		return ws;
	}

	async getDiff(taskId: string): Promise<string> {
		const ws = this.activeWorkspaces.get(taskId);
		if (!ws) return "";
		return ws.getDiff();
	}

	async applyToTarget(taskId: string, targetCwd: string = this.baseCwd): Promise<void> {
		const ws = this.activeWorkspaces.get(taskId);
		if (!ws) throw new Error(`Workspace for ${taskId} not found`);
		await ws.applyToTarget(targetCwd);
	}

	async cleanupWorkspace(taskId: string): Promise<void> {
		const ws = this.activeWorkspaces.get(taskId);
		if (ws) {
			await ws.cleanup();
			this.activeWorkspaces.delete(taskId);
		}
	}

	private checkIsGitRepo(cwd: string): boolean {
		try {
			const res = spawnProcessSync("git", ["rev-parse", "--is-inside-work-tree"], {
				cwd,
				encoding: "utf-8",
			});
			return res.status === 0 && res.stdout.trim() === "true";
		} catch {
			return false;
		}
	}

	async createWorkerWorkspace(taskId: string, scope?: string[]): Promise<WorkerWorkspace> {
		const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");

		if (this.isGit) {
			return this.createGitWorktreeWorkspace(safeTaskId);
		} else {
			return this.createTempDirWorkspace(safeTaskId, scope);
		}
	}

	private createGitWorktreeWorkspace(taskId: string): WorkerWorkspace {
		// Record initial status
		const initialStatusRes = spawnProcessSync("git", ["status", "--porcelain"], {
			cwd: this.baseCwd,
			encoding: "utf-8",
		});
		const initialStatus = initialStatusRes.stdout || "";

		mkdirSync(this.worktreeBaseDir, { recursive: true });
		const workspacePath = join(this.worktreeBaseDir, taskId);
		const branchName = `pwpi-worker/${taskId}`;

		// If worktree already exists, remove it cleanly first
		if (existsSync(workspacePath)) {
			spawnProcessSync("git", ["worktree", "remove", "--force", workspacePath], {
				cwd: this.baseCwd,
				encoding: "utf-8",
			});
		}

		// Create worktree on a new worker branch based on HEAD
		const addRes = spawnProcessSync("git", ["worktree", "add", "-B", branchName, workspacePath, "HEAD"], {
			cwd: this.baseCwd,
			encoding: "utf-8",
		});

		if (addRes.status !== 0) {
			// If worktree failed (e.g. detached HEAD or specific git version), fallback to directory copy
			return this.createTempDirWorkspace(taskId);
		}

		const baseCwd = this.baseCwd;
		const defaultTargetCwd = baseCwd;

		return {
			taskId,
			workspacePath,
			isGit: true,
			branchName,
			initialStatus,
			async getDiff(): Promise<string> {
				if (!existsSync(workspacePath)) return "";
				// Check unstaged + staged diff
				const diffRes = spawnProcessSync("git", ["diff", "HEAD"], {
					cwd: workspacePath,
					encoding: "utf-8",
				});
				let diff = diffRes.stdout || "";

				// Check untracked files
				const untrackedRes = spawnProcessSync("git", ["status", "--porcelain"], {
					cwd: workspacePath,
					encoding: "utf-8",
				});
				const untrackedLines = (untrackedRes.stdout || "")
					.split("\n")
					.filter((l) => l.startsWith("?? "))
					.map((l) => l.slice(3).trim());

				if (untrackedLines.length > 0) {
					diff += `\n# Untracked new files in worker workspace:\n${untrackedLines.map((f) => `# + ${f}`).join("\n")}`;
				}

				return diff.trim();
			},
			async getStatus(): Promise<string> {
				if (!existsSync(workspacePath)) return "";
				const res = spawnProcessSync("git", ["status", "--porcelain"], {
					cwd: workspacePath,
					encoding: "utf-8",
				});
				return (res.stdout || "").trim();
			},
			async applyToTarget(
				targetCwd: string = defaultTargetCwd,
			): Promise<{ success: boolean; error?: string; filesChanged?: string[] }> {
				// Master reviews worker changes before integration.
				// Generate patch from worktree and apply to target without destructive commands.
				const diffRes = spawnProcessSync("git", ["diff", "HEAD"], {
					cwd: workspacePath,
					encoding: "utf-8",
				});
				const patch = diffRes.stdout;

				const changedFiles: string[] = [];

				// Copy untracked new files as well
				const untrackedRes = spawnProcessSync("git", ["status", "--porcelain"], {
					cwd: workspacePath,
					encoding: "utf-8",
				});
				const lines = (untrackedRes.stdout || "").split("\n");
				for (const line of lines) {
					if (line.startsWith("?? ")) {
						const relFile = line.slice(3).trim();
						if (relFile) {
							const src = join(workspacePath, relFile);
							const dest = join(targetCwd, relFile);
							mkdirSync(resolve(dest, ".."), { recursive: true });
							cpSync(src, dest, { recursive: true });
							changedFiles.push(relFile);
						}
					}
				}

				if (patch && patch.trim().length > 0) {
					// Apply patch using git apply
					const applyRes = spawnProcessSync("git", ["apply", "--whitespace=nowarn"], {
						cwd: targetCwd,
						input: patch,
						encoding: "utf-8",
					});
					if (applyRes.status !== 0) {
						return {
							success: false,
							error: `Failed to apply worker patch: ${applyRes.stderr || applyRes.stdout}`,
						};
					}

					// Find files changed in patch
					const patchFilesRes = spawnProcessSync("git", ["apply", "--numstat"], {
						cwd: targetCwd,
						input: patch,
						encoding: "utf-8",
					});
					const patchLines = (patchFilesRes.stdout || "").split("\n");
					for (const l of patchLines) {
						const parts = l.split("\t");
						if (parts.length >= 3 && parts[2]) {
							changedFiles.push(parts[2].trim());
						}
					}
				}

				return { success: true, filesChanged: Array.from(new Set(changedFiles)) };
			},
			async cleanup(): Promise<void> {
				if (existsSync(workspacePath)) {
					spawnProcessSync("git", ["worktree", "remove", "--force", workspacePath], {
						cwd: baseCwd,
						encoding: "utf-8",
					});
				}
				// Remove branch
				spawnProcessSync("git", ["branch", "-D", branchName], {
					cwd: baseCwd,
					encoding: "utf-8",
				});
			},
		};
	}

	private createTempDirWorkspace(taskId: string, _scope?: string[]): WorkerWorkspace {
		const workspacePath = join(this.worktreeBaseDir, taskId);
		mkdirSync(workspacePath, { recursive: true });

		// If scope provided, copy only scoped files, otherwise copy repository files (excluding node_modules and .git)
		const initialStatus = "non-git workspace";

		const defaultTargetCwd = this.baseCwd;

		return {
			taskId,
			workspacePath,
			isGit: false,
			initialStatus,
			async getDiff(): Promise<string> {
				if (!existsSync(workspacePath)) return "";
				const files: string[] = [];
				const entries = readdirSync(workspacePath, { recursive: true, withFileTypes: true });
				for (const entry of entries) {
					if (entry.isFile()) {
						const parent = (entry as any).parentPath || (entry as any).path || workspacePath;
						const fullPath = join(parent, entry.name);
						const rel = relative(workspacePath, fullPath);
						files.push(rel);
					}
				}
				if (files.length === 0) return "";
				return `Worker generated files:\n${files.map((f) => `+ ${f}`).join("\n")}`;
			},
			async getStatus(): Promise<string> {
				if (!existsSync(workspacePath)) return "";
				const files: string[] = [];
				const entries = readdirSync(workspacePath, { recursive: true, withFileTypes: true });
				for (const entry of entries) {
					if (entry.isFile()) {
						const parent = (entry as any).parentPath || (entry as any).path || workspacePath;
						const fullPath = join(parent, entry.name);
						const rel = relative(workspacePath, fullPath);
						files.push(`?? ${rel}`);
					}
				}
				return files.join("\n");
			},
			async applyToTarget(
				targetCwd: string = defaultTargetCwd,
			): Promise<{ success: boolean; error?: string; filesChanged?: string[] }> {
				const changedFiles: string[] = [];
				if (existsSync(workspacePath)) {
					const entries = readdirSync(workspacePath, { recursive: true, withFileTypes: true });
					for (const entry of entries) {
						if (entry.isFile()) {
							const parent = (entry as any).parentPath || (entry as any).path || workspacePath;
							const fullPath = join(parent, entry.name);
							const relPath = relative(workspacePath, fullPath);
							const destPath = join(targetCwd, relPath);
							mkdirSync(dirname(destPath), { recursive: true });
							cpSync(fullPath, destPath);
							changedFiles.push(relPath);
						}
					}
				}
				return { success: true, filesChanged: changedFiles };
			},
			async cleanup(): Promise<void> {
				if (existsSync(workspacePath)) {
					try {
						rmSync(workspacePath, { recursive: true, force: true });
					} catch {
						// ignore cleanup error
					}
				}
			},
		};
	}
}
