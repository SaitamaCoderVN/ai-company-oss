# AgentShield Implementation Guide

## Deployment & Integration

### Step 1: Installation

```bash
# Clone/initialize security module
cd /path/to/ai-company
git clone <security-module-repo> security
cd security

# Install Node dependencies
npm install

# Make CLI executable
chmod +x run-audit.sh
```

### Step 2: Configuration

Create `.agentshield.json` in project root:

```json
{
  "agents": {
    "frontend": {
      "path": "./agents/frontend-agent",
      "priority": "high",
      "criticalOnFail": true
    },
    "backend": {
      "path": "./agents/backend-agent",
      "priority": "critical",
      "criticalOnFail": true
    },
    "analytics": {
      "path": "./agents/analytics-agent",
      "priority": "medium",
      "criticalOnFail": false
    }
  },
  "rules": {
    "severityThreshold": "high",
    "enableExploitChainAnalysis": true,
    "enableEntropyScan": true
  },
  "reporting": {
    "formats": ["json", "markdown", "html"],
    "sendAlerts": true,
    "alertChannel": "slack",
    "retentionDays": 90
  }
}
```

### Step 3: CI/CD Integration

#### GitHub Actions

Create `.github/workflows/security-audit.yml`:

```yaml
name: AgentShield Security Audit

on:
  pull_request:
    paths:
      - 'agents/**'
      - 'security/**'
      - 'package.json'
  schedule:
    - cron: '0 2 * * 0'  # Weekly on Sunday at 2 AM

jobs:
  security-audit:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run AgentShield Audit
        run: |
          cd security
          ./run-audit.sh --agent ../agents --output ../reports/security
        continue-on-error: true
      
      - name: Upload Security Reports
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: security-reports
          path: reports/security/
          retention-days: 30
      
      - name: Post Results to PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v6
        with:
          script: |
            const fs = require('fs');
            const audit = JSON.parse(fs.readFileSync('./reports/security/security-audit.json', 'utf8'));
            
            const comment = `## 🛡️ AgentShield Security Audit
            
            **Risk Score:** ${audit.summary.riskScore}/100 
            **Total Issues:** ${audit.summary.total}
            
            | Severity | Count |
            |----------|-------|
            | 🔴 Critical | ${audit.summary.critical} |
            | 🟠 High | ${audit.summary.high} |
            | 🟡 Medium | ${audit.summary.medium} |
            | 🟢 Low | ${audit.summary.low} |
            
            [View Full Report](./reports/security/security-audit.html)
            `;
            
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: comment
            });
      
      - name: Fail on Critical Issues
        run: |
          CRITICAL=$(grep -c '"severity": "critical"' reports/security/security-audit.json || echo 0)
          if [ "$CRITICAL" -gt 0 ]; then
            echo "❌ Critical security issues found: $CRITICAL"
            exit 1
          fi
```

#### GitLab CI/CD

Create `.gitlab-ci.yml` section:

```yaml
security:agentshield:
  stage: test
  image: node:18
  
  script:
    - cd security
    - npm ci
    - ./run-audit.sh --agent ../agents --output ../reports/security
  
  artifacts:
    when: always
    paths:
      - reports/security/
    expire_in: 30 days
  
  allow_failure: true
  
  only:
    - merge_requests
    - schedules
```

### Step 4: Local Development Workflow

```bash
# Before committing
cd security
./run-audit.sh --agent ../agents/myagent

# Review HTML report
open reports/security/security-audit.html

# Fix issues, re-run scan
./run-audit.sh --quick --agent ../agents/myagent

# Commit only after critical/high issues are resolved
git add .
git commit -m "Fix security vulnerabilities found by AgentShield"
```

## Security Rules Customization

### Modifying Severity Levels

Edit `rules/security-rules.json`:

```json
{
  "id": "SEC-001",
  "severity": "high",        // Change from "critical" to "high"
  "description": "...",
  ...
}
```

