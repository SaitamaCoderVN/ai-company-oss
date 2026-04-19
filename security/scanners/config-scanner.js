/**
 * AgentShield Config Scanner
 * Analyzes agent configuration files for security issues
 * Checks: permissions.json, Docker configs, environment settings
 */

const fs = require('fs');
const path = require('path');

class ConfigScanner {
  constructor(options = {}) {
    this.options = options;
    this.findings = [];
    this.rules = this.loadRules();
  }

  loadRules() {
    try {
      const rulesPath = path.join(__dirname, '../rules/security-rules.json');
      const rulesData = fs.readFileSync(rulesPath, 'utf-8');
      return JSON.parse(rulesData);
    } catch (error) {
      console.error('Failed to load security rules:', error.message);
      return { categories: {} };
    }
  }

  /**
   * Scan agent configuration directory
   */
  async scanAgent(agentPath) {
    this.findings = [];

    // Scan permissions.json
    const permissionsPath = path.join(agentPath, 'permissions.json');
    if (fs.existsSync(permissionsPath)) {
      await this.scanPermissions(permissionsPath);
    }

    // Scan Docker configuration
    const dockerfilePath = path.join(agentPath, 'Dockerfile');
    if (fs.existsSync(dockerfilePath)) {
      await this.scanDockerfile(dockerfilePath);
    }

    // Scan environment variables
    await this.scanEnvironmentConfig(agentPath);

    // Scan config files
    await this.scanConfigFiles(agentPath);

    return this.findings;
  }

