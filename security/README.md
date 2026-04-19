# AgentShield Security System

Enterprise-grade security audit system for AI agents, implementing a three-stage red-team/blue-team/auditor pipeline based on ECC's proven security methodology.

## Overview

AgentShield provides comprehensive security scanning across four threat vectors:

1. **Configuration Security** - Permissions, Docker isolation, environment settings
2. **Secret Detection** - API keys, tokens, credentials, entropy-based secret discovery
3. **Code Vulnerabilities** - Shell execution, path traversal, injection attacks, unsafe patterns
4. **Supply Chain** - Vulnerable dependencies, typosquatting, malicious packages

## Architecture

### Three-Stage Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENTSHIELD PIPELINE                         │
└─────────────────────────────────────────────────────────────────┘

  ╔════════════════════════════════════════════════════════════════╗
  ║ STAGE 1: RED TEAM (Attacker Agent)                           ║
  ║ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ║
  ║ • ConfigScanner: Overly permissive access controls           ║
  ║ • SecretScanner: Leaked credentials (14+ patterns)           ║
  ║ • SkillScanner: Code-level vulnerabilities & injection       ║
  ║ • DependencyScanner: Supply chain threats                    ║
  ║ OUTPUT: List of vulnerabilities with severity levels         ║
  ╚════════════════════════════════════════════════════════════════╝
                            ↓
  ╔════════════════════════════════════════════════════════════════╗
  ║ STAGE 2: BLUE TEAM (Defender Agent)                          ║
  ║ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ║
  ║ • Evaluates each vulnerability against existing protections  ║
  ║ • Rates defense strength: strong/adequate/weak/none          ║
  ║ • Identifies gaps and false negatives                        ║
  ║ OUTPUT: Defense assessment per vulnerability                 ║
  ╚════════════════════════════════════════════════════════════════╝
                            ↓
  ╔════════════════════════════════════════════════════════════════╗
  ║ STAGE 3: AUDITOR (Auditor Agent)                             ║
  ║ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ║
  ║ • Synthesizes Red Team + Blue Team findings                  ║
  ║ • Calculates prioritized risk score (0-100)                  ║
  ║ • Generates actionable remediation roadmap                   ║
  ║ OUTPUT: Final security audit report (JSON/MD/HTML)           ║
  ╚════════════════════════════════════════════════════════════════╝
