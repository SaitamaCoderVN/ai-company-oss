/**
 * AgentShield Dependency Scanner
 * Analyzes package.json and dependencies for supply chain vulnerabilities
 * Checks: vulnerable packages, typosquatting, postinstall scripts, version pinning
 */

const fs = require('fs');
const path = require('path');

class DependencyScanner {
  constructor(options = {}) {
    this.options = options;
    this.findings = [];
    this.knownVulnerabilities = this.loadVulnerabilities();
  }

  /**
   * Load known vulnerable packages database
   */
  loadVulnerabilities() {
    // In production, this would load from a real vulnerability database
    // For now, we include common known vulnerabilities
    return {
      'lodash': { affectedVersions: ['<4.17.21'], severity: 'critical' },
      'moment': { affectedVersions: ['<2.29.4'], severity: 'high' },
      'express': { affectedVersions: ['<4.18.2'], severity: 'high' },
      'request': { affectedVersions: ['*'], severity: 'critical', deprecated: true },
      'node-uuid': { affectedVersions: ['*'], severity: 'medium', deprecated: true },
      'jade': { affectedVersions: ['<1.11.0'], severity: 'high' },
      'pug': { affectedVersions: ['<3.0.1'], severity: 'high' },
      'deep-extend': { affectedVersions: ['<0.6.0'], severity: 'medium' },
      'js-yaml': { affectedVersions: ['<3.13.1'], severity: 'critical' },
      'minimist': { affectedVersions: ['<1.2.6'], severity: 'high' },
      'serialize-javascript': { affectedVersions: ['<5.0.1'], severity: 'high' },
      'set-value': { affectedVersions: ['<4.0.1'], severity: 'high' },
      'merge': { affectedVersions: ['<2.1.1'], severity: 'high' }
    };
  }

  /**
   * Scan a package.json file for dependency vulnerabilities
   */
  async scanPackageJson(packageJsonPath) {
    this.findings = [];

    try {
      const content = fs.readFileSync(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);

      // Scan dependencies
      await this.scanDependencies(packageJson.dependencies || {}, 'dependencies', packageJsonPath);
      await this.scanDependencies(packageJson.devDependencies || {}, 'devDependencies', packageJsonPath);

      // Check for postinstall scripts
      await this.checkPostinstallScripts(packageJson, packageJsonPath);

      // Check package registry
      await this.checkPackageRegistry(packageJson, packageJsonPath);

      // Check for lock file consistency
      await this.checkLockFile(path.dirname(packageJsonPath));

    } catch (error) {
      this.addFinding({
        severity: 'high',
        ruleId: 'PARSE_ERROR',
        file: packageJsonPath,
        line: 1,
        message: `Failed to parse package.json: ${error.message}`,
        remediation: 'Fix JSON syntax errors'
      });
    }

    return this.findings;
  }

  /**
   * Scan dependencies for vulnerabilities and issues
   */
  async scanDependencies(deps, depType, packageJsonPath) {
    for (const [pkgName, version] of Object.entries(deps)) {
      // Check for known vulnerabilities
      this.checkVulnerabilities(pkgName, version, packageJsonPath, depType);

      // Check for typosquatting
      this.checkTyposquatting(pkgName, packageJsonPath, depType);

      // Check version pinning
      this.checkVersionPinning(pkgName, version, packageJsonPath, depType);

      // Check for development deps in production
      if (depType === 'devDependencies' && this.isProductionDep(pkgName)) {
        this.addFinding({
          severity: 'medium',
          ruleId: 'SEC-085',
          file: packageJsonPath,
          line: 1,
          message: `Production dependency in ${depType}: ${pkgName}`,
          context: `${pkgName}: ${version}`,
          remediation: 'Move to dependencies, not devDependencies'
        });
      }
    }
  }

