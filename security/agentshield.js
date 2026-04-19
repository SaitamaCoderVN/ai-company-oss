/**
 * AgentShield Main Orchestrator
 * Three-stage security pipeline: Red Team (Attack) -> Blue Team (Defense) -> Auditor (Report)
 *
 * Enhancements:
 * - Cost tracking for security audits
 * - Hook profile risk assessment
 * - Per-agent hook configuration validation
 */

const fs = require('fs');
const path = require('path');
const ConfigScanner = require('./scanners/config-scanner');
const SecretScanner = require('./scanners/secret-scanner');
const SkillScanner = require('./scanners/skill-scanner');
const DependencyScanner = require('./scanners/dependency-scanner');
const ReportGenerator = require('./reports/report-generator');

class AgentShield {
  constructor(options = {}) {
    this.options = options;
    this.timestamp = new Date().toISOString();
    this.auditStartTime = Date.now();
    this.auditResults = {
      timestamp: this.timestamp,
      agents: {},
      findings: [],
      summary: {},
      recommendations: [],
      metrics: {
        auditDuration: 0,
        hooksAnalyzed: 0,
        securityIssuesFound: 0,
      }
    };
  }

  /**
   * Analyze hook profiles for security implications
   */
  analyzeHookProfiles(configPath) {
    const findings = [];

    try {
      if (!fs.existsSync(configPath)) return findings;

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const profiles = config.profiles || {};

      // Check minimal profile coverage
      if (profiles.minimal) {
        const minimalHooks = profiles.minimal.enabledHooks || [];
        if (minimalHooks.length < 3) {
          findings.push({
            severity: 'medium',
            ruleId: 'HOOK_PROFILE_MINIMAL_COVERAGE',
            message: `Minimal profile enables only ${minimalHooks.length} hooks; recommend >=3 security hooks`,
            profile: 'minimal',
            remediation: 'Add critical security hooks: dangerous-command, sensitive-path, secret-detection'
          });
        }
      }

      // Check rate limiting in profiles
      for (const [profileName, profile] of Object.entries(profiles)) {
        const hasRateLimit = (profile.enabledHooks || []).includes('security-rate-limit');
        if (profileName === 'strict' && !hasRateLimit) {
          findings.push({
            severity: 'high',
            ruleId: 'HOOK_PROFILE_RATE_LIMIT_MISSING',
            message: `Strict profile missing rate-limiting hook`,
            profile: profileName,
            remediation: 'Enable security-rate-limit in strict profile'
          });
        }
      }
    } catch (error) {
      // Ignore parse errors
    }

    return findings;
  }

