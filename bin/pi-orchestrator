#!/usr/bin/env node
import { handleOrchestratorCommand } from "../src/cli.js";

const args = process.argv.slice(2);
const handled = await handleOrchestratorCommand(args);

if (!handled) {
	console.log(`Pi Antigravity Multi-Agent Coding Orchestrator

Usage:
  pi-orchestrator                           Open real-time interactive Dashboard
  pi-orchestrator dashboard                 Open real-time interactive Dashboard
  pi-orchestrator quotas                    View live 5h/weekly limits & reset timers for all accounts
  pi-orchestrator security [on|off|<acc>]   Configure Security Auditor agent
  pi-orchestrator master <account_id>       Switch Master agent account
  pi-orchestrator task "<objective>"        Set main coding objective
  pi-orchestrator delegate "<description>"  Delegate coding subtask to worker pool
  pi-orchestrator workers                   List all delegated tasks and security verdicts
  pi-orchestrator diff <task_id>            View diff produced by worker in worktree
  pi-orchestrator approve <task_id>         Approve and merge worker changes into master
  pi-orchestrator reject <task_id> [reason] Reject worker changes and clean workspace
`);
}
