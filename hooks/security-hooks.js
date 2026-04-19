/**
 * Security Hooks - Enforce security policies and detect vulnerabilities
 *
 * Enhancements:
 * - Hook profile support (minimal/standard/strict)
 * - Cost tracking integration for sensitive operations
 * - Per-agent security configuration
 */

const fs = require('fs');
const path = require('path');

class SecurityHooks {
  constructor() {
    // Dangerous command patterns
    this.dangerousPatterns = [
      /rm\s+-rf\s+\/|rm\s+-rf\s+\*/,  // rm -rf / or rm -rf *
      /dd\s+if=\/dev\/zero\s+of=\//, // disk wipe
      /:\(\)\s*{\s*:\|:\s*&\s*}\s*;:/, // fork bomb
      /DROP\s+DATABASE|DELETE\s+FROM/i, // SQL injection
      /DROP\s+TABLE/i,
      /TRUNCATE\s+TABLE/i,
    ];

    // Sensitive file paths
    this.sensitivePatterns = [
      /\.env/,
      /\.git\/config/,
      /\/etc\//,
      /\/root\//,
      /node_modules/,
      /package-lock\.json/,
      /\.aws\/credentials/,
      /\.ssh\/id_/,
      /secrets?\.json/i,
      /credentials?\.json/i,
      /\.env\..*/,
    ];

    // Secret patterns for detection
    this.secretPatterns = {
      apiKey: /['"](api[_-]?key['":]|sk_[a-z0-9]{20,}|pk_[a-z0-9]{20,})/gi,
      awsKey: /AKIA[0-9A-Z]{16}/g,
      jwtToken: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[\w-]*[=]{0,2}/g,
      mongoUri: /mongodb\+?srv?:\/\/[^\s]+/g,
      dbPassword: /(password|passwd|pwd)['":\s]+['"]([\w!@#$%^&*()_+-=\[\]{};:'",.<>?\\\/~`]+)['"]/gi,
      dockerToken: /ghp_[A-Za-z0-9_]+/g,
      gitHubToken: /github_pat_[A-Za-z0-9_]+/g,
      privateKey: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    };
  }

  /**
   * PreToolUse hook - Block dangerous commands
   */
  getPreToolUseDangerousCommandHook() {
    return async (context) => {
      const { data } = context;
      if (!data || !data.command) return null;

      const command = data.command.toString();

      // Check for dangerous patterns
      for (const pattern of this.dangerousPatterns) {
        if (pattern.test(command)) {
          return {
            block: true,
            reason: `Dangerous command pattern detected: ${pattern}`,
          };
        }
      }

      return null;
    };
  }

  /**
   * PreToolUse hook - Prevent writes to sensitive paths
   */
  getPreToolUseSensitivePathHook() {
    return async (context) => {
      const { data } = context;
      if (!data || !data.filePath) return null;

      const filePath = data.filePath.toString();

      // Check for sensitive path patterns
      for (const pattern of this.sensitivePatterns) {
        if (pattern.test(filePath)) {
          return {
            block: true,
            reason: `Attempt to access sensitive path: ${filePath}`,
          };
        }
      }

      return null;
    };
  }

  /**
   * PostToolUse hook - Scan output for leaked secrets
   */
  getPostToolUseSecretDetectionHook() {
    return async (context) => {
      const { data } = context;
      if (!data || !data.output) return null;

      const output = data.output.toString();
      const foundSecrets = [];

      // Scan for secrets
      for (const [secretType, pattern] of Object.entries(this.secretPatterns)) {
        const matches = output.match(pattern);
        if (matches) {
          foundSecrets.push({
            type: secretType,
            count: matches.length,
            pattern: pattern.source,
          });
        }
      }

      if (foundSecrets.length > 0) {
        console.warn(`[SecurityHook] Potential secrets detected in output:`, foundSecrets);
        return {
          block: true,
          reason: `Secrets detected in output: ${foundSecrets.map(s => s.type).join(', ')}`,
        };
      }

      return null;
    };
  }

  /**
   * PreCommit hook - Run secret scanning
   */
  getPreCommitSecretScanHook() {
    return async (context) => {
      const { data } = context;
      if (!data || !data.files) return null;

      const scanResults = [];

      for (const file of data.files) {
        try {
          const filePath = file.path || file;
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            const foundSecrets = [];

            for (const [secretType, pattern] of Object.entries(this.secretPatterns)) {
              if (pattern.test(content)) {
                foundSecrets.push(secretType);
              }
            }

            if (foundSecrets.length > 0) {
              scanResults.push({
                file: filePath,
                secrets: foundSecrets,
              });
            }
          }
        } catch (error) {
          console.error(`[SecurityHook] Error scanning file ${file}: ${error.message}`);
        }
      }

      if (scanResults.length > 0) {
        return {
          block: true,
          reason: `Secrets found in ${scanResults.length} file(s): ${scanResults.map(r => r.file).join(', ')}`,
        };
      }

      return null;
    };
  }

  /**
   * PreCommit hook - Check for large files
   */
  getPreCommitLargeFileCheckHook(maxSizeMB = 10) {
    return async (context) => {
      const { data } = context;
      if (!data || !data.files) return null;

      const largeFiles = [];
      const maxBytes = maxSizeMB * 1024 * 1024;

      for (const file of data.files) {
        try {
          const filePath = file.path || file;
          if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            if (stats.size > maxBytes) {
              largeFiles.push({
                file: filePath,
                size: (stats.size / 1024 / 1024).toFixed(2),
              });
            }
          }
        } catch (error) {
          console.error(`[SecurityHook] Error checking file size ${file}: ${error.message}`);
        }
      }

      if (largeFiles.length > 0) {
        return {
          block: true,
          reason: `Files exceed ${maxSizeMB}MB limit: ${largeFiles.map(f => f.file).join(', ')}`,
        };
      }

      return null;
    };
  }

  /**
   * PostToolUse hook - Detect suspicious file operations
   */
  getPostToolUseSuspiciousOpsHook() {
    return async (context) => {
      const { data, agent } = context;
      if (!data) return null;

      const suspiciousOps = [];

      // Check for recursive directory operations on root paths
      if (data.operation === 'delete' && data.recursive && data.path) {
        if (data.path === '/' || data.path === '\\') {
          suspiciousOps.push('Recursive delete on root directory');
        }
      }

      // Check for mass file operations
      if (data.filesAffected && data.filesAffected > 1000) {
        suspiciousOps.push(`Massive file operation affecting ${data.filesAffected} files`);
      }

      if (suspiciousOps.length > 0) {
        return {
          block: true,
          reason: `Suspicious operations detected: ${suspiciousOps.join('; ')}`,
        };
      }

      return null;
    };
  }

  /**
   * PreToolUse hook - Rate limiting for dangerous operations
   */
  getPreToolUseRateLimitHook(maxOpsPerMinute = 10) {
    const operationCounts = {};
    const windowDuration = 60000; // 1 minute

    return async (context) => {
      const { agent, data } = context;
      const agentKey = agent || 'unknown';

      if (!operationCounts[agentKey]) {
        operationCounts[agentKey] = [];
      }

      const now = Date.now();
      const recentOps = operationCounts[agentKey].filter(ts => now - ts < windowDuration);

      if (recentOps.length >= maxOpsPerMinute) {
        return {
          block: true,
          reason: `Rate limit exceeded for agent ${agentKey}: ${maxOpsPerMinute} operations per minute`,
        };
      }

      recentOps.push(now);
      operationCounts[agentKey] = recentOps;

      return null;
    };
  }

  /**
   * Create all security hooks
   */
  createAllHooks(hookEngine) {
    const hookIds = [];

    hookIds.push(
      hookEngine.registerHook(
        'PreToolUse',
        'security-dangerous-command',
        this.getPreToolUseDangerousCommandHook(),
        150,
        2000,
        { allowedProfiles: ['standard', 'strict'] }
      )
    );

    hookIds.push(
      hookEngine.registerHook(
        'PreToolUse',
        'security-sensitive-path',
        this.getPreToolUseSensitivePathHook(),
        150,
        2000,
        { allowedProfiles: ['standard', 'strict'] }
      )
    );

    hookIds.push(
      hookEngine.registerHook(
        'PostToolUse',
        'security-secret-detection',
        this.getPostToolUseSecretDetectionHook(),
        140,
        3000,
        { allowedProfiles: ['standard', 'strict'] }
      )
    );

    hookIds.push(
      hookEngine.registerHook(
        'PreCommit',
        'security-pre-commit-secrets',
        this.getPreCommitSecretScanHook(),
        140,
        5000,
        { allowedProfiles: ['standard', 'strict'] }
      )
    );

    hookIds.push(
      hookEngine.registerHook(
        'PreCommit',
        'security-large-files',
        this.getPreCommitLargeFileCheckHook(10),
        130,
        3000,
        { allowedProfiles: ['standard', 'strict'] }
      )
    );

    hookIds.push(
      hookEngine.registerHook(
        'PostToolUse',
        'security-suspicious-ops',
        this.getPostToolUseSuspiciousOpsHook(),
        140,
        2000,
        { allowedProfiles: ['standard', 'strict'] }
      )
    );

    hookIds.push(
      hookEngine.registerHook(
        'PreToolUse',
        'security-rate-limit',
        this.getPreToolUseRateLimitHook(20),
        120,
        1000,
        { allowedProfiles: ['strict'] }
      )
    );

    return hookIds;
  }
}

module.exports = SecurityHooks;
