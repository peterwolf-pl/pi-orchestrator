/**
 * Skill Manager and Autonomous Knowledge Extraction module for Pi Multi-Agent Orchestrator.
 * When workers are idle, they extract learned lessons, debugging patterns, API quirks,
 * and codebase knowledge into reusable Pi skills (.pi/skills/*.md) and documentation.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DocsGenerationResult, SkillExtractionResult, WorkerTaskRecord } from "./types.ts";

export class SkillManager {
	private readonly rootDir: string;
	private readonly skillsDir: string;
	private readonly docsDir: string;
	private readonly skills: SkillExtractionResult[] = [];

	constructor(rootDir: string = process.cwd()) {
		this.rootDir = rootDir;
		this.skillsDir = join(this.rootDir, ".pi", "skills");
		this.docsDir = join(this.rootDir, "docs");
		this.loadExistingSkills();
	}

	private loadExistingSkills(): void {
		if (!existsSync(this.skillsDir)) {
			try {
				mkdirSync(this.skillsDir, { recursive: true });
			} catch {
				return;
			}
		}

		try {
			const files = readdirSync(this.skillsDir);
			for (const file of files) {
				if (file.endsWith(".md")) {
					const content = readFileSync(join(this.skillsDir, file), "utf-8");
					const titleMatch = content.match(/^#\s+(.+)$/m);
					const descMatch = content.match(/description:\s*(.+)$/m);
					this.skills.push({
						skillName: file.replace(/\.md$/, ""),
						filePath: join(".pi", "skills", file),
						title: titleMatch ? titleMatch[1].trim() : file,
						description: descMatch ? descMatch[1].trim() : "Custom Pi Skill",
						tags: ["pi-skill"],
						createdAt: Date.now(),
					});
				}
			}
		} catch {
			// ignore
		}
	}

	public getSkills(): SkillExtractionResult[] {
		return [...this.skills];
	}

	/**
	 * Convert a task title into a slugified filename.
	 */
	private slugify(text: string): string {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40);
	}

	/**
	 * Autonomous Skill Extraction:
	 * Extracts a skill from a completed task record and writes it to .pi/skills/<slug>.md
	 */
	public async extractSkillFromTask(record: WorkerTaskRecord, agentId = "worker"): Promise<SkillExtractionResult> {
		if (!existsSync(this.skillsDir)) {
			mkdirSync(this.skillsDir, { recursive: true });
		}

		const task = record.task;
		const slug = this.slugify(task.title);
		const filename = `${slug}.md`;
		const fullPath = join(this.skillsDir, filename);

		const findings = record.result?.findings || record.result?.summary || "No specific findings";
		const filesModified = record.result?.files_changed || [];
		const testInfo =
			record.result?.tests?.status === "passed"
				? `Verified working with test: \`${record.result.tests.command}\``
				: "Tests verified or skipped.";

		const content = `---
name: ${slug}
description: Instructions and lessons learned for ${task.title}
tags: [auto-generated, ${task.agent}]
---

# ${task.title}

*Automatically extracted by Skill Manager agent (${agentId}) from task ${task.task_id}*

## Context & Problem
${task.description}

## Key Findings & Solution Pattern
${findings}

${filesModified.length > 0 ? `## Affected Files\n${filesModified.map((f) => `- \`${f}\``).join("\n")}` : ""}

## Verification & Recommendations
${testInfo}
${record.result?.recommendation ? `\n> **Master Recommendation:** ${record.result.recommendation}` : ""}
`;

		writeFileSync(fullPath, content, "utf-8");

		const result: SkillExtractionResult = {
			skillName: slug,
			filePath: join(".pi", "skills", filename),
			title: task.title,
			description: `Instructions and lessons learned for ${task.title}`,
			tags: ["auto-generated", task.agent],
			createdAt: Date.now(),
			extractedFromTaskId: task.task_id,
		};

		this.skills.push(result);
		return result;
	}

	/**
	 * Autonomous Documentation Generation:
	 * Generates or updates markdown summary documentation from completed tasks.
	 */
	public async generateDocumentation(tasks: WorkerTaskRecord[], agentId = "worker"): Promise<DocsGenerationResult> {
		if (!existsSync(this.docsDir)) {
			mkdirSync(this.docsDir, { recursive: true });
		}

		const docPath = join(this.docsDir, "WORKER_KNOWLEDGE_BASE.md");
		const completed = tasks.filter((t) => t.status === "completed");

		let content = `# Worker Knowledge Base & Activity Log\n\n`;
		content += `*Generated automatically by Autonomous Documentation Agent (${agentId}) on ${new Date().toISOString()}*\n\n`;
		content += `## Summary of Completed Tasks (${completed.length})\n\n`;

		if (completed.length === 0) {
			content += `No completed tasks yet.\n`;
		} else {
			for (const t of completed) {
				content += `### [${t.task.task_id}] ${t.task.title}\n`;
				content += `- **Agent:** \`${t.task.agent}\`\n`;
				content += `- **Description:** ${t.task.description}\n`;
				content += `- **Summary:** ${t.result?.summary || "Completed"}\n`;
				if (t.result?.findings) {
					content += `- **Findings:** ${t.result.findings}\n`;
				}
				if (t.result?.files_changed && t.result.files_changed.length > 0) {
					content += `- **Files Changed:** ${t.result.files_changed.map((f) => `\`${f}\``).join(", ")}\n`;
				}
				if (t.securityAudit) {
					content += `- **Security Audit:** ${t.securityAudit.passed ? "✅ Passed (Clean)" : `⚠️ Flagged (${t.securityAudit.severity})`}\n`;
				}
				content += `\n`;
			}
		}

		writeFileSync(docPath, content, "utf-8");

		return {
			filePath: join("docs", "WORKER_KNOWLEDGE_BASE.md"),
			summary: `Updated knowledge base with ${completed.length} completed tasks.`,
			generatedAt: Date.now(),
		};
	}
}
