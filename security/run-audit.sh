#!/bin/bash

#############################################################################
#  AgentShield CLI - Security Audit Runner
#  Usage:
#    ./run-audit.sh                    # Audit everything
#    ./run-audit.sh --agent frontend   # Audit single agent
#    ./run-audit.sh --quick            # Fast scan (skip deep analysis)
#    ./run-audit.sh --report html      # Generate HTML report
#############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_PATH="${AGENT_PATH:-.}"
QUICK_SCAN=false
REPORT_FORMAT="json,markdown,html"
OUTPUT_DIR="./reports/security"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --agent)
      AGENT_PATH="$2"
      shift 2
      ;;
    --quick)
      QUICK_SCAN=true
      shift
      ;;
    --report)
      REPORT_FORMAT="$2"
      shift 2
      ;;
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      show_help
      exit 1
      ;;
  esac
done

# Function to show help
show_help() {
  cat << EOF
${PURPLE}╔════════════════════════════════════════════════════════╗
║          AgentShield Security Audit CLI                 ║
║        Red Team | Blue Team | Auditor Pipeline        ║
╚════════════════════════════════════════════════════════╝${NC}

${GREEN}Usage:${NC}
  ./run-audit.sh [options]

${GREEN}Options:${NC}
  --agent PATH          Audit a specific agent (default: current directory)
  --quick               Run quick scan (skip deep analysis)
  --report FORMAT       Report formats: json, markdown, html (default: all)
  --output DIR          Output directory (default: ./reports/security)
  --help, -h            Show this help message

${GREEN}Examples:${NC}
  # Audit entire project
  ./run-audit.sh

  # Audit specific agent
  ./run-audit.sh --agent ./agents/frontend-agent

  # Quick scan with HTML output only
  ./run-audit.sh --quick --report html

  # Custom output directory
  ./run-audit.sh --output /tmp/security-reports

EOF
}

# Function to print section headers
print_section() {
  echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

# Function to print status
print_status() {
  echo -e "${GREEN}✓${NC} $1"
}

# Function to print warning
print_warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

# Function to print error
print_error() {
  echo -e "${RED}✗${NC} $1"
}

# Main audit logic
main() {
  print_section "Starting AgentShield Security Audit"

  # Verify prerequisites
  if ! command -v node &> /dev/null; then
    print_error "Node.js is required but not installed"
    exit 1
  fi

  # Verify agent path exists
  if [ ! -d "$AGENT_PATH" ]; then
    print_error "Agent path not found: $AGENT_PATH"
    exit 1
  fi

  print_status "Agent path: $AGENT_PATH"
  print_status "Quick scan: $QUICK_SCAN"
  print_status "Report format: $REPORT_FORMAT"
  print_status "Output directory: $OUTPUT_DIR"

  # Create output directory
  mkdir -p "$OUTPUT_DIR"

  # Run Node.js audit script
  print_section "Executing AgentShield Audit Pipeline"

  node -e "
const AgentShield = require('${SCRIPT_DIR}/agentshield.js');

(async () => {
  const options = {
    quickScan: ${QUICK_SCAN},
    reportFormat: '${REPORT_FORMAT}'.split(',')
  };

  try {
    const shield = new AgentShield(options);
    const auditResult = await shield.runAudit('${AGENT_PATH}');

    // Generate reports
    const reportFiles = await shield.generateReports('${OUTPUT_DIR}');

    // Print completion summary
    console.log('\n${GREEN}╔════════════════════════════════════════════════════════╗${NC}');
    console.log('${GREEN}║                  Audit Complete                         ║${NC}');
    console.log('${GREEN}╚════════════════════════════════════════════════════════╝${NC}\n');

    console.log('${GREEN}📊 Results Summary:${NC}');
    console.log(\`   Risk Score: \${auditResult.riskScore}/100\`);
    console.log(\`   Critical Issues: \${auditResult.summary.critical}\`);
    console.log(\`   High Issues: \${auditResult.summary.high}\`);
    console.log(\`   Medium Issues: \${auditResult.summary.medium}\`);
    console.log(\`   Low Issues: \${auditResult.summary.low}\`);

    console.log('\n${GREEN}📄 Generated Reports:${NC}');
    console.log(\`   JSON: ${OUTPUT_DIR}/security-audit.json\`);
    console.log(\`   Markdown: ${OUTPUT_DIR}/security-audit.md\`);
    console.log(\`   HTML: ${OUTPUT_DIR}/security-audit.html\`);

    console.log('\n${BLUE}Next Steps:${NC}');
    console.log('  1. Review the HTML report in your browser');
    console.log('  2. Address critical issues immediately');
    console.log('  3. Plan remediation for high-priority issues');
    console.log('  4. Schedule follow-up audit in 2 weeks\n');

    process.exit(0);
  } catch (error) {
    console.error('${RED}Audit failed:${NC}', error.message);
    process.exit(1);
  }
})();
" || exit 1

  # Print final status
  if [ -f "$OUTPUT_DIR/security-audit.json" ]; then
    print_status "Audit reports generated successfully"

    # Display risk level
    RISK_SCORE=$(grep -o '"riskScore": [0-9]*' "$OUTPUT_DIR/security-audit.json" | grep -o '[0-9]*' || echo "0")
    if [ "$RISK_SCORE" -eq 0 ]; then
      echo -e "\n${GREEN}✅ Excellent${NC} - Risk Score: $RISK_SCORE/100"
    elif [ "$RISK_SCORE" -lt 20 ]; then
      echo -e "\n${GREEN}✅ Good${NC} - Risk Score: $RISK_SCORE/100"
    elif [ "$RISK_SCORE" -lt 40 ]; then
      echo -e "\n${YELLOW}🟡 Fair${NC} - Risk Score: $RISK_SCORE/100"
    elif [ "$RISK_SCORE" -lt 60 ]; then
      echo -e "\n${YELLOW}🟠 Concerning${NC} - Risk Score: $RISK_SCORE/100"
    elif [ "$RISK_SCORE" -lt 80 ]; then
      echo -e "\n${RED}🔴 Critical${NC} - Risk Score: $RISK_SCORE/100"
    else
      echo -e "\n${RED}🔴 Severe${NC} - Risk Score: $RISK_SCORE/100"
    fi

    # Open HTML report if available and running interactively
    if [ -t 1 ] && command -v xdg-open &> /dev/null; then
      read -p "Open HTML report in browser? (y/n) " -n 1 -r
      echo
      if [[ $REPLY =~ ^[Yy]$ ]]; then
        xdg-open "$OUTPUT_DIR/security-audit.html"
      fi
    fi
  else
    print_error "Failed to generate audit reports"
    exit 1
  fi
}

# Run main function
main
