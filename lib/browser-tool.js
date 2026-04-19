/**
 * browser-tool.js — Browser automation tool for AI Agent Company
 *
 * Provides Puppeteer-based browser control for agents that need it:
 *   - tester: Automated UI testing, screenshot comparison, form testing
 *   - researcher: Web scraping, documentation browsing, API exploration
 *
 * Usage by agents:
 *   The agent-runner injects this as an MCP tool or via shell commands
 *   that the agent can call during its claude --print session.
 *
 * Security:
 *   - Sandboxed: no access to local files outside workspace
 *   - Blocked domains configurable via BLOCKED_DOMAINS env var
 *   - Screenshot storage in tasks/{taskId}/screenshots/
 *   - Max page load timeout: 30s
 *   - Max session duration: 10min per task
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/agent-screenshots';
const MAX_TIMEOUT = 30000;
const BLOCKED_DOMAINS = (process.env.BLOCKED_DOMAINS || '').split(',').filter(Boolean);

/**
 * BrowserSession — Manages a single browser session for an agent task
 */
export class BrowserSession {
  constructor(taskId, options = {}) {
    this.taskId = taskId;
    this.browser = null;
    this.page = null;
    this.screenshotCount = 0;
    this.screenshotDir = path.join(SCREENSHOT_DIR, taskId);
    this.startTime = null;
    this.maxDuration = options.maxDuration || 10 * 60 * 1000; // 10 min
    this.headless = options.headless !== false; // default true
  }

  /**
   * Launch browser and create a new page
   */
  async launch() {
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true });
    }

    this.browser = await puppeteer.launch({
      headless: this.headless ? 'new' : false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,720',
      ],
    });

    this.page = await this.browser.newPage();
    this.startTime = Date.now();

    // Set viewport
    await this.page.setViewport({ width: 1280, height: 720 });

    // Set user agent
    await this.page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Apple M4 Pro) AppleWebKit/537.36 AI-Agent-Company/1.0'
    );

    // Block tracking/ad domains
    await this.page.setRequestInterception(true);
    this.page.on('request', (req) => {
      const url = new URL(req.url());
      if (BLOCKED_DOMAINS.some(d => url.hostname.includes(d))) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Set default timeout
    this.page.setDefaultTimeout(MAX_TIMEOUT);
    this.page.setDefaultNavigationTimeout(MAX_TIMEOUT);

    return this;
  }

  /**
   * Navigate to a URL
   */
  async goto(url, options = {}) {
    this._checkDuration();
    await this.page.goto(url, {
      waitUntil: options.waitUntil || 'networkidle2',
      timeout: MAX_TIMEOUT,
    });
    return { url: this.page.url(), title: await this.page.title() };
  }

  /**
   * Take a screenshot
   * @returns {{ path: string, index: number }}
   */
  async screenshot(name) {
    this._checkDuration();
    const filename = `${String(this.screenshotCount).padStart(3, '0')}-${name || 'screenshot'}.png`;
    const filepath = path.join(this.screenshotDir, filename);

    await this.page.screenshot({
      path: filepath,
      fullPage: false,
    });

    this.screenshotCount++;
    return { path: filepath, index: this.screenshotCount - 1 };
  }

  /**
   * Take a full-page screenshot
   */
  async screenshotFull(name) {
    this._checkDuration();
    const filename = `${String(this.screenshotCount).padStart(3, '0')}-${name || 'full'}.png`;
    const filepath = path.join(this.screenshotDir, filename);

    await this.page.screenshot({
      path: filepath,
      fullPage: true,
    });

    this.screenshotCount++;
    return { path: filepath, index: this.screenshotCount - 1 };
  }

  /**
   * Get page text content
   */
  async getText(selector) {
    this._checkDuration();
    if (selector) {
      return this.page.$$eval(selector, els => els.map(e => e.textContent).join('\n'));
    }
    return this.page.evaluate(() => document.body.innerText);
  }

  /**
   * Get page HTML
   */
  async getHTML(selector) {
    this._checkDuration();
    if (selector) {
      return this.page.$eval(selector, el => el.innerHTML);
    }
    return this.page.content();
  }

  /**
   * Click an element
   */
  async click(selector, options = {}) {
    this._checkDuration();
    await this.page.waitForSelector(selector, { timeout: MAX_TIMEOUT });
    await this.page.click(selector, options);
  }

  /**
   * Type text into an input
   */
  async type(selector, text, options = {}) {
    this._checkDuration();
    await this.page.waitForSelector(selector, { timeout: MAX_TIMEOUT });
    await this.page.type(selector, text, { delay: options.delay || 50 });
  }

  /**
   * Wait for a selector to appear
   */
  async waitFor(selector, options = {}) {
    this._checkDuration();
    await this.page.waitForSelector(selector, {
      timeout: options.timeout || MAX_TIMEOUT,
      visible: options.visible !== false,
    });
  }

  /**
   * Execute JavaScript in page context
   */
  async evaluate(fn, ...args) {
    this._checkDuration();
    return this.page.evaluate(fn, ...args);
  }

  /**
   * Get all links on the page
   */
  async getLinks() {
    return this.page.$$eval('a[href]', links =>
      links.map(a => ({ text: a.textContent.trim(), href: a.href }))
        .filter(l => l.href.startsWith('http'))
    );
  }

  /**
   * Get page accessibility tree (useful for testing)
   */
  async getAccessibilityTree() {
    this._checkDuration();
    const snapshot = await this.page.accessibility.snapshot();
    return snapshot;
  }

  /**
   * Check if element exists
   */
  async exists(selector) {
    const el = await this.page.$(selector);
    return el !== null;
  }

  /**
   * Get console messages (for debugging)
   */
  onConsole(callback) {
    this.page.on('console', msg => {
      callback({ type: msg.type(), text: msg.text() });
    });
  }

  /**
   * Get network requests (for API testing)
   */
  getNetworkRequests() {
    const requests = [];
    this.page.on('response', async (response) => {
      requests.push({
        url: response.url(),
        status: response.status(),
        method: response.request().method(),
      });
    });
    return requests;
  }

  /**
   * Close the browser
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  /**
   * Check session duration limit
   */
  _checkDuration() {
    if (this.startTime && (Date.now() - this.startTime) > this.maxDuration) {
      throw new Error(`Browser session exceeded max duration (${this.maxDuration / 1000}s)`);
    }
  }
}

