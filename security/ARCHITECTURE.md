# AgentShield Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        AgentShield Security System                      │
│                          v1.0.0 - Production Ready                      │
└─────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────────┐
                              │   CLI Interface  │
                              │ (run-audit.sh)   │
                              └────────┬─────────┘
                                       │
                              ┌────────▼──────────┐
                              │  Main Orchestrator│
                              │ (agentshield.js)  │
                              └───┬───────┬───┬───┘
                                  │       │   │
                  ┌───────────────┘       │   └──────────────┐
                  │                       │                  │
          ┌───────▼────────┐      ┌──────▼────────┐  ┌──────▼──────┐
          │  STAGE 1        │      │  STAGE 2      │  │  STAGE 3    │
          │  RED TEAM       │      │  BLUE TEAM    │  │  AUDITOR    │
          │ (ATTACKER)      │      │ (DEFENDER)    │  │  (ANALYST)  │
          └───────┬────────┘      └──────┬────────┘  └──────┬──────┘
                  │                      │                  │
          ┌───────┴──────────┐          │          ┌───────▼────────┐
          │ 4 Specialized    │          │          │ Synthesizes    │
          │ Scanners:        │          │          │ Findings &     │
          │                  │          │          │ Calculates     │
          │ • ConfigScanner  │◄─────────┘          │ Risk Score     │
          │ • SecretScanner  │                     │                │
          │ • SkillScanner   │                     │ Outputs:       │
          │ • DepScanner     │                     │ • Risk Score   │
          │                  │                     │ • Priorities   │
          │ Outputs:         │                     │ • Remediation  │
          │ • Vulnerabilities│                     │ • Recommendations
          │ • Severity      │                     │                │
          │ • Exploit chains│                     └───────┬────────┘
          └───────┬─────────┘                              │
                  │                                        │
                  └────────────────┬─────────────────────┘
                                   │
                         ┌─────────▼──────────┐
                         │  Report Generator  │
                         │(report-generator)  │
                         └──────┬┬┬┬──────────┘
              ┌──────────────────┼┼┼┼──────────────────┐
              │                  │││└──────────────┐   │
              ▼                  ▼▼▼               ▼   ▼
         ┌─────────┐        ┌─────────┐      ┌─────────┐
         │  JSON   │        │Markdown │      │  HTML   │
         │ Report  │        │ Report  │      │Dashboard│
         └─────────┘        └─────────┘      └─────────┘
```

## Component Breakdown

### 1. CLI Interface (`run-audit.sh`)

**Purpose**: User-facing command-line tool

**Features**:
- Argument parsing (--agent, --quick, --report, --output)
- Environment validation
- Progress reporting with colors
- Report generation trigger
- Interactive HTML browser opening

**Exit Codes**:
- 0: Success
- 1: Critical issues found or error
- 2: Configuration error

### 2. Main Orchestrator (`agentshield.js`)

**Purpose**: Coordinates three-stage security pipeline

**Responsibilities**:
- Stage 1: Run Red Team (all scanners)
- Stage 2: Run Blue Team (defense evaluation)
- Stage 3: Run Auditor (risk synthesis)
- Report generation
- Risk score calculation

**Key Methods**:
```
runAudit()           → Main entry point
  ├── runRedTeam()   → Stage 1 attacks
  ├── runBlueTeam()  → Stage 2 defenses
  ├── runAuditor()   → Stage 3 analysis
  ├── generateReports()
  └── calculateRiskScore()