```

## Core Components

### Scanners

#### ConfigScanner (`scanners/config-scanner.js`)
Analyzes agent configuration for security issues:
- **permissions.json**: Overly permissive paths, missing whitelists, resource limits
- **Dockerfile**: Root user execution, privileged mode, dangerous capabilities
- **Environment**: NODE_ENV, debug mode, TLS verification, CORS settings
- **File system**: .env files, secrets files in repo

**20 Rules** targeting: permissions, access control, Docker isolation

#### SecretScanner (`scanners/secret-scanner.js`)
Detects leaked secrets and credentials:
- **14+ Patterns**: AWS keys, GitHub tokens, Telegram bots, private keys, API keys, DB URLs, Stripe keys, NPM tokens, JWT, OAuth
- **Entropy Detection**: High-entropy base64 strings (potential secrets)
- **Scope**: .env files, SKILL.md, source code, logs, memory files

**14 Rules** for: API keys, tokens, private keys, passwords

#### SkillScanner (`scanners/skill-scanner.js`)
Scans skill files for code vulnerabilities:
- **Network**: HTTP/HTTPS calls, DNS lookups, unencrypted WebSocket
- **Execution**: Shell access, eval(), process execution, dangerous child processes
- **File System**: Path traversal, sensitive directory access, file deletion
- **Secrets**: Environment variable access, credential references
- **Injection**: Command substitution, SQL injection, XSS, ReDoS, prototype pollution
- **Integrity**: SHA-256 hash verification against registry

**25 Rules** for: code execution, injection attacks, unsafe patterns

#### DependencyScanner (`scanners/dependency-scanner.js`)
Analyzes supply chain security:
- **Vulnerabilities**: Known vulnerable package versions
- **Typosquatting**: Detection of imposter packages (lodash vs load-sh)
- **Postinstall Scripts**: Malicious installation hooks
- **Version Pinning**: Loose version specifications allowing vulnerable updates
- **Registry**: Non-standard or hijacked package registries
- **Lock Files**: Consistency between package.json and lock files

**20 Rules** for: dependency vulnerabilities, supply chain attacks

### Report Generator

**ReportGenerator** (`reports/report-generator.js`)
Generates comprehensive audit reports in three formats:

#### JSON Format
Programmatic-friendly structured data for CI/CD integration:
```json
{
  "metadata": { "title", "version", "timestamp" },
  "summary": { "totalIssues", "critical", "high", "medium", "low", "riskScore" },
  "findings": [ { "severity", "message", "file", "line", "remediation" } ],
  "recommendations": [ { "title", "priority", "effort", "steps" } ]
}
```

#### Markdown Format
Human-readable report for development teams:
- Executive summary with risk score
- Issues grouped by severity
- Detailed findings with context and remediation
- Remediation roadmap
- Audit configuration

#### HTML Format
Interactive dashboard with:
- Visual risk score gauge
- Summary cards (total issues, by severity)
- Color-coded finding cards
- Remediation roadmap
- Professional styling with responsive design

## Security Rules Database

**102 rules** organized into 5 categories:

### 1. Secrets & Credentials (14 rules)
- AWS keys, GitHub tokens, private keys
- Database URLs, OAuth tokens, JWT
- API keys, NPM tokens, Telegram bots
- Hardcoded passwords, high-entropy strings

### 2. Permissions & Access Control (20 rules)
- Root filesystem access, no whitelists
- Sensitive directory access (/etc, /root, /home)
- Unrestricted network access
- Shell/file deletion without approval
- Docker volume mounts, capabilities, root user
- Symlink traversal, resource limits, IPC

### 3. Injection & Code Execution (25 rules)
- Shell execution (exec, spawn, system)
- Dynamic code eval(), Function()
- Path traversal (../ patterns)
- SQL injection, XSS, LDAP injection
- Command substitution, regex DoS
- Prototype pollution, unsafe deserialization

### 4. Configuration & Dependencies (23 rules)
- Postinstall scripts, vulnerable packages
- Version pinning issues, typosquatting
- .env files in repo, debug mode enabled
- TLS verification disabled, CORS misconfiguration
- Default credentials, old TLS versions
- Logging secrets, exposed version info

### 5. Inter-Agent Communication (20 rules)
- Unencrypted HTTP/WebSocket
- Missing message authentication (HMAC)
- Hardcoded tokens, disabled SSL verification
- Missing rate limiting, CSRF tokens
- Insecure cache headers, missing security headers
- Request payload limits, connection timeouts

## Usage

### Quick Start

```bash
# Audit current directory
./run-audit.sh

# Audit specific agent
./run-audit.sh --agent ./agents/frontend-agent

# Quick scan (skip deep analysis)
./run-audit.sh --quick

# Custom output directory
./run-audit.sh --output /tmp/reports

# Generate HTML report only
./run-audit.sh --report html
```

### Programmatic Usage

```javascript
const AgentShield = require('./agentshield.js');

const shield = new AgentShield({
  quickScan: false,
  reportFormat: ['json', 'markdown', 'html']
});

// Run complete audit
const results = await shield.runAudit('./agents/myagent');

// Generate reports
await shield.generateReports('./reports/security');

// Access findings programmatically
console.log(shield.auditResults.findings);
console.log(shield.auditResults.riskScore);
```

### CI/CD Integration

```yaml
# Example GitHub Actions workflow
- name: AgentShield Security Audit
  run: |
    cd security
    ./run-audit.sh --agent ../agents/frontend --output ./reports
    