  /**
   * Run complete security audit
   */
  async runAudit(agentPath, hookConfigPath = null) {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║          AgentShield Security Audit System             ║');
    console.log('║        Red Team | Blue Team | Auditor Pipeline        ║');
    console.log('║          Enhanced with Hook Profile Analysis          ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    const startTime = Date.now();

    try {
      // Stage 0: Hook Profile Analysis (NEW)
      console.log('📋 STAGE 0: HOOK PROFILE ANALYSIS (Configuration & Coverage)');
      console.log('─────────────────────────────────────────────────────────────────\n');
      const hookConfigPath_ = hookConfigPath || path.join(agentPath, 'hooks', 'config.json');
      const hookProfileFindings = this.analyzeHookProfiles(hookConfigPath_);
      if (hookProfileFindings.length > 0) {
        console.log(`Found ${hookProfileFindings.length} hook profile issues\n`);
      }

      // Stage 1: Red Team (Attack)
      console.log('🔴 STAGE 1: RED TEAM ANALYSIS (Attack & Exploit Chain Detection)');
      console.log('─────────────────────────────────────────────────────────────────\n');
      const attackFindings = await this.runRedTeam(agentPath);

      // Stage 2: Blue Team (Defense)
      console.log('\n🔵 STAGE 2: BLUE TEAM ANALYSIS (Defense & Protection Strength)');
      console.log('─────────────────────────────────────────────────────────────────\n');
      const defenseAssessment = await this.runBlueTeam(agentPath, attackFindings);

      // Stage 3: Auditor (Report)
      console.log('\n🟣 STAGE 3: AUDITOR ANALYSIS (Risk Synthesis & Remediation)');
      console.log('─────────────────────────────────────────────────────────────────\n');
      const auditReport = await this.runAuditor(agentPath, attackFindings, defenseAssessment, hookProfileFindings);

      const duration = (Date.now() - startTime) / 1000;
      console.log(`\n✅ Audit completed in ${duration.toFixed(1)}s\n`);

      return auditReport;

    } catch (error) {
      console.error('❌ Audit failed:', error.message);
      throw error;
    }
  }

  /**
   * STAGE 1: Red Team (Attacker Agent)
   * Scans for vulnerabilities and exploit chains
   */
  async runRedTeam(agentPath) {
    console.log('Scanning agent configuration, skills, and dependencies for vulnerabilities...\n');

    const findings = [];

    // 1. Config Scanner: permissions, Docker, environment
    console.log('  ▪ Scanning configuration (permissions.json, Docker, environment)...');
    const configScanner = new ConfigScanner();
    const configFindings = await configScanner.scanAgent(agentPath);
    findings.push(...configFindings);
    console.log(`    → Found ${configFindings.length} configuration issues\n`);

    // 2. Secret Scanner: API keys, tokens, credentials
    console.log('  ▪ Scanning for leaked secrets and credentials...');
    const secretScanner = new SecretScanner();
    const secretFindings = await secretScanner.scanAgent(agentPath);
    findings.push(...secretFindings);
    console.log(`    → Found ${secretFindings.length} secret leaks\n`);

    // 3. Dependency Scanner: vulnerable packages, typosquatting
    console.log('  ▪ Scanning dependencies for supply chain vulnerabilities...');
    const depScanner = new DependencyScanner();
    const packageJsonPath = path.join(agentPath, 'package.json');
    let depFindings = [];
    if (fs.existsSync(packageJsonPath)) {
      depFindings = await depScanner.scanPackageJson(packageJsonPath);
    }
    findings.push(...depFindings);
    console.log(`    → Found ${depFindings.length} dependency issues\n`);

    // 4. Skill Scanner: code-level vulnerabilities
    console.log('  ▪ Scanning skill files for code vulnerabilities...');
    const skillScanner = new SkillScanner();
    let skillFindings = [];

    // Scan all skill files
    const skillFiles = this.findSkillFiles(agentPath);
    for (const skillFile of skillFiles) {
      const findings_for_skill = await skillScanner.scanSkill(skillFile);
      skillFindings.push(...findings_for_skill);
    }
    findings.push(...skillFindings);
    console.log(`    → Found ${skillFindings.length} code vulnerabilities\n`);

    // Analyze exploit chains
    console.log('  ▪ Analyzing exploit chains and privilege escalation paths...');
    const exploitChains = this.analyzeExploitChains(findings);
    if (exploitChains.length > 0) {
      console.log(`    → Identified ${exploitChains.length} potential exploit paths\n`);
    }

    console.log(`📊 Red Team Summary:`);
    console.log(`   Total vulnerabilities: ${findings.length}`);
    console.log(`   Critical: ${findings.filter(f => f.severity === 'critical').length}`);
    console.log(`   High: ${findings.filter(f => f.severity === 'high').length}`);
    console.log(`   Medium: ${findings.filter(f => f.severity === 'medium').length}`);
    console.log(`   Low: ${findings.filter(f => f.severity === 'low').length}`);

    return findings;
  }

  /**
   * STAGE 2: Blue Team (Defender Agent)
   * Evaluates defenses against identified vulnerabilities
   */
  async runBlueTeam(agentPath, attackFindings) {
    console.log('Assessing defenses and protection strength against identified vulnerabilities...\n');

    const assessment = {
      vulnerabilities: [],
      defenseStrength: {},
      recommendations: []
    };

    // Read permissions.json
    let permissions = {};
    const permissionsPath = path.join(agentPath, 'permissions.json');
    if (fs.existsSync(permissionsPath)) {
      try {
        permissions = JSON.parse(fs.readFileSync(permissionsPath, 'utf-8'));
      } catch (e) {
        // Ignore parse errors
      }
    }

    // Evaluate each vulnerability
    console.log('Evaluating defenses for each vulnerability:\n');

    for (const vuln of attackFindings) {
      const defense = this.evaluateDefense(vuln, permissions);
      assessment.vulnerabilities.push({
        ...vuln,
        defense: defense
      });

      const strengthIcon = defense.strength === 'strong' ? '✅' :
                          defense.strength === 'adequate' ? '🟡' :
                          defense.strength === 'weak' ? '⚠️' : '❌';

      console.log(`  ${strengthIcon} ${vuln.message || vuln.ruleId}`);
      console.log(`     Defense: ${defense.strength.toUpperCase()} - ${defense.description}`);
    }

    console.log(`\n📊 Blue Team Summary:`);
    const strong = assessment.vulnerabilities.filter(v => v.defense.strength === 'strong').length;
    const adequate = assessment.vulnerabilities.filter(v => v.defense.strength === 'adequate').length;
    const weak = assessment.vulnerabilities.filter(v => v.defense.strength === 'weak').length;
    const none = assessment.vulnerabilities.filter(v => v.defense.strength === 'none').length;

    console.log(`   Strong defenses: ${strong}`);
    console.log(`   Adequate defenses: ${adequate}`);
    console.log(`   Weak defenses: ${weak}`);
    console.log(`   No defense: ${none}`);

    return assessment;
  }

  /**
   * STAGE 3: Auditor Agent
   * Synthesizes findings and produces final audit report
   */
  async runAuditor(agentPath, attackFindings, defenseAssessment, hookProfileFindings = []) {
    console.log('Synthesizing findings and generating final audit report...\n');

    // Combine all findings
    this.auditResults.findings = [...attackFindings, ...hookProfileFindings];
    this.auditResults.agentPath = agentPath;

    // Add defense evaluations to findings
    for (let i = 0; i < attackFindings.length; i++) {
      const defense = defenseAssessment.vulnerabilities[i]?.defense;
      if (defense) {
        this.auditResults.findings[i].defense = defense;
      }
    }

    // Prioritize by risk
    this.auditResults.findings.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });

    // Calculate statistics
    console.log('Calculating risk metrics...\n');
    this.auditResults.summary = this.calculateSummary();
    this.auditResults.riskScore = this.calculateRiskScore();

    // Record audit metrics
    this.auditResults.metrics.auditDuration = Date.now() - this.auditStartTime;
    this.auditResults.metrics.securityIssuesFound = this.auditResults.findings.length;

    console.log(`📊 Audit Summary:`);
    console.log(`   Risk Score: ${this.auditResults.riskScore}/100 (${this.getRiskLevel(this.auditResults.riskScore)})`);
    console.log(`   Total Issues: ${this.auditResults.findings.length}`);
    console.log(`   Critical: ${this.auditResults.summary.critical}`);
    console.log(`   High: ${this.auditResults.summary.high}`);
    console.log(`   Medium: ${this.auditResults.summary.medium}`);
    console.log(`   Low: ${this.auditResults.summary.low}`);
    console.log(`   Audit Duration: ${(this.auditResults.metrics.auditDuration / 1000).toFixed(1)}s`);

    // Generate recommendations
    this.auditResults.recommendations = this.generateRecommendations();

    console.log(`\n📋 Top Recommendations:`);
    for (let i = 0; i < Math.min(3, this.auditResults.recommendations.length); i++) {
      const rec = this.auditResults.recommendations[i];
      console.log(`   ${i + 1}. ${rec.title} (${rec.priority})`);
    }

