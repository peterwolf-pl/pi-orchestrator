/**
 * Base Agent class for Pi Multi-Agent Orchestration.
 */

import type { AgentInfo, AgentRole, AgentState } from "./types.ts";

export abstract class Agent {
	readonly name: string;
	readonly role: AgentRole;
	private _status: AgentState = "idle";
	private _currentActivity?: string;
	private _subtasks: string[] = [];

	constructor(name: string, role: AgentRole) {
		this.name = name;
		this.role = role;
	}

	get status(): AgentState {
		return this._status;
	}

	get currentActivity(): string | undefined {
		return this._currentActivity;
	}

	get subtasks(): readonly string[] {
		return this._subtasks;
	}

	setStatus(status: AgentState, activity?: string): void {
		this._status = status;
		if (activity !== undefined) {
			this._currentActivity = activity;
		}
	}

	setActivity(activity?: string): void {
		this._currentActivity = activity;
	}

	addSubtask(subtask: string): void {
		this._subtasks.push(subtask);
	}

	clearSubtasks(): void {
		this._subtasks = [];
	}

	getInfo(): AgentInfo {
		return {
			name: this.name,
			accountId: this.name,
			role: this.role,
			status: this._status,
			currentActivity: this._currentActivity,
			subtasks: [...this._subtasks],
		};
	}
}