  /**
   * Analyze permissions.json for overly permissive access
   */
  async scanPermissions(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const permissions = JSON.parse(content);

      // Check for root filesystem access
      if (permissions.file_access?.paths?.includes('/')) {
        this.addFinding({
          severity: 'critical',
          ruleId: 'SEC-020',
          file: filePath,
          line: 1,
          message: 'Read-write access to root filesystem detected',
          context: 'Permissions include root path (/)',
          remediation: 'Restrict to /tmp, /workspace, or /data directories'
        });
      }

      // Check for no whitelist (allow_all pattern)
      if (permissions.file_access?.allow_all === true) {
        this.addFinding({
          severity: 'critical',
          ruleId: 'SEC-021',
          file: filePath,
          line: 1,
          message: 'No whitelist - all paths allowed',
          context: 'allow_all is set to true',
          remediation: 'Define explicit whitelist of allowed paths'
        });
      }

      // Check for sensitive directory access
      const sensitivePatterns = ['/etc', '/root', '/home', '/var/lib'];
      const accessedPaths = permissions.file_access?.paths || [];

      for (const pattern of sensitivePatterns) {
        if (accessedPaths.some(p => p.includes(pattern))) {
          this.addFinding({
            severity: 'high',
            ruleId: 'SEC-022',
            file: filePath,
            line: 1,
            message: `Access to sensitive system directory: ${pattern}`,
            context: `Found in paths: ${accessedPaths.filter(p => p.includes(pattern)).join(', ')}`,
            remediation: `Remove access to ${pattern} unless justified`
          });
        }
      }

      // Check network access restrictions
      if (!permissions.network_access) {
        this.addFinding({
          severity: 'high',
          ruleId: 'SEC-023',
          file: filePath,
          line: 1,
          message: 'No network_access configuration defined',
          context: 'Agent has unrestricted network access',
          remediation: 'Use network_whitelist with specific hosts/ports'
        });
      } else if (permissions.network_access.allow_all === true) {
        this.addFinding({
          severity: 'high',
          ruleId: 'SEC-023',
          file: filePath,
          line: 1,
          message: 'Unrestricted network access enabled',
          context: 'network_access.allow_all is true',
          remediation: 'Use network_whitelist with specific hosts/ports'
        });
      }

      // Check shell execution approval
      if (permissions.shell_exec === true && !permissions.human_approval_required?.includes('shell_exec')) {
        this.addFinding({
          severity: 'high',
          ruleId: 'SEC-024',
          file: filePath,
          line: 1,
          message: 'Shell execution permitted without human approval',
          context: 'shell_exec is true without approval requirement',
          remediation: 'Set human_approval_required for shell_exec'
        });
      }

      // Check file deletion approval
      if (permissions.file_delete === true && !permissions.human_approval_required?.includes('file_delete')) {
        this.addFinding({
          severity: 'high',
          ruleId: 'SEC-025',
          file: filePath,
          line: 1,
          message: 'File deletion permitted without human approval',
          context: 'file_delete is true without approval requirement',
          remediation: 'Set human_approval_required for file operations'
        });
      }

      // Check workspace write permissions
      const workspacePaths = accessedPaths.filter(p => p.includes('/workspace'));
      if (workspacePaths.some(p => p.endsWith('*'))) {
        this.addFinding({
          severity: 'critical',
          ruleId: 'SEC-031',
          file: filePath,
          line: 1,
          message: 'Unrestricted write access to /workspace',
          context: 'Wildcard path in workspace access',
          remediation: 'Use subdirectories, implement quota limits'
        });
      }

      // Check symlink prevention
      if (permissions.symlink_traversal_prevention !== true) {
        this.addFinding({
          severity: 'high',
          ruleId: 'SEC-033',
          file: filePath,
          line: 1,
          message: 'Symlink traversal prevention not enabled',
          context: 'symlink_traversal_prevention is not set to true',
          remediation: 'Enable symlink traversal prevention'
        });
      }

      // Check resource limits
      if (!permissions.resource_limits) {
        this.addFinding({
          severity: 'medium',
          ruleId: 'SEC-034',
          file: filePath,
          line: 1,
          message: 'No resource limits configured',
          context: 'Missing cpu_limit, memory_limit, disk_quota',
          remediation: 'Set cpu_limit, memory_limit, disk_quota'
        });
      } else {
        const limits = permissions.resource_limits;
        if (!limits.cpu_limit || !limits.memory_limit || !limits.disk_quota) {
          this.addFinding({
            severity: 'medium',
            ruleId: 'SEC-034',
            file: filePath,
            line: 1,
            message: 'Incomplete resource limits',
            context: 'Missing one or more of: cpu_limit, memory_limit, disk_quota',
            remediation: 'Configure all resource limit types'
          });
        }
      }

    } catch (error) {
      this.addFinding({
        severity: 'high',
        ruleId: 'PARSE_ERROR',
        file: filePath,
        line: 1,
        message: `Failed to parse permissions.json: ${error.message}`,
        context: 'Invalid JSON syntax',
        remediation: 'Fix JSON syntax errors'
      });
    }
  }

  /**
   * Analyze Dockerfile for security issues
   */
  async scanDockerfile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        const lineNum = index + 1;

        // Check for root user
        if (line.includes('USER root') || !lines.some(l => l.includes('USER'))) {
          this.addFinding({
            severity: 'high',
            ruleId: 'SEC-037',
            file: filePath,
            line: lineNum,
            message: 'Container runs as root user',
            context: line.trim(),
            remediation: 'Use non-root USER directive'
          });
        }

        // Check for privileged mode
        if (line.includes('privileged') && line.includes('true')) {
          this.addFinding({
            severity: 'high',
            ruleId: 'SEC-039',
            file: filePath,
            line: lineNum,
            message: 'Privileged container mode enabled',
            context: line.trim(),
            remediation: 'Remove privileged flag, use fine-grained capabilities'
          });
        }

        // Check for volume mounts
        if (line.includes('VOLUME') && !line.includes(':ro')) {
          this.addFinding({
            severity: 'medium',
            ruleId: 'SEC-026',
            file: filePath,
            line: lineNum,
            message: 'Docker volume mounted read-write',
            context: line.trim(),
            remediation: 'Use read-only volumes where possible (:ro)'
          });
        }

        // Check for dangerous capabilities
        if (line.includes('cap_add') || line.includes('SYS_ADMIN')) {
          this.addFinding({
            severity: 'high',
            ruleId: 'SEC-036',
            file: filePath,
            line: lineNum,
            message: 'Dangerous Linux capability enabled',
            context: line.trim(),
            remediation: 'Drop unnecessary capabilities'
          });
        }

        // Check for mount propagation
        if (line.includes('--mount') && line.includes('shared')) {
          this.addFinding({
            severity: 'medium',
            ruleId: 'SEC-038',
            file: filePath,
            line: lineNum,
            message: 'Mount propagation set to shared',
            context: line.trim(),
            remediation: 'Use rprivate mount propagation'
          });
        }

        // Check for IPC mode
        if (line.includes('--ipc') && line.includes('host')) {
          this.addFinding({
            severity: 'medium',
            ruleId: 'SEC-035',
            file: filePath,
            line: lineNum,
            message: 'IPC access to host enabled',
            context: line.trim(),
            remediation: 'Use ipc: private or ipc: shareable'
          });
        }
      });

    } catch (error) {
      this.addFinding({
        severity: 'medium',
        ruleId: 'PARSE_ERROR',
        file: filePath,
        line: 1,
        message: `Failed to parse Dockerfile: ${error.message}`,
        context: 'File read error',
        remediation: 'Verify Dockerfile is readable'
      });
    }
  }

  /**
   * Scan environment variable configuration
   */
  async scanEnvironmentConfig(agentPath) {
    // Check for NODE_ENV in production
    const envFiles = ['.env', '.env.production', 'config/production.json'];

    for (const envFile of envFiles) {
      const fullPath = path.join(agentPath, envFile);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');

          if (!content.includes('NODE_ENV=production')) {
            this.addFinding({
              severity: 'critical',
              ruleId: 'SEC-095',
              file: fullPath,
              line: 1,
              message: 'NODE_ENV not set to production',
              context: 'Production config missing NODE_ENV=production',
              remediation: 'Add NODE_ENV=production to production configuration'
            });
          }

          // Check for debug mode
          if (content.includes('DEBUG=true') || content.includes('DEBUG=1')) {
            this.addFinding({
              severity: 'medium',
              ruleId: 'SEC-092',
              file: fullPath,
              line: 1,
              message: 'Debug mode enabled in production config',
              context: 'DEBUG flag is enabled',
              remediation: 'Set DEBUG=false for production'
            });
          }

          // Check for TLS verification
          if (content.includes('rejectUnauthorized=false')) {
            this.addFinding({
              severity: 'high',
              ruleId: 'SEC-093',
              file: fullPath,
              line: 1,
              message: 'TLS/SSL certificate verification disabled',
              context: 'rejectUnauthorized is false',
              remediation: 'Enable rejectUnauthorized: true'
            });
          }

        } catch (error) {
          // File read error
        }
      }
    }

    // Check for .env file in repository
    const envPath = path.join(agentPath, '.env');
    if (fs.existsSync(envPath)) {
      this.addFinding({
        severity: 'high',
        ruleId: 'SEC-090',
        file: envPath,
        line: 1,
        message: '.env file in repository root',
        context: 'Secrets may be committed to version control',
        remediation: 'Move to .env.example, add .env to .gitignore'
      });
    }

    // Check for credentials file
    const credsFiles = ['secrets.json', 'credentials.json', 'config/secrets.js'];
    for (const credsFile of credsFiles) {
      const fullPath = path.join(agentPath, credsFile);
      if (fs.existsSync(fullPath)) {
        this.addFinding({
          severity: 'high',
          ruleId: 'SEC-091',
          file: fullPath,
          line: 1,
          message: `Credentials file in repository: ${credsFile}`,
          context: 'Secrets stored in version control',
          remediation: 'Remove file, use environment variables or secrets manager'
        });
      }
    }
  }

  /**
   * Scan configuration files for security settings
   */
  async scanConfigFiles(agentPath) {
    const configFiles = [
      'config.json',
      'package.json',
      'tsconfig.json',
      'jest.config.js'
    ];

    for (const configFile of configFiles) {
      const fullPath = path.join(agentPath, configFile);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');

          // Check CORS configuration
          if (content.includes('cors') && content.includes('*')) {
            this.addFinding({
              severity: 'medium',
              ruleId: 'SEC-094',
              file: fullPath,
              line: 1,
              message: 'CORS allows all origins (*)',
              context: 'Wildcard CORS origin configured',
              remediation: 'Whitelist specific origins instead'
            });
          }

          // Check for default credentials
          if (content.match(/password|secret|key/i) && content.match(/default|password|123456/i)) {
            this.addFinding({
              severity: 'high',
              ruleId: 'SEC-096',
              file: fullPath,
              line: 1,
              message: 'Default credentials detected in config',
              context: 'Hardcoded credentials found',
              remediation: 'Use environment variables or secrets manager'
            });
          }

        } catch (error) {
          // Ignore parse errors for non-critical files
        }
      }
    }
  }

  /**
   * Add a finding to the results
   */
  addFinding(finding) {
    this.findings.push({
      timestamp: new Date().toISOString(),
      type: 'config_issue',
      ...finding
    });
  }

  /**
   * Get all findings
   */
  getFindings() {
    return this.findings.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  /**
   * Get findings by severity
   */
  getFindings(severity) {
    if (!severity) return this.getFindings();
    return this.findings.filter(f => f.severity === severity);
  }
}

module.exports = ConfigScanner;
