import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  gray: '\x1b[90m'
};

class Logger {
  constructor(level = 'info') {
    this.level = LOG_LEVELS[level] || LOG_LEVELS.info;
  }

  formatTimestamp() {
    return new Date().toISOString();
  }

  formatMessage(levelName, message, data = null) {
    const timestamp = this.formatTimestamp();
    let output = `[${timestamp}] [${levelName}] ${message}`;
    if (data) {
      output += ` ${JSON.stringify(data, null, 2)}`;
    }
    return output;
  }

  error(message, data = null) {
    if (this.level >= LOG_LEVELS.error) {
      console.error(
        `${COLORS.red}${this.formatMessage('ERROR', message, data)}${COLORS.reset}`
      );
    }
  }

  warn(message, data = null) {
    if (this.level >= LOG_LEVELS.warn) {
      console.warn(
        `${COLORS.yellow}${this.formatMessage('WARN', message, data)}${COLORS.reset}`
      );
    }
  }

  info(message, data = null) {
    if (this.level >= LOG_LEVELS.info) {
      console.log(
        `${COLORS.blue}${this.formatMessage('INFO', message, data)}${COLORS.reset}`
      );
    }
  }

  debug(message, data = null) {
    if (this.level >= LOG_LEVELS.debug) {
      console.log(
        `${COLORS.gray}${this.formatMessage('DEBUG', message, data)}${COLORS.reset}`
      );
    }
  }

  success(message, data = null) {
    console.log(
      `${COLORS.green}${this.formatMessage('SUCCESS', message, data)}${COLORS.reset}`
    );
  }
}

export default new Logger(process.env.LOG_LEVEL || 'info');