- name: Upload Security Report
  uses: actions/upload-artifact@v3
  with:
    name: security-audit
    path: security/reports/
    
- name: Fail on Critical Issues
  run: |
    CRITICAL=$(grep '"severity": "critical"' security/reports/security-audit.json | wc -l)
    if [ "$CRITICAL" -gt 0 ]; then
      echo "❌ Critical security issues found"
      exit 1
    fi
```

## Output Examples

### Risk Score Calculation

Risk Score = 0-100 scale based on vulnerability severity and count:
- Each critical issue: +25 points
- Each high issue: +10 points
- Each medium issue: +3 points
- Each low issue: +1 point

**Risk Levels:**
- 0: ✅ Excellent
- 1-19: ✅ Good
- 20-39: 🟡 Fair
- 40-59: 🟠 Concerning
- 60-79: 🔴 Critical
- 80+: 🔴 Severe

### Defense Strength Ratings

- **Strong**: Vulnerability effectively mitigated by existing controls
- **Adequate**: Vulnerability partially mitigated, additional measures recommended
- **Weak**: Minimal mitigation in place, vulnerability remains high-risk
- **None**: No defense mechanisms present

## Security Rules Format

Each rule in `rules/security-rules.json`:

```json
{
  "id": "SEC-001",
  "severity": "critical|high|medium|low",
  "category": "secrets|permissions|injection|configuration|communication",
  "pattern": "regex or detection method",
  "description": "Human-readable description",
  "detection": "regex|entropy|code_pattern|permissions_json|docker_config|etc",
  "remediation": "Actionable fix steps"
}
```

## Best Practices

### For Developers
1. Run AgentShield before committing code
2. Address all critical/high issues immediately
3. Document security decisions for medium issues
4. Keep dependencies updated

### For Security Teams
1. Schedule monthly security audits
2. Review and update security rules quarterly
3. Monitor CI/CD integration for anomalies
4. Create incident response plan for critical findings

### For DevOps
1. Integrate AgentShield into deployment pipeline
2. Fail builds on critical/high severity issues
3. Archive audit reports for compliance
4. Set up automated alerts for new vulnerabilities

## File Structure

```
security/
├── agentshield.js              # Main orchestrator (three-stage pipeline)
├── run-audit.sh                # CLI command-line interface
├── README.md                   # This file
│
├── scanners/
│   ├── config-scanner.js       # Configuration security
│   ├── secret-scanner.js       # Secret & credential detection
│   ├── skill-scanner.js        # Code vulnerability analysis
│   └── dependency-scanner.js   # Supply chain security
│
├── reports/
│   └── report-generator.js     # JSON/Markdown/HTML report generation
│
└── rules/
    └── security-rules.json     # 102 security rules database
```

## Performance

- **Quick Scan**: 10-30 seconds (config + secrets only)
- **Standard Scan**: 30-90 seconds (all scanners)
- **Full Analysis**: 2-5 minutes (with deep dependency analysis)

## Requirements

- Node.js 14+
- File system access to agent directories
- 50MB disk space for reports (depending on agent size)

## Limitations & Future Enhancements

### Current Limitations
- Regex-based pattern matching (some false positives possible)
- Limited dynamic analysis (static analysis only)
- No runtime behavior monitoring

### Planned Enhancements
- Machine learning-based anomaly detection
- Runtime behavior monitoring integration
- SBOM (Software Bill of Materials) generation
- Integration with OWASP dependency check
- Container image scanning
- API contract security validation

## Support & Contact

For security issues found by AgentShield:
- Create incident ticket with risk score and findings
- Contact: security@ai-company.dev
- Security hotline: +1-XXX-XXX-XXXX

## License

Proprietary - AI Company Internal Use Only

## Version

AgentShield v1.0.0  
Last Updated: 2026-04-11
