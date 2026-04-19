import { execSync, exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';

/**
 * WorkspaceManager — Git worktree lifecycle for agent isolation
 *
 * Each agent gets its own git worktree (branch) so they can work
 * in parallel without conflicts. When done, creates a PR.
 */

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(process.env.HOME, 'workspace');

class WorkspaceManager {
  constructor() {
    this.activeWorktrees = new Map(); // agentName → { branch, worktreePath, repoPath }
  }

  /**
   * Ensure the workspace root directory exists
   */
  ensureWorkspaceRoot() {
    if (!fs.existsSync(WORKSPACE_ROOT)) {
      fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
      logger.info('Created workspace root', { path: WORKSPACE_ROOT });
    }
  }

  /**
   * Get the project repo path. If WORKSPACE_REPO is set, use that.
   * Otherwise look for the first git repo in WORKSPACE_ROOT.
   */
  getRepoPath() {
    const envRepo = process.env.WORKSPACE_REPO;
    if (envRepo) {
      const resolved = path.resolve(envRepo);
      if (fs.existsSync(path.join(resolved, '.git'))) return resolved;
    }

    // Scan workspace root for git repos
    this.ensureWorkspaceRoot();
    const entries = fs.readdirSync(WORKSPACE_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const candidate = path.join(WORKSPACE_ROOT, entry.name);
        if (fs.existsSync(path.join(candidate, '.git'))) return candidate;
      }
    }

    return null;
  }

  /**
   * Create a git worktree for an agent working on a specific task
   *
   * @param {string} agentName - e.g. "frontend"
   * @param {string} taskId - e.g. "task-1234"
   * @param {string} repoPath - path to the main git repo
   * @returns {{ worktreePath: string, branch: string } | null}
   */
  createWorktree(agentName, taskId, repoPath) {
    if (!repoPath) {
      repoPath = this.getRepoPath();
      if (!repoPath) {
        logger.warn('No git repo found in workspace. Agent will work without worktree.', { agentName });
        return null;
      }
    }

    const branch = `agent/${agentName}/${taskId}`;
    const worktreePath = path.join(WORKSPACE_ROOT, '.worktrees', `${agentName}-${taskId}`);

    try {
      // Ensure worktrees directory exists
      fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

      // Get the default branch name
      const defaultBranch = this._getDefaultBranch(repoPath);

      // Create worktree with new branch from default branch
      execSync(
        `git worktree add -b "${branch}" "${worktreePath}" "${defaultBranch}"`,
        { cwd: repoPath, stdio: 'pipe', encoding: 'utf8' }
      );

      this.activeWorktrees.set(agentName, { branch, worktreePath, repoPath });
      logger.success('Worktree created', { agentName, branch, worktreePath });

      return { worktreePath, branch };
    } catch (error) {
      // Branch might already exist — try checking it out
      try {
        execSync(
          `git worktree add "${worktreePath}" "${branch}"`,
          { cwd: repoPath, stdio: 'pipe', encoding: 'utf8' }
        );
        this.activeWorktrees.set(agentName, { branch, worktreePath, repoPath });
        return { worktreePath, branch };
      } catch (e2) {
        logger.error('Failed to create worktree', { agentName, error: e2.message });
        return null;
      }
    }
  }

  /**
   * Remove a worktree after agent finishes
   */
  removeWorktree(agentName) {
    const info = this.activeWorktrees.get(agentName);
    if (!info) return;

    try {
      execSync(
        `git worktree remove "${info.worktreePath}" --force`,
        { cwd: info.repoPath, stdio: 'pipe' }
      );
      this.activeWorktrees.delete(agentName);
      logger.info('Worktree removed', { agentName, branch: info.branch });
    } catch (error) {
      logger.warn('Failed to remove worktree (may already be removed)', {
        agentName, error: error.message
      });
      this.activeWorktrees.delete(agentName);
    }
  }

  /**
   * Push the agent's branch and create a PR using gh CLI
   */
  async pushAndCreatePR(agentName, taskDescription) {
    const info = this.activeWorktrees.get(agentName);
    if (!info) {
      logger.warn('No worktree found for agent', { agentName });
      return null;
    }

    try {
      // Check if there are any commits to push
      const diffOutput = execSync(
        `git log "${this._getDefaultBranch(info.repoPath)}..HEAD" --oneline`,
        { cwd: info.worktreePath, encoding: 'utf8', stdio: 'pipe' }
      ).trim();

      if (!diffOutput) {
        logger.info('No commits to push', { agentName });
        return null;
      }

      // Push branch
      execSync(`git push -u origin "${info.branch}"`, {
        cwd: info.worktreePath, stdio: 'pipe'
      });

      // Create PR using gh CLI
      const prTitle = `[${agentName}] ${taskDescription || 'Agent task completion'}`.substring(0, 70);
      const prBody = [
        `## Agent: ${agentName}`,
        `Branch: \`${info.branch}\``,
        '',
        `### Changes`,
        diffOutput,
        '',
        `---`,
        `*Auto-generated by AI Agent Company*`
      ].join('\n');

      const prOutput = execSync(
        `gh pr create --title "${prTitle}" --body "${prBody.replace(/"/g, '\\"')}" --base "${this._getDefaultBranch(info.repoPath)}"`,
        { cwd: info.worktreePath, encoding: 'utf8', stdio: 'pipe' }
      ).trim();

      logger.success('PR created', { agentName, pr: prOutput });
      return prOutput; // returns PR URL
    } catch (error) {
      logger.error('Failed to push/create PR', { agentName, error: error.message });
      return null;
    }
  }

  /**
   * Get the default branch (main or master)
   */
  _getDefaultBranch(repoPath) {
    try {
      const result = execSync(
        `git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo refs/remotes/origin/main`,
        { cwd: repoPath, encoding: 'utf8', stdio: 'pipe' }
      ).trim();
      return result.replace('refs/remotes/origin/', '');
    } catch {
      return 'main';
    }
  }

  /**
   * Get working directory for an agent — worktree if available, otherwise workspace root
   */
  getAgentWorkdir(agentName) {
    const info = this.activeWorktrees.get(agentName);
    if (info) return info.worktreePath;

    // Fallback: direct repo path or workspace root
    return this.getRepoPath() || WORKSPACE_ROOT;
  }

  getStatus() {
    return {
      workspaceRoot: WORKSPACE_ROOT,
      repoPath: this.getRepoPath(),
      activeWorktrees: Object.fromEntries(
        Array.from(this.activeWorktrees.entries()).map(([name, info]) => [
          name, { branch: info.branch, path: info.worktreePath }
        ])
      )
    };
  }
}

export default new WorkspaceManager();
