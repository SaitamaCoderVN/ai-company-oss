/**
 * AgentShield Secret Scanner
 * Detects leaked secrets, API keys, tokens, and sensitive data
 * Uses 14+ regex patterns and entropy-based detection
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SecretScanner {
  constructor(options = {}) {
    this.options = options;
    this.findings = [];
    this.patterns = this.initializePatterns();
  }

  /**
   * Initialize secret detection patterns
   */
  initializePatterns() {
    return {
      // AWS Credentials
      awsAccessKeyId: {
        pattern: /AKIA[0-9A-Z]{16}/g,
        type: 'AWS Access Key ID',
        severity: 'critical',
        description: 'AWS Access Key ID detected'
      },
      awsSecretAccessKey: {
        pattern: /aws_secret_access_key\s*=\s*[A-Za-z0-9\/\+=]{40}/gi,
        type: 'AWS Secret Access Key',
        severity: 'critical',
        description: 'AWS Secret Access Key detected'
      },

      // GitHub Tokens
      githubToken: {
        pattern: /ghp_[A-Za-z0-9_]{36,255}/g,
        type: 'GitHub Personal Access Token',
        severity: 'critical',
        description: 'GitHub PAT detected'
      },
      githubOAuthToken: {
        pattern: /gho_[A-Za-z0-9_]{36,255}/g,
        type: 'GitHub OAuth Token',
        severity: 'critical',
        description: 'GitHub OAuth token detected'
      },

      // Telegram Bot Token
      telegramBotToken: {
        pattern: /\d{9,10}:[A-Za-z0-9_-]{35,40}/g,
        type: 'Telegram Bot Token',
        severity: 'critical',
        description: 'Telegram bot token detected'
      },

      // Private Keys
      privateKeyRsa: {
        pattern: /-----BEGIN RSA PRIVATE KEY-----[\s\S]*?-----END RSA PRIVATE KEY-----/g,
        type: 'RSA Private Key',
        severity: 'critical',
        description: 'RSA private key detected'
      },
      privateKeyEc: {
        pattern: /-----BEGIN EC PRIVATE KEY-----[\s\S]*?-----END EC PRIVATE KEY-----/g,
        type: 'EC Private Key',
        severity: 'critical',
        description: 'EC private key detected'
      },
      privateKeyPkcs8: {
        pattern: /-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g,
        type: 'PKCS8 Private Key',
        severity: 'critical',
        description: 'PKCS8 private key detected'
      },

      // API Keys & Generic Tokens
      apiKey: {
        pattern: /api[_\-]?key\s*[\:=]\s*['\"]([A-Za-z0-9_\-]{20,})['\"]?/gi,
        type: 'API Key',
        severity: 'critical',
        description: 'API key detected'
      },

      // Database URLs
      mongodbUrl: {
        pattern: /mongodb([+a-z]*):\/\/([^:]+):([^@]+)@/gi,
        type: 'MongoDB Connection String',
        severity: 'critical',
        description: 'MongoDB URL with credentials detected'
      },
      postgresUrl: {
        pattern: /postgres(ql)?:\/\/([^:]+):([^@]+)@/gi,
        type: 'PostgreSQL Connection String',
        severity: 'critical',
        description: 'PostgreSQL URL with credentials detected'
      },

      // Stripe Keys
      stripeSecretKey: {
        pattern: /sk_live_[A-Za-z0-9]{20,}/g,
        type: 'Stripe Secret Key',
        severity: 'critical',
        description: 'Stripe secret key detected'
      },

      // NPM Token
      npmToken: {
        pattern: /npm_[A-Za-z0-9]{36,}/g,
        type: 'NPM Authentication Token',
        severity: 'critical',
        description: 'NPM token detected'
      },

      // JWT Tokens
      jwtToken: {
        pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{20,}/g,
        type: 'JWT Token',
        severity: 'high',
        description: 'JWT token detected'
      },

      // OAuth Access Token
      oauthToken: {
        pattern: /oauth[_\-]?token\s*[\:=]\s*['\"]([A-Za-z0-9_\-]{20,})['\"]?/gi,
        type: 'OAuth Access Token',
        severity: 'high',
        description: 'OAuth token reference detected'
      },

      // Hardcoded Passwords
      hardcodedPassword: {
        pattern: /password\s*=\s*['\"](.{6,}?)['\"]|password\s*:\s*['\"](.{6,}?)['\"]?/gi,
        type: 'Hardcoded Password',
        severity: 'high',
        description: 'Hardcoded password assignment detected'
      }
    };
  }

  /**
   * Scan an entire agent directory for secrets
   */
  async scanAgent(agentPath) {
    this.findings = [];

    // Scan all files recursively
    await this.scanDirectory(agentPath);

    return this.findings;
  }

  /**
   * Recursively scan directory for secrets
   */
  async scanDirectory(dirPath, maxDepth = 10, currentDepth = 0) {
    if (currentDepth >= maxDepth) return;

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip node_modules and hidden directories
        if (['.git', 'node_modules', '.next', 'dist', 'build', '.venv'].includes(entry.name)) {
          continue;
        }

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await this.scanDirectory(fullPath, maxDepth, currentDepth + 1);
        } else if (entry.isFile()) {
          // Scan relevant file types
          const ext = path.extname(entry.name).toLowerCase();
          if (this.shouldScanFile(entry.name, ext)) {
            await this.scanFile(fullPath);
          }
        }
      }
    } catch (error) {
      // Skip directories that can't be read
    }
  }

  /**
   * Check if file should be scanned
   */
  shouldScanFile(filename, ext) {
    const scanExtensions = [
      '.js', '.ts', '.json', '.yaml', '.yml', '.env', '.md',
      '.sh', '.bash', '.py', '.java', '.go', '.rs', '.toml',
      '.lock', '.txt', '.log', '.ini', '.conf', '.config'
    ];

    const scanFilenames = [
      '.env', '.env.example', '.env.local', '.env.production',
      'secrets.json', 'credentials.json', 'config.json',
      '.npmrc', '.docker', 'Dockerfile', 'docker-compose.yml',
      'SKILL.md', 'package.json', 'package-lock.json'
    ];

    return scanExtensions.includes(ext) || scanFilenames.includes(filename);
  }

  /**
   * Scan a file for secrets
   */
  async scanFile(filePath) {
    try {
      // Check file size (skip very large files)
      const stats = fs.statSync(filePath);
      if (stats.size > 5 * 1024 * 1024) {
        // Skip files larger than 5MB
        return;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        const lineNum = index + 1;

        // Check against all patterns
        this.checkPatterns(line, filePath, lineNum);

        // Check for high-entropy strings
        this.checkEntropy(line, filePath, lineNum);
      });

    } catch (error) {
      // Skip files that can't be read as text
    }
  }

  /**
   * Check line against secret patterns
   */
  checkPatterns(line, filePath, lineNum) {
    for (const [key, patternInfo] of Object.entries(this.patterns)) {
      const matches = line.matchAll(patternInfo.pattern);

      for (const match of matches) {
        // Don't report commented lines or test data
        if (line.trim().startsWith('//') || line.includes('REDACTED') || line.includes('example')) {
          continue;
        }

        const matched = match[0];
        const masked = this.maskSecret(matched);

        this.addFinding({
          severity: patternInfo.severity,
          type: 'secret_leak',
          pattern: patternInfo.type,
          file: filePath,
          line: lineNum,
          message: patternInfo.description,
          matched: matched,
          masked: masked,
          context: line.substring(0, 100)
        });
      }
    }
  }

  /**
   * Check for high-entropy strings (base64 encoded secrets)
   */
  checkEntropy(line, filePath, lineNum) {
    // Look for long base64-like strings
    const base64Pattern = /[A-Za-z0-9+/]{40,}={0,2}/g;
    const matches = line.matchAll(base64Pattern);

    for (const match of matches) {
      const str = match[0];

      // Skip if it looks like common data (JSON, comments, etc)
      if (line.includes('data:') || line.includes('example') || str.length > 300) {
        continue;
      }

      const entropy = this.calculateEntropy(str);

      // High entropy base64 strings might be secrets (threshold: 5.5+ bits/char)
      if (entropy > 5.5 && str.length >= 40) {
        this.addFinding({
          severity: 'high',
          type: 'high_entropy_string',
          pattern: 'High-Entropy Base64',
          file: filePath,
          line: lineNum,
          message: 'High-entropy string detected (potential secret)',
          matched: str,
          masked: str.substring(0, 8) + '***' + str.substring(str.length - 4),
          entropy: entropy.toFixed(2)
        });
      }
    }
  }

  /**
   * Calculate Shannon entropy of a string
   */
  calculateEntropy(str) {
    const len = str.length;
    const charFreq = {};

    for (const char of str) {
      charFreq[char] = (charFreq[char] || 0) + 1;
    }

    let entropy = 0;
    for (const count of Object.values(charFreq)) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }

    return entropy;
  }

  /**
   * Mask sensitive parts of a secret
   */
  maskSecret(secret) {
    if (secret.length <= 4) {
      return '****';
    }

    const prefix = secret.substring(0, 2);
    const suffix = secret.substring(secret.length - 2);
    const masked = '*'.repeat(Math.min(secret.length - 4, 20));

    return `${prefix}${masked}${suffix}`;
  }

  /**
   * Add a finding to results
   */
  addFinding(finding) {
    this.findings.push({
      timestamp: new Date().toISOString(),
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

  /**
   * Get findings by type
   */
  findingsByType(type) {
    return this.findings.filter(f => f.type === type);
  }
}

module.exports = SecretScanner;