```

### 3. Scanners (4 Specialized Modules)

#### ConfigScanner (`scanners/config-scanner.js`)

**Input**: Agent directory path
**Output**: Configuration-related findings

**Scans**:
- `permissions.json`:
  - Overly permissive paths
  - Missing whitelists
  - Resource limit configuration
  - Approval requirements
  
- `Dockerfile`:
  - Root user execution
  - Privileged mode
  - Dangerous capabilities
  - Volume mount permissions
  - IPC configuration
  
- Environment:
  - NODE_ENV settings
  - Debug mode flags
  - TLS verification
  - CORS configuration
  
- Files:
  - .env in repository
  - credentials.json files
  - secrets.json files

**Rules**: 20 (SEC-020 to SEC-039)

#### SecretScanner (`scanners/secret-scanner.js`)

**Input**: Agent directory (recursive file scan)
**Output**: Secret/credential findings

**Detection Methods**:
1. **Regex Patterns** (14 types):
   - AWS keys (Access Key ID + Secret)
   - GitHub tokens (PAT, OAuth)
   - Telegram Bot Token
   - Private keys (RSA, EC, PKCS8)
   - Database URLs (MongoDB, PostgreSQL)
   - Stripe keys
   - NPM tokens
   - JWT tokens
   - OAuth tokens
   - Hardcoded passwords

2. **Entropy Analysis**:
   - Base64 string detection
   - Entropy calculation (Shannon entropy)
   - Threshold: > 5.5 bits/character
   - Length: > 40 characters

**Rules**: 14 (SEC-001 to SEC-014)

#### SkillScanner (`scanners/skill-scanner.js`)

**Input**: Skill files (SKILL.md and code)
**Output**: Code-level vulnerability findings

**Detection Areas**:

1. **Network Calls**:
   - curl, wget, fetch
   - HTTP/HTTPS modules
   - axios, request library
   - DNS lookups
   - WebSocket (unencrypted)

2. **Shell Execution**:
   - exec/execSync
   - spawn/spawnSync
   - system()
   - eval()
   - shell:true option

3. **File System Access**:
   - Path traversal (../)
   - Sensitive directories (/etc, /root)
   - File deletion (unlink, rm)
   - chmod operations
   - Symlink creation

4. **Secret Access**:
   - process.env usage
   - API_KEY/TOKEN references
   - DATABASE_URL
   - Hardcoded credentials

5. **Injection Vulnerabilities**:
   - Command substitution
   - SQL injection
   - XSS patterns
   - ReDoS (regex DoS)
   - Prototype pollution
   - Deserialization attacks

6. **Integrity**:
   - SHA-256 hash verification

**Rules**: 25 (SEC-050 to SEC-069)

#### DependencyScanner (`scanners/dependency-scanner.js`)

**Input**: package.json and lock files
**Output**: Supply chain vulnerability findings

**Analysis**:

1. **Known Vulnerabilities**:
   - Vulnerable package versions
   - Deprecated packages
   - Unmaintained dependencies

2. **Typosquatting**:
   - Similar name detection
   - Suspicious patterns (__xx--)
   - Verification against legitimate names

3. **Postinstall Scripts**:
   - Malicious patterns
   - Suspicious commands (curl, bash, nc)
   - Script analysis

4. **Version Pinning**:
   - Loose specifications (* or latest)
   - Open-ended ranges (> without <)

5. **Registry Issues**:
   - Non-standard registries
   - Authentication token in .npmrc

6. **Lock File Consistency**:
   - Multiple lock files present
   - Missing lock files

**Rules**: 20 (SEC-080 to SEC-099)

### 4. Report Generator (`reports/report-generator.js`)

**Purpose**: Generates audit reports in multiple formats

**Input**: Audit results object
**Output**: 
- `security-audit.json` (programmatic)
- `security-audit.md` (human-readable)
- `security-audit.html` (interactive dashboard)

**Report Sections**:
- Executive summary with risk score
- Findings grouped by severity
- Detailed vulnerability analysis
- Remediation roadmap
- Recommendations
- Statistics and metrics

### 5. Security Rules Database (`rules/security-rules.json`)

**Structure**: 102 rules across 5 categories

**Rule Properties**:
- `id`: Unique identifier (SEC-001, etc.)
- `severity`: critical | high | medium | low
- `category`: secrets | permissions | injection | configuration | communication
- `pattern`: Detection pattern (regex or method)
- `description`: Human-readable description
- `detection`: How pattern is detected
- `remediation`: Fix recommendations

**Categories**:
1. **Secrets** (14 rules): Credential detection
2. **Permissions** (20 rules): Access control
3. **Injection** (25 rules): Code execution vulnerabilities
4. **Configuration** (23 rules): App/system configuration
5. **Communication** (20 rules): Inter-agent communication

## Data Flow

```
Input Files
    │
    ├─► permissions.json ────┐
    ├─► Dockerfile ──────────┤
    ├─► .env files ──────────┼──► ConfigScanner ──┐
    ├─► config.json ─────────┤                    │
    ├─► source code ─────────┤                    │
    │                        └────────────────────┼─────┐
    │                                             │     │
    ├─► .env ─────┐                              │     │
    ├─► SKILL.md ─┼──► SecretScanner ────────────┼─┐   │
    ├─► .js/.ts ──┤                              │ │   │
    └─► logs ─────┘                              │ │   │
                                                 │ │   │
    ├─► skill files ───────► SkillScanner ──────┼─┼─┐ │
    │                                            │ │ │ │
    ├─► package.json ──┐                        │ │ │ │
    └─► lock files ────► DependencyScanner ─────┼─┼─┼─┤
                                                 │ │ │ │
                                        Findings: │ │ │ │
                                                 ▼ ▼ ▼ ▼
                                            ┌──────────────┐
                                            │ Consolidated │
                                            │   Findings   │
                                            └──────┬───────┘
                                                   │
                                            ┌──────▼───────┐
                                            │ Blue Team    │
                                            │ Evaluation   │
                                            │ (Defense)    │
                                            └──────┬───────┘
                                                   │
                                            ┌──────▼───────┐
                                            │ Risk Analysis│
                                            │ (Auditor)    │
                                            └──────┬───────┘
                                                   │
                                        ┌──────────┼──────────┐
                                        │          │          │
                                    ┌──▼──┐  ┌──▼──┐  ┌─▼───┐
                                    │JSON │  │ MD  │  │HTML │
                                    └─────┘  └─────┘  └─────┘
