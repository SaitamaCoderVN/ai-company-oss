/**
 * AgentShield Skill Scanner
 * Scans skill files for dangerous operations and vulnerabilities
 * Detects: network calls, shell execution, file access, secret access, injection vulnerabilities
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SkillScanner {
  constructor(options = {}) {
    this.options = options;
    this.findings = [];
  }

  /**
   * Scan a skill file for vulnerabilities
   */
  async scanSkill(skillPath) {
    this.findings = [];

    try {
      const content = fs.readFileSync(skillPath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        const lineNum = index + 1;

        this.detectNetworkCalls(line, skillPath, lineNum);
        this.detectShellExecution(line, skillPath, lineNum);
        this.detectFileAccess(line, skillPath, lineNum);
        this.detectSecretAccess(line, skillPath, lineNum);
        this.detectInjectionVulnerabilities(line, skillPath, lineNum);
      });

      // Verify SHA-256 hash if available
      await this.verifyIntegrity(skillPath);

    } catch (error) {
      this.addFinding({
        severity: 'medium',
        ruleId: 'PARSE_ERROR',
        file: skillPath,
        line: 1,
        message: `Failed to scan skill: ${error.message}`,
        remediation: 'Verify skill file integrity'
      });
    }

    return this.findings;
  }

  /**
   * Detect network calls (HTTP, DNS, etc)
   */
  detectNetworkCalls(line, file, lineNum) {
    const patterns = {
      curl: {
        pattern: /curl\s+|exec.*curl|spawn.*curl/i,
        message: 'curl network call detected'
      },
      wget: {
        pattern: /wget\s+|spawn.*wget/i,
        message: 'wget network call detected'
      },
      fetch: {
        pattern: /fetch\s*\(/,
        message: 'fetch network call detected',
        severity: 'low'  // fetch is more controlled than others
      },
      httpModule: {
        pattern: /require\s*\(['"]http['"]|require\s*\(['"]https['"]\)/,
        message: 'http/https module imported for network access'
      },
      axios: {
        pattern: /axios\s*\(|axios\s*\.|require\s*\(['"]axios['"]\)/,
        message: 'axios HTTP client detected',
        severity: 'low'
      },
      requestLib: {
        pattern: /require\s*\(['"]request['"]|const\s+request\s*=/,
        message: 'request library imported'
      },
      superagent: {
        pattern: /require\s*\(['"]superagent['"]|superagent\s*\./,
        message: 'superagent HTTP library detected'
      },
      nodeHttps: {
        pattern: /https\s*\.|http\s*\./,
        message: 'Direct HTTP/HTTPS protocol usage detected'
      },
      dns: {
        pattern: /require\s*\(['"]dns['"]|dns\s*\./,
        message: 'DNS lookup capability detected'
      }
    };

    for (const [key, check] of Object.entries(patterns)) {
      if (check.pattern.test(line)) {
        this.addFinding({
          severity: check.severity || 'high',
          ruleId: `NETWORK_${key.toUpperCase()}`,
          file: file,
          line: lineNum,
          message: check.message,
          code: line.trim().substring(0, 80),
          remediation: 'Verify network access is whitelisted and necessary'
        });
      }
    }
  }

  /**
   * Detect shell execution patterns
   */
  detectShellExecution(line, file, lineNum) {
    const patterns = {
      exec: {
        pattern: /exec\s*\(|execSync\s*\(|require\s*\(['"]child_process['"]\)/,
        severity: 'critical',
        message: 'Process execution (exec) detected'
      },
      spawn: {
        pattern: /spawn\s*\(|spawnSync\s*\(/,
        severity: 'high',
        message: 'Process spawning detected'
      },
      system: {
        pattern: /system\s*\(|syscall\.Exec/,
        severity: 'critical',
        message: 'System command execution detected'
      },
      eval: {
        pattern: /eval\s*\(|Function\s*\(|new\s+Function/,
        severity: 'critical',
        message: 'Dynamic code evaluation (eval) detected'
      },
      shellOption: {
        pattern: /shell\s*:\s*true|shell:\s*'\/bin\/bash'|shell:\s*'\/bin\/sh'/,
        severity: 'critical',
        message: 'Shell option enabled in subprocess'
      },
      passThrough: {
        pattern: /passthrough\s*:\s*true|shell\s*:\s*true.*true/,
        severity: 'high',
        message: 'Pass-through shell mode detected'
      }
    };

    for (const [key, check] of Object.entries(patterns)) {
      if (check.pattern.test(line)) {
        this.addFinding({
          severity: check.severity,
          ruleId: `EXEC_${key.toUpperCase()}`,
          file: file,
          line: lineNum,
          message: check.message,
          code: line.trim().substring(0, 80),
          remediation: 'Use execFile with array arguments instead of shell option'
        });
      }
    }
  }

  /**
   * Detect file system access patterns
   */
  detectFileAccess(line, file, lineNum) {
    const patterns = {
      readFile: {
        pattern: /readFileSync\s*\(|readFile\s*\(/,
        message: 'File read operation detected'
      },
      writeFile: {
        pattern: /writeFileSync\s*\(|writeFile\s*\(|appendFileSync\s*\(/,
        message: 'File write operation detected'
      },
      pathTraversal: {
        pattern: /\.\.\s*\/|\.\.\\|%2e%2e/,
        severity: 'critical',
        message: 'Path traversal pattern detected (../)'
      },
      etcAccess: {
        pattern: /\/etc\/|\/root\/|\/home\/[^/]*\/\.\.|\/var\/lib\//,
        severity: 'critical',
        message: 'Access to sensitive system directories detected'
      },
      rootAccess: {
        pattern: /^\s*\/(?!tmp|workspace|data|home)/,
        severity: 'high',
        message: 'Potential root filesystem access'
      },
      delete: {
        pattern: /unlinkSync\s*\(|unlink\s*\(|rmdir|rm\s+-/,
        severity: 'critical',
        message: 'File deletion operation detected'
      },
      chmod: {
        pattern: /chmodSync|chmod\s*\(|0777/,
        severity: 'high',
        message: 'File permission modification detected'
      },
      symlink: {
        pattern: /symlinkSync|symlink\s*\(/,
        severity: 'high',
        message: 'Symbolic link creation detected'
      }
    };

    for (const [key, check] of Object.entries(patterns)) {
      if (check.pattern.test(line)) {
        this.addFinding({
          severity: check.severity || 'medium',
          ruleId: `FS_${key.toUpperCase()}`,
          file: file,
          line: lineNum,
          message: check.message,
          code: line.trim().substring(0, 80),
          remediation: 'Verify file access is within allowed directories'
        });
      }
    }
  }

  /**
   * Detect secret and environment variable access
   */
  detectSecretAccess(line, file, lineNum) {
    const patterns = {
      processEnv: {
        pattern: /process\.env|process\["ENV|process\['ENV/,
        severity: 'high',
        message: 'Environment variable access detected'
      },
      apiKey: {
        pattern: /API_KEY|api_key|apiKey|API_SECRET|api_secret/i,
        severity: 'high',
        message: 'API key reference detected'
      },
      token: {
        pattern: /TOKEN|SECRET|PASSWORD|PASSWD/i,
        severity: 'high',
        message: 'Credential reference detected'
      },
      databaseUrl: {
        pattern: /DATABASE_URL|DB_CONNECTION|MONGO_URI|SQL_URL/i,
        severity: 'high',
        message: 'Database connection string reference detected'
      },
      hardcodedSecret: {
        pattern: /API_KEY\s*=\s*['"]/,
        severity: 'critical',
        message: 'Hardcoded API key detected'
      },
      configModule: {
        pattern: /require\s*\(['"]\.\/config|require\s*\(['"].*config/,
        severity: 'medium',
        message: 'Config module import detected'
      }
    };

    for (const [key, check] of Object.entries(patterns)) {
      if (check.pattern.test(line)) {
        this.addFinding({
          severity: check.severity,
          ruleId: `SECRET_${key.toUpperCase()}`,
          file: file,
          line: lineNum,
          message: check.message,
          code: line.trim().substring(0, 80),
          remediation: 'Verify secrets are loaded from secure source'
        });
      }
    }
  }

  /**
   * Detect injection vulnerabilities
   */
  detectInjectionVulnerabilities(line, file, lineNum) {
    const patterns = {
      commandSubstitution: {
        pattern: /\$\{.*\}|\$\(.*\)|`.*\$/,
        severity: 'critical',
        message: 'Command substitution pattern detected'
      },
      stringInterpolation: {
        pattern: /exec.*`|spawn.*`|eval.*\$|Function.*\$/,
        severity: 'critical',
        message: 'String interpolation in command execution'
      },
      sqlInjection: {
        pattern: /query.*\+|concat.*SQL|`.*\$|query.*\$\{/,
        severity: 'critical',
        message: 'SQL injection pattern detected'
      },
      xssVulnerability: {
        pattern: /innerHTML|dangerouslySetInnerHTML|\.html\(/,
        severity: 'high',
        message: 'XSS vulnerability pattern detected'
      },
      regexDos: {
        pattern: /RegExp\s*\(|new\s+RegExp\s*\(.*\*\+|\.test\s*\(.*user/,
        severity: 'high',
        message: 'ReDoS vulnerability pattern detected'
      },
      prototypePollution: {
        pattern: /\[.*\]\s*=|__proto__|constructor\s*\(|prototype\s*\./,
        severity: 'medium',
        message: 'Prototype pollution pattern detected'
      },
      deserializationAttack: {
        pattern: /JSON\.parse\s*\(|pickle\.|eval\s*\(|Function\s*\(/,
        severity: 'high',
        message: 'Deserialization vulnerability pattern detected'
      }
    };

    for (const [key, check] of Object.entries(patterns)) {
      if (check.pattern.test(line)) {
        this.addFinding({
          severity: check.severity,
          ruleId: `INJECTION_${key.toUpperCase()}`,
          file: file,
          line: lineNum,
          message: check.message,
          code: line.trim().substring(0, 80),
          remediation: 'Avoid dynamic execution, use safe APIs and validation'
        });
      }
    }
  }

  /**
   * Verify file integrity with SHA-256
   */
  async verifyIntegrity(filePath) {
    try {
      const content = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');

      // Check if there's a .sha256 file
      const hashFile = filePath + '.sha256';
      if (fs.existsSync(hashFile)) {
        const expectedHash = fs.readFileSync(hashFile, 'utf-8').trim();

        if (hash !== expectedHash) {
          this.addFinding({
            severity: 'critical',
            ruleId: 'INTEGRITY_MISMATCH',
            file: filePath,
            line: 1,
            message: 'File integrity check failed - hash mismatch',
            detected: hash.substring(0, 8) + '...',
            expected: expectedHash.substring(0, 8) + '...',
            remediation: 'Verify skill file was not tampered with'
          });
        }
      }
    } catch (error) {
      // Ignore integrity check errors
    }
  }

  /**
   * Add a finding to results
   */
  addFinding(finding) {
    this.findings.push({
      timestamp: new Date().toISOString(),
      type: 'code_issue',
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
  findingsBySeverity(severity) {
    return this.findings.filter(f => f.severity === severity);
  }
}

module.exports = SkillScanner;