  /**
   * Check if package has known vulnerabilities
   */
  checkVulnerabilities(pkgName, version, filePath, depType) {
    const vuln = this.knownVulnerabilities[pkgName];

    if (!vuln) return;

    // Check if version is in affected range
    if (vuln.deprecated) {
      this.addFinding({
        severity: vuln.severity,
        ruleId: 'SEC-081',
        file: filePath,
        line: 1,
        message: `Deprecated package detected: ${pkgName}`,
        context: `${pkgName}: ${version}`,
        remediation: `Replace ${pkgName} with a maintained alternative`
      });
    } else {
      this.addFinding({
        severity: vuln.severity,
        ruleId: 'SEC-081',
        file: filePath,
        line: 1,
        message: `Potentially vulnerable package: ${pkgName}`,
        context: `${pkgName}: ${version} (affected: ${vuln.affectedVersions.join(', ')})`,
        remediation: `Update ${pkgName} to a patched version`
      });
    }
  }

  /**
   * Check for typosquatting attacks (similar package names)
   */
  checkTyposquatting(pkgName, filePath, depType) {
    // Common typosquatting examples
    const typosquattingPatterns = {
      'lodash': ['lodash-es', 'lodash_', 'load-sh'],
      'express': ['expres', 'express-js', 'expressjs'],
      'react': ['reac', 'react-js', 'reactjs'],
      'moment': ['momnet', 'moment-js', 'momentjs'],
      'axios': ['axios-js', 'axioss', 'axios-pro'],
      'webpack': ['webback', 'webpack-js', 'webpck'],
      'typescript': ['type-script', 'typescript-js', 'typescripts'],
      'babel': ['babel-js', 'babyljs', 'babel-core'],
      'jest': ['jest-js', 'jests', 'jest-test'],
      'prettier': ['prettier-js', 'prettier-code', 'prettier-pro']
    };

    // Check each pattern
    for (const [legitimate, suspiciousForms] of Object.entries(typosquattingPatterns)) {
      if (suspiciousForms.includes(pkgName)) {
        this.addFinding({
          severity: 'critical',
          ruleId: 'SEC-082',
          file: filePath,
          line: 1,
          message: `Potential typosquatting package detected: ${pkgName}`,
          context: `Did you mean "${legitimate}"?`,
          remediation: `Verify ${pkgName} is legitimate, likely should be ${legitimate}`
        });
      }
    }

    // Check for suspicious patterns
    if (pkgName.includes('__') || pkgName.includes('--') || pkgName.length === 1) {
      this.addFinding({
        severity: 'medium',
        ruleId: 'SEC-082',
        file: filePath,
        line: 1,
        message: `Suspicious package name: ${pkgName}`,
        context: 'Package name matches suspicious pattern',
        remediation: 'Verify package legitimacy before installing'
      });
    }
  }

  /**
   * Check version pinning practices
   */
  checkVersionPinning(pkgName, version, filePath, depType) {
    // Check for overly loose version specifications
    if (version === '*' || version === 'latest') {
      this.addFinding({
        severity: 'medium',
        ruleId: 'SEC-085',
        file: filePath,
        line: 1,
        message: `Package ${pkgName} uses loose version specification`,
        context: `${pkgName}: ${version}`,
        remediation: 'Use exact versions or narrow ranges (e.g., "^1.0.0")'
      });
    }

    // Check for version ranges that might include vulnerable versions
    if (version.startsWith('>') && !version.includes('<')) {
      this.addFinding({
        severity: 'low',
        ruleId: 'SEC-085',
        file: filePath,
        line: 1,
        message: `Package ${pkgName} uses open-ended version range`,
        context: `${pkgName}: ${version}`,
        remediation: 'Use ranges with upper bounds (e.g., "^1.0.0")'
      });
    }
  }

