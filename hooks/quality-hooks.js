/**
 * Quality Hooks - Enforce code quality, testing, and formatting standards
 *
 * Enhancements:
 * - Pre-commit detection of console.log, debugger, and secrets
 * - Hook profile support (minimal/standard/strict)
 * - Cost tracker awareness
 */

const fs = require('fs');
const path = require('path');

class QualityHooks {
  constructor(options = {}) {
    this.codePatterns = {
      debugStatements: /console\.(log|warn|error|debug|trace)\(/g,
      debuggerKeyword: /\bdebugger\b/g,
      todoComments: /\/\/\s*TODO|\/\/\s*FIXME|\/\*\s*TODO|\/\*\s*FIXME/gi,
      emptyFunctions: /function\s+\w+\s*\(\s*\)\s*{\s*}/g,
      unusedVariables: /let\s+\w+\s*=.*?;.*?\n(?!.*?\1)/g,
    };

    // Secret patterns from security hooks
    this.secretPatterns = {
      apiKey: /['"](api[_-]?key['":]|sk_[a-z0-9]{20,}|pk_[a-z0-9]{20,})/gi,
      awsKey: /AKIA[0-9A-Z]{16}/g,
      jwtToken: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[\w-]*[=]{0,2}/g,
      mongoUri: /mongodb\+?srv?:\/\/[^\s]+/g,
      dbPassword: /(password|passwd|pwd)['":\s]+['"]([\w!@#$%^&*()_+-=\[\]{};:'",.<>?\\\/~`]+)['"]/gi,
      privateKey: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    };

    this.qualityThresholds = {
      minTestCoverage: 80,
      maxCyclomaticComplexity: 10,
      maxLineLength: 120,
      maxFunctionLength: 100,
    };

    this.options = options;
  }

  /**
   * PostToolUse hook - Auto-format code files
   */
  getPostToolUseAutoFormatHook() {
    return async (context) => {
      const { data } = context;
      if (!data || !data.filePath) return null;

      const filePath = data.filePath;
      const ext = path.extname(filePath).toLowerCase();

      try {
        if (!fs.existsSync(filePath)) return null;

        let formatted = false;
        const content = fs.readFileSync(filePath, 'utf-8');

        // JavaScript/TypeScript - Format with basic indentation
        if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
          const indented = this.formatJavaScript(content);
          if (indented !== content) {
            fs.writeFileSync(filePath, indented, 'utf-8');
            formatted = true;
          }
        }

        // JSON - Pretty print
        if (ext === '.json') {
          try {
            const parsed = JSON.parse(content);
            const pretty = JSON.stringify(parsed, null, 2);
            if (pretty !== content) {
              fs.writeFileSync(filePath, pretty, 'utf-8');
              formatted = true;
            }
          } catch (e) {
            // Invalid JSON, skip
          }
        }

        if (formatted) {
          return {
            modify: true,
            data: {
              ...data,
              formatted: true,
              formattedPath: filePath,
            },
          };
        }
      } catch (error) {
        console.error(`[QualityHook] Error formatting ${filePath}: ${error.message}`);
      }

      return null;
    };
  }

  /**
   * Format JavaScript code with basic rules
   */
  formatJavaScript(content) {
    let formatted = content;

    // Add missing semicolons
    formatted = formatted.replace(/([^;{}\n])\n(?=\s*(if|else|for|while|function|const|let|var|return))/g, '$1;\n');

    // Consistent spacing around operators
    formatted = formatted.replace(/([^=!<>+\-*/&|^])(=|===|!==|==|!=|<=|>=|<|>|\+|-|\/|\*|%|&|\||\^)([^=<>+\-*/&|^])/g, '$1 $2 $3');

    // Space after keywords
    formatted = formatted.replace(/\b(if|else|for|while|function|switch|catch|return)\(/g, '$1 (');

    // Space after commas
    formatted = formatted.replace(/,([^ \n])/g, ', $1');

    // Clean up multiple spaces
    formatted = formatted.replace(/  +/g, ' ');

    // Consistent indentation (2 spaces)
    const lines = formatted.split('\n');
    formatted = lines.map(line => {
      const match = line.match(/^(\t+)/);
      if (match) {
        const tabs = match[1].length;
        return '  '.repeat(tabs) + line.substring(tabs);
      }
      return line;
    }).join('\n');

    return formatted;
  }

  /**
   * PostToolUse hook - Lint check
   */
  getPostToolUseLintCheckHook() {
    return async (context) => {
      const { data } = context;
      if (!data || !data.filePath) return null;

      const filePath = data.filePath;
      const ext = path.extname(filePath).toLowerCase();

      const lintIssues = [];

      try {
        if (!fs.existsSync(filePath)) return null;

        const content = fs.readFileSync(filePath, 'utf-8');

        // Basic linting rules for all code files
        if (['.js', '.ts', '.jsx', '.tsx', '.py'].includes(ext)) {
          // Check for debug statements
          const debugMatches = content.match(/console\.(log|warn|error|debug)\(/g);
          if (debugMatches) {
            lintIssues.push({
              type: 'debug-statement',
              count: debugMatches.length,
              severity: 'warning',
            });
          }

          // Check for TODO/FIXME comments
          const todoMatches = content.match(/\/\/\s*TODO|\/\/\s*FIXME/gi);
          if (todoMatches) {
            lintIssues.push({
              type: 'todo-comment',
              count: todoMatches.length,
              severity: 'info',
            });
          }

          // Check line length
          const lines = content.split('\n');
          const longLines = lines.filter(l => l.length > this.qualityThresholds.maxLineLength);
          if (longLines.length > 0) {
            lintIssues.push({
              type: 'line-too-long',
              count: longLines.length,
              severity: 'warning',
            });
          }

          // Check function length
          const functionMatches = content.match(/function\s+\w+\s*\([^)]*\)\s*{[\s\S]*?^}/gm);
          if (functionMatches) {
            const longFunctions = functionMatches.filter(fn => fn.split('\n').length > this.qualityThresholds.maxFunctionLength);
            if (longFunctions.length > 0) {
              lintIssues.push({
                type: 'function-too-long',
                count: longFunctions.length,
                severity: 'warning',
              });
            }
          }
        }

        // JSON specific linting
        if (ext === '.json') {
          try {
            JSON.parse(content);
          } catch (e) {
            lintIssues.push({
              type: 'invalid-json',
              error: e.message,
              severity: 'error',
            });
          }
        }
      } catch (error) {
        console.error(`[QualityHook] Error linting ${filePath}: ${error.message}`);
      }

      if (lintIssues.length > 0) {
        return {
          modify: true,
          data: {
            ...data,
            lintIssues,
            lintWarnings: lintIssues.filter(i => i.severity === 'warning').length,
            lintErrors: lintIssues.filter(i => i.severity === 'error').length,
          },
        };
      }

      return null;
    };
  }

  /**
   * PostToolUse hook - Check test coverage
   */
  getPostToolUseTestCoverageHook() {
    return async (context) => {
      const { data } = context;
      if (!data || !data.coverageReport) return null;

      const coverage = data.coverageReport;
      const minCoverage = this.qualityThresholds.minTestCoverage;

      const issues = [];

      if (coverage.statements && coverage.statements < minCoverage) {
        issues.push({
          type: 'low-statement-coverage',
          current: coverage.statements,
          minimum: minCoverage,
        });
      }

      if (coverage.branches && coverage.branches < minCoverage) {
        issues.push({
          type: 'low-branch-coverage',
          current: coverage.branches,
          minimum: minCoverage,
        });
      }

      if (coverage.functions && coverage.functions < minCoverage) {
        issues.push({
          type: 'low-function-coverage',
          current: coverage.functions,
          minimum: minCoverage,
        });
      }

      if (coverage.lines && coverage.lines < minCoverage) {
        issues.push({
          type: 'low-line-coverage',
          current: coverage.lines,
          minimum: minCoverage,
        });
      }

      if (issues.length > 0) {
        return {
          modify: true,
          data: {
            ...data,
            coverageIssues: issues,
          },
        };
      }

      return null;
    };
  }

  /**
   * TaskCompleted hook - Validate output schema
   */
  getTaskCompletedSchemaValidationHook(schemas = {}) {
    return async (context) => {
      const { data, event } = context;
      if (!data || !data.taskType) return null;

      const taskType = data.taskType;
      const expectedSchema = schemas[taskType];

      if (!expectedSchema) return null;

      const validationErrors = [];

      // Validate required fields
      if (expectedSchema.required) {
        for (const field of expectedSchema.required) {
          if (!data.output || !(field in data.output)) {
            validationErrors.push({
              field,
              error: 'Missing required field',
            });
          }
        }
      }

      // Validate field types
      if (expectedSchema.properties) {
        for (const [field, schema] of Object.entries(expectedSchema.properties)) {
          if (data.output && field in data.output) {
            const value = data.output[field];
            const expectedType = schema.type;

            if (!this.validateType(value, expectedType)) {
              validationErrors.push({
                field,
                error: `Expected type ${expectedType}, got ${typeof value}`,
              });
            }
          }
        }
      }

      if (validationErrors.length > 0) {
        return {
          modify: true,
          data: {
            ...data,
            schemaValidationErrors: validationErrors,
            schemaValid: false,
          },
        };
      }

      return {
        modify: true,
        data: {
          ...data,
          schemaValid: true,
        },
      };
    };
  }

  /**
   * Validate type matching
   */
  validateType(value, expectedType) {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number';
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && !Array.isArray(value);
      case 'any':
        return true;
      default:
        return true;
    }
  }

  /**
   * PreCommit hook - Run type check (for TypeScript)
   */
  getPreCommitTypeCheckHook() {
    return async (context) => {
      const { data } = context;
      if (!data || !data.files) return null;

      const tsFiles = data.files.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));
      if (tsFiles.length === 0) return null;

      // Check if tsconfig.json exists
      const tsconfigPath = path.join(process.cwd(), 'tsconfig.json');
      if (!fs.existsSync(tsconfigPath)) {
        return null; // No TypeScript config, skip
      }

      const typeErrors = [];

      for (const file of tsFiles) {
        // Basic type checking: check for any types
        try {
          if (fs.existsSync(file)) {
            const content = fs.readFileSync(file, 'utf-8');
            const anyUsages = (content.match(/:\s*any\b/g) || []).length;

            if (anyUsages > 0) {
              typeErrors.push({
                file,
                issue: `${anyUsages} uses of 'any' type`,
                severity: 'warning',
              });
            }
          }
        } catch (error) {
          console.error(`[QualityHook] Error checking types in ${file}: ${error.message}`);
        }
      }

      if (typeErrors.length > 0) {
        return {
          modify: true,
          data: {
            ...data,
            typeErrors,
            typeCheckWarnings: typeErrors.length,
          },
        };
      }

      return null;
    };
  }

  /**
   * PreCommit hook - Detect console.log, debugger, and secrets before committing
   */
  getPreCommitDebugDetectionHook() {
    return async (context) => {
      const { data } = context;
      if (!data || !data.files) return null;

      const issues = [];

      for (const file of data.files) {
        try {
          const filePath = file.path || file;
          if (!fs.existsSync(filePath)) continue;

          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');

          // Check for console.log statements
          const consoleMatches = content.match(/console\.(log|warn|error|debug|trace)\(/g);
          if (consoleMatches) {
            issues.push({
              file: filePath,
              type: 'console-statement',
              count: consoleMatches.length,
              severity: 'warning',
              message: `Found ${consoleMatches.length} console.log/warn/error statements`,
            });
          }

          // Check for debugger keyword
          if (/\bdebugger\b/.test(content)) {
            const debuggerLines = lines
              .map((line, idx) => (line.includes('debugger') ? idx + 1 : null))
              .filter(Boolean);
            issues.push({
              file: filePath,
              type: 'debugger-keyword',
              count: debuggerLines.length,
              lines: debuggerLines,
              severity: 'error',
              message: 'Found debugger keyword - must be removed before committing',
            });
          }

          // Check for secrets
          const foundSecrets = [];
          for (const [secretType, pattern] of Object.entries(this.secretPatterns)) {
            if (pattern.test(content)) {
              foundSecrets.push(secretType);
            }
          }

          if (foundSecrets.length > 0) {
            issues.push({
              file: filePath,
              type: 'secret-detected',
              secrets: foundSecrets,
              severity: 'critical',
              message: `Potential secrets detected: ${foundSecrets.join(', ')}`,
            });
          }
        } catch (error) {
          console.error(`[QualityHook] Error scanning ${file}: ${error.message}`);
        }
      }

      if (issues.length > 0) {
        // Separate by severity
        const errors = issues.filter(i => i.severity === 'error' || i.severity === 'critical');
        const warnings = issues.filter(i => i.severity === 'warning');

        return {
          block: errors.length > 0,
          reason: errors.length > 0
            ? `Pre-commit check failed: ${errors.map(e => e.message).join('; ')}`
            : undefined,
          modify: true,
          data: {
            ...data,
            preCommitIssues: issues,
            preCommitErrors: errors.length,
            preCommitWarnings: warnings.length,
          },
        };
      }

      return null;
    };
  }

  /**
   * Create all quality hooks
   */
  createAllHooks(hookEngine, schemas = {}) {
    const hookIds = [];

    hookIds.push(
      hookEngine.registerHook(
        'PostToolUse',
        'quality-auto-format',
        this.getPostToolUseAutoFormatHook(),
        100,
        5000,
        { allowedProfiles: ['standard', 'strict'] }
      )
    );

    hookIds.push(
      hookEngine.registerHook(
        'PostToolUse',
        'quality-lint-check',
        this.getPostToolUseLintCheckHook(),
        95,
        3000,
        { allowedProfiles: ['standard', 'strict'] }
      )
    );

    hookIds.push(
      hookEngine.registerHook(
        'PostToolUse',
        'quality-test-coverage',
        this.getPostToolUseTestCoverageHook(),
        90,
        2000,
        { allowedProfiles: ['standard', 'strict'] }
      )
    );

    hookIds.push(
      hookEngine.registerHook(
        'TaskCompleted',
        'quality-schema-validation',
        this.getTaskCompletedSchemaValidationHook(schemas),
        85,
        2000,
        { allowedProfiles: ['standard', 'strict'] }
      )
    );

    hookIds.push(
      hookEngine.registerHook(
        'PreCommit',
        'quality-type-check',
        this.getPreCommitTypeCheckHook(),
        95,
        5000,
        { allowedProfiles: ['standard', 'strict'] }
      )
    );

    // NEW: Pre-commit hook for console.log, debugger, and secrets
    hookIds.push(
      hookEngine.registerHook(
        'PreCommit',
        'quality-debug-detection',
        this.getPreCommitDebugDetectionHook(),
        150,
        5000,
        { allowedProfiles: ['standard', 'strict'] }
      )
    );

    return hookIds;
  }
}

module.exports = QualityHooks;
