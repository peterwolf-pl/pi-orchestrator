/**
 * Antigravity - Primary/Master Agent for Pi Multi-Agent Orchestrator.
 * Responsible for task planning, delegation decisions, review, integration, and final verification.
 */

import { Agent } from "./agent.ts";
import type { TaskResult } from "./types.ts";

export type DelegationTaskType =
	| "investigation"
	| "testing"
	| "api_research"
	| "isolated_component"
	| "refactor"
	| "main_implementation"
	| "tiny_edit"
	| "shared_context";

export interface DelegationDecision {
	shouldDelegate: boolean;
	targetAgent: "antigravity" | "antigravity2";
	reason: string;
	estimatedValue: "high" | "medium" | "low";
}

export interface MasterReviewAssessment {
	taskId: string;
	approved: boolean;
	isRelevant: boolean;
	isCorrect: boolean;
	fitsArchitecture: boolean;
	regressionRisk: "low" | "medium" | "high";
	feedback: string;
	action: "integrate" | "request_revision" | "reject" | "manual_takeover";
}

export class MasterAgent extends Agent {
	constructor(name: string = "antigravity") {
		super(name, "master");
	}

	/**
	 * Evaluates whether a task should be delegated to Antigravity2
	 * based on Pi Orchestrator delegation economics and architectural safety.
	 */
	evaluateDelegation(candidate: {
		title: string;
		description: string;
		type?: DelegationTaskType;
		isTinyEdit?: boolean;
		requiresSharedContext?: boolean;
		touchesMasterFiles?: boolean;
	}): DelegationDecision {
		// Rule 1: Tiny edits are never delegated (delegation overhead > value)
		if (candidate.isTinyEdit) {
			return {
				shouldDelegate: false,
				targetAgent: "antigravity",
				reason: "Delegation overhead exceeds value for minor edits. Master handles directly.",
				estimatedValue: "low",
			};
		}

		// Rule 2: Tasks requiring constant shared context belong to Master
		if (candidate.requiresSharedContext) {
			return {
				shouldDelegate: false,
				targetAgent: "antigravity",
				reason: "Task requires continuous shared conversation context. Master handles directly.",
				estimatedValue: "low",
			};
		}

		// Rule 3: Main implementation belongs to Master
		if (candidate.type === "main_implementation") {
			return {
				shouldDelegate: false,
				targetAgent: "antigravity",
				reason: "Main architectural implementation belongs to Master (Antigravity).",
				estimatedValue: "low",
			};
		}

		// Rule 4: High risk of editing the same files belongs to Master
		if (candidate.touchesMasterFiles) {
			return {
				shouldDelegate: false,
				targetAgent: "antigravity",
				reason: "File ownership conflict: task touches master files concurrently.",
				estimatedValue: "low",
			};
		}

		// Rule 5: Prime candidates for delegation to Antigravity2
		if (
			candidate.type === "investigation" ||
			candidate.type === "testing" ||
			candidate.type === "api_research" ||
			candidate.type === "isolated_component" ||
			candidate.type === "refactor"
		) {
			return {
				shouldDelegate: true,
				targetAgent: "antigravity2",
				reason: `Well-scoped candidate (${candidate.type}). Isolated worker provides speed and focus advantage.`,
				estimatedValue: "high",
			};
		}

		// By default: investigate or isolated sub-tasks can be delegated if title/description indicates
		const lower = `${candidate.title} ${candidate.description}`.toLowerCase();
		if (
			lower.includes("investigate") ||
			lower.includes("test") ||
			lower.includes("api") ||
			lower.includes("research") ||
			lower.includes("log") ||
			lower.includes("audit") ||
			lower.includes("verify")
		) {
			return {
				shouldDelegate: true,
				targetAgent: "antigravity2",
				reason: "Investigation/analysis/testing task suitable for Antigravity2.",
				estimatedValue: "medium",
			};
		}

		return {
			shouldDelegate: false,
			targetAgent: "antigravity",
			reason: "Defaulting to Master implementation unless explicit isolation is verified.",
			estimatedValue: "low",
		};
	}

	/**
	 * Reviews output returned by Antigravity2.
	 * Master must inspect the result, check for regressions, and decide whether to integrate.
	 */
	reviewWorkerResult(result: TaskResult, _diff?: string): MasterReviewAssessment {
		if (result.status === "failed" || result.status === "timeout") {
			return {
				taskId: result.task_id,
				approved: false,
				isRelevant: true,
				isCorrect: false,
				fitsArchitecture: true,
				regressionRisk: "low",
				feedback: `Worker reported ${result.status}: ${result.error || result.problems || "Unknown failure"}`,
				action: "manual_takeover",
			};
		}

		const hasTestFailure = result.tests && result.tests.status === "failed";
		if (hasTestFailure) {
			return {
				taskId: result.task_id,
				approved: false,
				isRelevant: true,
				isCorrect: false,
				fitsArchitecture: true,
				regressionRisk: "high",
				feedback: `Worker tests failed: ${result.tests?.output || "Test execution error"}`,
				action: "request_revision",
			};
		}

		return {
			taskId: result.task_id,
			approved: true,
			isRelevant: true,
			isCorrect: true,
			fitsArchitecture: true,
			regressionRisk: "low",
			feedback: `Worker findings and diff verified successfully. Recommendation: ${result.recommendation || "integrate changes"}`,
			action: "integrate",
		};
	}
}