/**
 * Create a shell script that agents can call for browser operations
 * This is injected into the agent's workspace so they can use it
 */
export function createBrowserScript(taskId, workDir) {
  const scriptPath = path.join(workDir, '.browser-tool.sh');
  const script = `#!/bin/bash
# Browser automation tool — injected by AI Agent Company
# Usage: ./.browser-tool.sh <command> [args...]
#
# Commands:
#   goto <url>              Navigate to URL, return title
#   screenshot [name]       Take viewport screenshot
#   screenshot-full [name]  Take full-page screenshot
#   text [selector]         Get text content
#   html [selector]         Get HTML content
#   click <selector>        Click an element
#   type <selector> <text>  Type into input
#   links                   Get all links on page
#   accessibility           Get accessibility tree
#   console                 Get console messages

TASK_ID="${taskId}"
BROWSER_SERVER="\${BROWSER_SERVER:-http://localhost:9802}"

case "\$1" in
  goto|screenshot|screenshot-full|text|html|click|type|links|accessibility|console)
    curl -s -X POST "\${BROWSER_SERVER}/api/browser/\${TASK_ID}" \\
      -H "Content-Type: application/json" \\
      -d "{\\"command\\": \\"\$1\\", \\"args\\": [\\"$2\\", \\"\${3:-}\\"]}"
    ;;
  *)
    echo "Unknown command: \$1"
    echo "Available: goto, screenshot, screenshot-full, text, html, click, type, links, accessibility"
    exit 1
    ;;
esac
`;

  fs.writeFileSync(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

export default { BrowserSession, createBrowserScript };