```

## Security Rules Execution

```
Rule Engine Process:
└─ Load rules/security-rules.json
   │
   ├─► For each file/config:
   │   │
   │   ├─► Apply regex patterns
   │   ├─► Check patterns against line
   │   ├─► Calculate entropy (for secrets)
   │   ├─► Evaluate permissions
   │   │
   │   └─► Add to findings:
   │       ├─ severity
   │       ├─ message
   │       ├─ file path
   │       ├─ line number
   │       ├─ code snippet
   │       └─ remediation
   │
   └─► Sort findings by:
       ├─ severity (critical > high > medium > low)
       └─ file path
```

## Risk Score Calculation

```
riskScore = min(100, sum([
  criticalFindings × 25,    // Each critical = 25 points
  highFindings × 10,        // Each high = 10 points
  mediumFindings × 3,       // Each medium = 3 points
  lowFindings × 1           // Each low = 1 point
]))

Risk Level Mapping:
0       → Excellent
1-19    → Good
20-39   → Fair
40-59   → Concerning
60-79   → Critical
80-100  → Severe
```

## Performance Characteristics

```
Scanning Time by Mode:

Quick Scan (~15-30s):
├─ ConfigScanner only
└─ No deep dependency analysis

Standard Scan (~45-90s):
├─ ConfigScanner (15s)
├─ SecretScanner (20s)
├─ SkillScanner (35s)
└─ DependencyScanner (20s)

Full Scan (~2-5 min):
├─ All scanners with depth
├─ Exploit chain analysis
├─ Deep vulnerability assessment
└─ Report generation
```

## Memory Usage

- **Baseline**: ~50MB
- **Per-agent overhead**: ~10MB
- **Peak (full scan)**: ~200-300MB

## Integration Points

```
AgentShield integrates with:

CI/CD Systems:
├─ GitHub Actions
├─ GitLab CI
├─ Jenkins
├─ CircleCI
└─ Azure Pipelines

Notification Systems:
├─ Slack
├─ Email
├─ PagerDuty
└─ Datadog

Data Storage:
├─ Local filesystem
├─ S3/Cloud storage
├─ Databases (audit logs)
└─ Time-series DB (metrics)

Issue Tracking:
├─ Jira
├─ GitHub Issues
└─ Linear
```

## Extensibility

### Adding a New Scanner

```javascript
// scanners/custom-scanner.js
class CustomScanner {
  constructor(options = {}) {
    this.findings = [];
  }
  
  async scan(path) {
    // Implementation
    return this.findings;
  }
}

module.exports = CustomScanner;

// In agentshield.js, add to runRedTeam():
const customScanner = new CustomScanner();
const customFindings = await customScanner.scan(agentPath);
findings.push(...customFindings);
```

### Adding Custom Rules

```json
{
  "id": "CUSTOM-001",
  "severity": "critical",
  "category": "custom",
  "pattern": "your_pattern",
  "description": "Custom security rule",
  "detection": "regex",
  "remediation": "Fix description"
}
```

## Limitations & Constraints

### Current Limitations
- **Static analysis only** (no runtime monitoring)
- **Regex-based** (some false positives possible)
- **File size limit** (5MB per file)
- **Directory depth limit** (10 levels)

### Planned Improvements
- ML-based anomaly detection
- Runtime behavior monitoring
- Container image scanning
- SBOM generation
- Real-time protection

## Security of AgentShield Itself

```
AgentShield Threat Model:

Threats:
├─ Malicious input files
├─ Symbolic link attacks
├─ Denial of service (large files)
└─ Privilege escalation

Mitigations:
├─ File size limits (5MB)
├─ Symlink traversal prevention
├─ Regular expression timeouts
├─ Non-root execution
└─ Isolated scan environment
```

## Version & Compatibility

- **Node.js**: 14+
- **OS**: Linux, macOS, Windows
- **Disk Space**: 50MB minimum
- **Memory**: 256MB minimum