### Adding Custom Rules

```json
{
  "id": "CUSTOM-001",
  "severity": "critical",
  "category": "injection",
  "pattern": "your_custom_pattern",
  "description": "Custom security check",
  "detection": "regex",
  "remediation": "Fix steps"
}
```

### Disabling Rules

Create `rules/disabled-rules.json`:

```json
{
  "disabledRules": [
    "SEC-027",  // Network access to localhost only
    "SEC-092"   // Debug mode enabled
  ],
  "reason": "Intentionally allowed for development",
  "approver": "security-team",
  "expiresAt": "2026-05-01"
}
```

## Alert Configuration

### Slack Integration

```javascript
// security/notifications/slack-notifier.js
const axios = require('axios');

class SlackNotifier {
  async sendAlert(findings, webhookUrl) {
    const criticalCount = findings.filter(f => f.severity === 'critical').length;
    
    if (criticalCount === 0) return;
    
    const message = {
      channel: '#security-alerts',
      username: 'AgentShield Bot',
      icon_emoji: ':shield:',
      attachments: [{
        color: 'danger',
        title: `🔴 ${criticalCount} Critical Security Issues Found`,
        text: findings.map(f => `• ${f.message}`).join('\n'),
        actions: [{
          type: 'button',
          text: 'View Full Report',
          url: 'https://ci.company.com/reports/security-audit.html'
        }]
      }]
    };
    
    await axios.post(webhookUrl, message);
  }
}
```

### Email Alerts

```javascript
// security/notifications/email-notifier.js
const nodemailer = require('nodemailer');

class EmailNotifier {
  async sendAlert(findings, recipients) {
    const summary = {
      critical: findings.filter(f => f.severity === 'critical').length,
      high: findings.filter(f => f.severity === 'high').length,
      medium: findings.filter(f => f.severity === 'medium').length
    };
    
    const subject = `Security Alert: ${summary.critical} Critical Issues Found`;
    const html = this.generateEmailBody(summary, findings);
    
    await nodemailer.sendMail({
      to: recipients.join(','),
      subject,
      html
    });
  }
}
```

## Remediation Workflows

### Critical Issue Resolution

1. **Immediate (Same Day)**
   - Isolate affected agents
   - Disable affected features
   - Notify stakeholders
   - Begin root cause analysis

2. **Short-term (24-48 Hours)**
   - Apply emergency patches
   - Implement workarounds
   - Update permissions/configs
   - Re-scan to verify fixes

3. **Long-term (1-2 Weeks)**
   - Complete architectural fixes
   - Add tests for vulnerability
   - Document security decision
   - Schedule post-incident review

### High Priority Resolution

- Schedule in next sprint
- Assign to senior engineer
- Include security review
- Add automated tests

### Medium Priority Resolution

- Include in backlog
- Plan for next release
- Document workaround if available

## Monitoring & Analytics

### Tracking Security Metrics

```javascript
// security/analytics/metrics-tracker.js
class MetricsTracker {
  // Track audit trends over time
  recordAudit(result) {
    const metric = {
      timestamp: new Date(),
      riskScore: result.riskScore,
      critical: result.summary.critical,
      high: result.summary.high,
      totalIssues: result.summary.total
    };
    
    // Store in time-series database (InfluxDB, Prometheus, etc.)
    this.db.write('agentshield.audits', metric);
  }
  
  // Generate trends report
  async generateTrends(days = 30) {
    const data = await this.db.query(`
      SELECT riskScore, critical, high, totalIssues 
      FROM agentshield.audits 
      WHERE timestamp > now() - ${days}d
    `);
    
    return {
      riskScoreTrend: this.calculateTrend(data.map(d => d.riskScore)),
      criticalTrend: this.calculateTrend(data.map(d => d.critical)),
      issueResolutionRate: this.calculateResolutionRate(data)
    };
  }
}
```

### Dashboard Metrics

Key metrics to track:

