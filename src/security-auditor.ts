/**
 * Security Auditor Agent module for Pi Multi-Agent Orchestrator.
 * Inspects worker output, patches, and code diffs for security vulnerabilities,
 * secret leaks, command injection, and supply-chain risks.
 */

import type { SecurityAuditResult } from "./types.ts";

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp; severity: "critical" | "high" }> = [
	{
		name: "AWS Access Key ID",
		regex: /\b(AKIA[0-9A-Z]{16})\b/g,
		severity: "critical",
	},
	{
		name: "Generic Secret / API Key",
		regex: /(?:api[_-]?key|secret[_-]?key|auth[_-]?token|private[_-]?key)\s*[:=]\s*["']([a-zA-Z0-9_-]{16,})["']/gi,
		severity: "high",
	},
	{
		name: "Private RSA / SSH Key",
		regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
		severity: "critical",
	},
	{
		name: "GitHub Personal Access Token",
		regex: /\b(gh[pousr]_[A-Za-z0-9_]{36,})\b/g,
		severity: "critical",
	},
	{
		name: "JWT Token",
		regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/g,
		severity: "high",
	},
];

const DANGEROUS_COMMANDS: Array<{ name: string; regex: RegExp; severity: "critical" | "high" | "medium" }> = [
	{
		name: "Dangerous recursive root/system deletion",
		regex: /\brm\s+-(?:r|rf|fr)\s+[/~]/g,
		severity: "critical",
	},
	{
		name: "Remote script piping into shell",
		regex: /(?:curl|wget)\s+[^|]+\|\s*(?:bash|sh|zsh)/gi,
		severity: "critical",
	},
	{
		name: "Unsafe eval usage",
		regex: /\beval\s*\([^)]*\)/g,
		severity: "high",
	},
	{
		name: "Hardcoded sudo/chmod 777",
		regex: /\bchmod\s+(?:-R\s+)?777\b/g,
		severity: "medium",
	},
	{
		name: "Potential Path Traversal in file operations",
		regex: /\.\.\/|\.\.\\/g,
		severity: "medium",
	},
];

export class SecurityAuditor {
	private auditorAccountId: string;
	private enabled: boolean;

	constructor(auditorAccountId: string, enabled = true) {
		this.auditorAccountId = auditorAccountId;
		this.enabled = enabled;
	}

	public setAuditorAccount(accountId: string): void {
		this.auditorAccountId = accountId;
	}

	public setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	public isEnabled(): boolean {
		return this.enabled;
	}

	public getAuditorAccount(): string {
		return this.auditorAccountId;
	}

	/**
	 * Run a multi-vector security audit on a task, diff, or changed files.
	 */
	public async auditDiff(diff: string, filesChanged: string[] = [], taskTitle = ""): Promise<SecurityAuditResult> {
		if (!this.enabled) {
			return {
				passed: true,
				severity: "clean",
				findings: ["Security audit disabled by orchestrator configuration"],
				recommendations: [],
				auditedBy: this.auditorAccountId,
				auditedAt: Date.now(),
			};
		}

		const findings: string[] = [];
		const recommendations: string[] = [];
		let highestSeverityRank = 0;

		const rankMap: Record<string, number> = { clean: 0, low: 1, medium: 2, high: 3, critical: 4 };
		const escalateSeverity = (newSev: "clean" | "low" | "medium" | "high" | "critical") => {
			const r = rankMap[newSev] ?? 0;
			if (r > highestSeverityRank) {
				highestSeverityRank = r;
			}
		};

		// 1. Scan for leaked secrets & API keys
		for (const pattern of SECRET_PATTERNS) {
			pattern.regex.lastIndex = 0;
			const match = pattern.regex.exec(diff);
			if (match) {
				findings.push(`[${pattern.severity.toUpperCase()}] Potential secret leak detected: ${pattern.name}`);
				recommendations.push(`Remove hardcoded credentials; use environment variables or secret vaults instead.`);
				escalateSeverity(pattern.severity);
			}
		}

		// 2. Scan for dangerous shell commands & unsafe patterns
		for (const check of DANGEROUS_COMMANDS) {
			check.regex.lastIndex = 0;
			if (check.regex.test(diff)) {
				findings.push(`[${check.severity.toUpperCase()}] Risky code pattern: ${check.name}`);
				recommendations.push(`Review shell and file execution logic to prevent arbitrary command injection.`);
				escalateSeverity(check.severity);
			}
		}

		// 3. Sensitive file modification check
		const sensitiveFiles = [".env", ".env.local", "auth.json", "credentials.json", "id_rsa", "id_ed25519", ".npmrc"];
		for (const file of filesChanged) {
			const lower = file.toLowerCase();
			for (const sensitive of sensitiveFiles) {
				if (lower.endsWith(sensitive)) {
					findings.push(`[CRITICAL] Worker attempted to modify sensitive file: ${file}`);
					recommendations.push(`Worker is not permitted to touch secrets or credentials files.`);
					escalateSeverity("critical");
				}
			}
		}

		const severities: Array<"clean" | "low" | "medium" | "high" | "critical"> = [
			"clean",
			"low",
			"medium",
			"high",
			"critical",
		];
		const highestSeverity = severities[highestSeverityRank] || "clean";
		const passed = highestSeverityRank < 3; // Clean, Low, Medium pass; High & Critical fail

		if (findings.length === 0) {
			findings.push(`All security checks passed for: "${taskTitle || "Worker diff"}"`);
			recommendations.push("No vulnerabilities or leaked secrets detected.");
		}

		return {
			passed,
			severity: highestSeverity,
			findings,
			recommendations,
			auditedBy: this.auditorAccountId,
			auditedAt: Date.now(),
		};
	}
}