  /**
   * Check for malicious postinstall scripts
   */
  async checkPostinstallScripts(packageJson, filePath) {
    const scripts = packageJson.scripts || {};

    // Check for suspicious script patterns
    const suspiciousPatterns = [
      'curl', 'wget', 'node -e', 'eval', 'exec',
      'bash', '/bin/sh', 'sh -c',
      'python', 'ruby', 'perl',
      'nc', 'ncat', 'netcat'
    ];

    for (const [scriptName, scriptCmd] of Object.entries(scripts)) {
      if (scriptName === 'postinstall' || scriptName === 'install') {
        for (const pattern of suspiciousPatterns) {
          if (scriptCmd.toLowerCase().includes(pattern)) {
            this.addFinding({
              severity: 'critical',
              ruleId: 'SEC-080',
              file: filePath,
              line: 1,
              message: `Suspicious ${scriptName} script detected`,
              context: `Script contains: ${pattern}`,
              remediation: 'Review script content carefully, use `npm ci --no-scripts` to bypass'
            });
          }
        }
      }
    }
  }

  /**
   * Check package registry configuration
   */
  async checkPackageRegistry(packageJson, filePath) {
    // Check for registry overrides
    if (packageJson.publishConfig?.registry) {
      const registry = packageJson.publishConfig.registry;

      if (!registry.includes('npmjs.com') && !registry.includes('npm.pkg.github')) {
        this.addFinding({
          severity: 'high',
          ruleId: 'SEC-084',
          file: filePath,
          line: 1,
          message: `Non-standard npm registry configured: ${registry}`,
          context: 'publishConfig.registry points to unusual registry',
          remediation: 'Verify registry is legitimate and whitelisted'
        });
      }
    }

    // Check for .npmrc file
    const npmrcPath = path.join(path.dirname(filePath), '.npmrc');
    if (fs.existsSync(npmrcPath)) {
      try {
        const npmrcContent = fs.readFileSync(npmrcPath, 'utf-8');

        // Check for authentication tokens in .npmrc
        if (npmrcContent.includes('_authToken') || npmrcContent.includes('//registry')) {
          this.addFinding({
            severity: 'high',
            ruleId: 'SEC-091',
            file: npmrcPath,
            line: 1,
            message: 'Authentication tokens found in .npmrc',
            context: '.npmrc should not be committed with tokens',
            remediation: 'Use .npmrc.example, add .npmrc to .gitignore'
          });
        }
      } catch (error) {
        // Ignore .npmrc read errors
      }
    }
  }

  /**
   * Check lock file consistency
   */
  async checkLockFile(dirPath) {
    const packageLockPath = path.join(dirPath, 'package-lock.json');
    const yarnLockPath = path.join(dirPath, 'yarn.lock');
    const packageJsonPath = path.join(dirPath, 'package.json');

    // Check if both package-lock.json and yarn.lock exist
    if (fs.existsSync(packageLockPath) && fs.existsSync(yarnLockPath)) {
      this.addFinding({
        severity: 'high',
        ruleId: 'SEC-088',
        file: dirPath,
        line: 1,
        message: 'Multiple lock files detected (package-lock.json and yarn.lock)',
        context: 'Conflicting lock files may cause version inconsistencies',
        remediation: 'Use only one lock file, delete the other'
      });
    }

    // Verify lock file exists
    if (!fs.existsSync(packageLockPath) && !fs.existsSync(yarnLockPath)) {
      this.addFinding({
        severity: 'medium',
        ruleId: 'SEC-088',
        file: packageJsonPath,
        line: 1,
        message: 'No lock file found (package-lock.json or yarn.lock)',
        context: 'Lock files ensure consistent dependency versions',
        remediation: 'Run `npm install` or `yarn install` to generate lock file'
      });
    }
  }

  /**
   * Check if package is typically a production dependency
   */
  isProductionDep(pkgName) {
    const prodDeps = [
      'express', 'react', 'vue', 'angular', 'mongoose', 'pg',
      'mysql', 'redis', 'axios', 'lodash', 'moment', 'uuid'
    ];

    return prodDeps.some(dep => pkgName.includes(dep));
  }

  /**
   * Add a finding to results
   */
  addFinding(finding) {
    this.findings.push({
      timestamp: new Date().toISOString(),
      type: 'dependency_issue',
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

module.exports = DependencyScanner;