- **Risk Score Trend**: Should decrease over time
- **Critical Issues**: Should be zero or decreasing
- **MTTR (Mean Time To Remediation)**: Target < 24 hours for critical
- **False Positive Rate**: Target < 5%
- **Coverage**: Percentage of agents audited
- **Compliance Score**: % of agents passing security baseline

## Testing AgentShield

### Unit Tests

```javascript
// security/tests/config-scanner.test.js
const ConfigScanner = require('../scanners/config-scanner');
const assert = require('assert');

describe('ConfigScanner', () => {
  it('detects overly permissive permissions', async () => {
    const scanner = new ConfigScanner();
    const findings = await scanner.scanAgent('./test-agents/bad-permissions');
    
    const critical = findings.filter(f => f.severity === 'critical');
    assert(critical.length > 0, 'Should find critical permissions issues');
  });
  
  it('detects shell execution without approval', async () => {
    const scanner = new ConfigScanner();
    const findings = await scanner.scanAgent('./test-agents/no-approval');
    
    const shellExec = findings.find(f => f.ruleId === 'SEC-024');
    assert(shellExec, 'Should detect shell execution without approval');
  });
});
```

### Integration Tests

```bash
# Run full test suite
npm test

# Run specific scanner tests
npm test -- config-scanner
npm test -- secret-scanner

# Run with coverage
npm test -- --coverage
```

## Troubleshooting

### High False Positive Rate

**Problem**: Too many non-critical findings
**Solution**:
1. Review disabled-rules.json
2. Adjust regex patterns for better precision
3. Increase entropy threshold for secret detection
4. Document intentional patterns in code

### Slow Audit Performance

**Problem**: Audit taking > 5 minutes
**Solution**:
1. Use `--quick` flag to skip deep analysis
2. Exclude large directories in config
3. Run scanners in parallel for large projects
4. Consider distributed scanning

### Missing Vulnerabilities

**Problem**: AgentShield didn't find known vulnerability
**Solution**:
1. Add custom rule to rules database
2. Verify regex pattern matching correctly
3. Check if directory is in scan path
4. Report to security team for rule improvement

## Compliance & Audit Trail

### Maintaining Compliance

```javascript
// security/compliance/audit-log.js
class AuditLog {
  async recordAudit(agentPath, findings, status) {
    const entry = {
      timestamp: new Date().toISOString(),
      agentPath,
      auditedBy: process.env.GITLAB_USER_EMAIL || 'automation',
      findingsCount: findings.length,
      criticalIssues: findings.filter(f => f.severity === 'critical').length,
      status,
      hash: this.generateHash(findings)
    };
    
    // Store immutably for compliance
    await this.database.insertOne('audit_log', entry);
    
    // Archive report
    await this.archiveReport(findings, entry.timestamp);
  }
}
```

### Report Retention

- Keep all reports for minimum 2 years
- Archive to cold storage after 1 year
- Generate compliance reports quarterly
- Track remediation timeline

## Best Practices Summary

### Development Team
✅ Run AgentShield before PR submission
✅ Fix all critical/high issues before merge
✅ Document security decisions
✅ Keep dependencies updated

### Security Team
✅ Review rules quarterly
✅ Monitor audit trends
✅ Investigate anomalies
✅ Update threat models

### DevOps
✅ Automate in CI/CD
✅ Archive all reports
✅ Set up alerts
✅ Schedule regular audits

### Management
✅ Track risk score trends
✅ Review monthly metrics
✅ Plan remediation sprints
✅ Budget for security tooling

## Support

For issues, questions, or enhancements:
- Internal Wiki: https://wiki.company.internal/agentshield
- Slack Channel: #agentshield-support
- Email: security@ai-company.dev
- On-call Security: +1-XXX-XXX-XXXX

## Version History

- **v1.0.0** (2026-04-11): Initial release
  - 102 security rules
  - 4 specialized scanners
  - 3-stage pipeline
  - Multi-format reporting