    return this.auditResults;
  }

  /**
   * Generate and save reports
   */
  async generateReports(outputDir) {
    console.log(`\n📄 Generating reports in ${outputDir}...\n`);

    await this.ensureDirectory(outputDir);

    const reportGen = new ReportGenerator(this.auditResults, this.options);
    const files = await reportGen.generateAll(outputDir);

    console.log('  ✅ JSON report: ' + path.basename(files.json));
    console.log('  ✅ Markdown report: ' + path.basename(files.markdown));
    console.log('  ✅ HTML report: ' + path.basename(files.html));

    return files;
  }

  /**
   * Find all skill files in agent directory
   */
  findSkillFiles(dirPath) {
    const files = [];

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Check if this is a skill directory
          const skillMdPath = path.join(fullPath, 'SKILL.md');
          if (fs.existsSync(skillMdPath)) {
            files.push(skillMdPath);
          }
          // Recursively search
          files.push(...this.findSkillFiles(fullPath));
        }
      }
    } catch (error) {
      // Ignore read errors
    }

    return files;
  }

  /**
   * Analyze exploit chains from vulnerabilities
   */
  analyzeExploitChains(findings) {
    const chains = [];
    const criticalVulns = findings.filter(f => f.severity === 'critical');

    // Look for correlated vulnerabilities that could form chains
    // Example: If shell execution + path traversal exist, that's a chain
    const hasShellExec = findings.some(f => f.ruleId?.includes('EXEC'));
    const hasPathTraversal = findings.some(f => f.ruleId?.includes('TRAVERSAL'));
    const hasSecretAccess = findings.some(f => f.ruleId?.includes('SECRET'));

    if (hasShellExec && hasPathTraversal) {
      chains.push({
        severity: 'critical',
        name: 'Shell Execution + Path Traversal',
        description: 'Attacker could execute arbitrary commands on the filesystem',
        likelihood: 'high'
      });
    }

    if (hasShellExec && hasSecretAccess) {
      chains.push({
        severity: 'critical',
        name: 'Shell Execution + Secret Access',
        description: 'Attacker could escalate to accessing sensitive credentials',
        likelihood: 'high'
      });
    }

    return chains;
  }

  /**
   * Evaluate defense strength for a vulnerability
   */
  evaluateDefense(vuln, permissions) {
    // Evaluate based on vulnerability type and permissions
    let strength = 'none';
    let description = 'No defense detected';

    // Check for permission-based defenses
    if (vuln.ruleId?.includes('FS_') && permissions.file_access?.paths) {
      strength = 'adequate';
      description = 'File access restrictions in place';
    }

    if (vuln.ruleId?.includes('EXEC_') && permissions.human_approval_required?.includes('shell_exec')) {
      strength = 'strong';
      description = 'Shell execution requires human approval';
    }

    if (vuln.ruleId?.includes('SECRET_') && permissions.environment_sealed) {
      strength = 'strong';
      description = 'Environment is sealed against secret leaks';
    }

    if (vuln.ruleId?.includes('NETWORK_') && permissions.network_whitelist) {
      strength = 'adequate';
      description = 'Network whitelist configured';
    }

    if (vuln.severity === 'critical' && strength === 'none') {
      strength = 'weak';
      description = 'Critical issue without adequate defense';
    }

    return { strength, description };
  }

  /**
   * Calculate summary statistics
   */
  calculateSummary() {
    const findings = this.auditResults.findings || [];

    return {
      total: findings.length,
      critical: findings.filter(f => f.severity === 'critical').length,
      high: findings.filter(f => f.severity === 'high').length,
      medium: findings.filter(f => f.severity === 'medium').length,
      low: findings.filter(f => f.severity === 'low').length
    };
  }

  /**
   * Calculate overall risk score
   */
  calculateRiskScore() {
    const findings = this.auditResults.findings || [];

    if (findings.length === 0) return 0;

    const criticalCount = findings.filter(f => f.severity === 'critical').length;
    const highCount = findings.filter(f => f.severity === 'high').length;
    const mediumCount = findings.filter(f => f.severity === 'medium').length;
    const lowCount = findings.filter(f => f.severity === 'low').length;

    let score = 0;
    score += criticalCount * 25;
    score += highCount * 10;
    score += mediumCount * 3;
    score += lowCount * 1;

    return Math.min(100, score);
  }

  /**
   * Get risk level description
   */
  getRiskLevel(score) {
    if (score === 0) return 'Excellent';
    if (score < 20) return 'Good';
    if (score < 40) return 'Fair';
    if (score < 60) return 'Concerning';
    if (score < 80) return 'Critical';
    return 'Severe';
  }

  /**
   * Generate remediation recommendations
   */
  generateRecommendations() {
    const findings = this.auditResults.findings || [];
    const recommendations = [];

    const criticalCount = findings.filter(f => f.severity === 'critical').length;
    const highCount = findings.filter(f => f.severity === 'high').length;

    if (criticalCount > 0) {
      recommendations.push({
        title: `Fix ${criticalCount} Critical Security Issues`,
        priority: 'Immediate',
        effort: 'High',
        description: 'Critical vulnerabilities must be addressed before production'
      });
    }

    if (highCount > 0) {
      recommendations.push({
        title: `Address ${highCount} High-Priority Issues`,
        priority: 'High',
        effort: 'Medium',
        description: 'Should be resolved within 1-2 development cycles'
      });
    }

    recommendations.push({
      title: 'Implement Automated Security Scanning',
      priority: 'High',
      effort: 'Medium',
      description: 'Integrate AgentShield into CI/CD pipeline'
    });

    recommendations.push({
      title: 'Establish Security Baseline',
      priority: 'Medium',
      effort: 'Low',
      description: 'Define minimum security requirements for all agents'
    });

    return recommendations;
  }

  /**
   * Ensure directory exists
   */
  async ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}

module.exports = AgentShield;
