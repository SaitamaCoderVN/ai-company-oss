import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import chokidar from 'chokidar';
import logger from './logger.js';

const SKILL_QUEUE_DIR = process.env.SKILL_QUEUE_DIR || '../skill-queue';
const SKILL_STORE_DIR = process.env.SKILL_STORE_DIR || '../skill-store';
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;

class SkillHandler {
  constructor(telegramBot) {
    this.bot = telegramBot;
    this.pendingApprovals = new Map();
    this.watcher = null;
    this.initDirectories();
  }

  initDirectories() {
    try {
      if (!fs.existsSync(SKILL_QUEUE_DIR)) {
        fs.mkdirSync(SKILL_QUEUE_DIR, { recursive: true });
        logger.info('Created skill queue directory', { path: SKILL_QUEUE_DIR });
      }
      if (!fs.existsSync(SKILL_STORE_DIR)) {
        fs.mkdirSync(SKILL_STORE_DIR, { recursive: true });
        logger.info('Created skill store directory', { path: SKILL_STORE_DIR });
      }
    } catch (error) {
      logger.error('Failed to initialize directories', { error: error.message });
    }
  }

  computeHash(content) {
    return crypto
      .createHash('sha256')
      .update(content)
      .digest('hex');
  }

  async startWatching() {
    try {
      const queuePath = path.resolve(SKILL_QUEUE_DIR);
      this.watcher = chokidar.watch(path.join(queuePath, 'req_*.json'), {
        persistent: true,
        awaitWriteFinish: {
          stabilityThreshold: 1000,
          pollInterval: 100
        }
      });

      this.watcher
        .on('add', (filePath) => this.handleNewSkillRequest(filePath))
        .on('error', (error) => {
          logger.error('Watcher error', { error: error.message });
        });

      logger.info('Skill queue watcher started', { path: queuePath });
    } catch (error) {
      logger.error('Failed to start skill watcher', { error: error.message });
    }
  }

  async handleNewSkillRequest(filePath) {
    try {
      logger.info('New skill request detected', { file: filePath });

      const content = fs.readFileSync(filePath, 'utf-8');
      const request = JSON.parse(content);

      if (!request.skillName || !request.skillCode) {
        logger.error('Invalid skill request format', { file: filePath });
        return;
      }

      const requestId = path.basename(filePath, '.json');
      this.pendingApprovals.set(requestId, {
        file: filePath,
        request,
        timestamp: new Date().toISOString()
      });

      await this.sendApprovalNotification(requestId, request);
    } catch (error) {
      logger.error('Error processing skill request', {
        file: filePath,
        error: error.message
      });
    }
  }

  async sendApprovalNotification(requestId, request) {
    try {
      const message =
        `<b>Skill Request: ${request.skillName}</b>\n\n` +
        `<b>Author:</b> ${request.author || 'Unknown'}\n` +
        `<b>Description:</b> ${request.description || 'No description'}\n` +
        `<b>Size:</b> ${(request.skillCode.length / 1024).toFixed(2)} KB\n\n` +
        `<b>Request ID:</b> <code>${requestId}</code>`;

      const keyboard = {
        inline_keyboard: [
          [
            {
              text: '✅ [REVIEW]',
              callback_data: `skill_review:${requestId}`
            },
            {
              text: '✔️ [APPROVE]',
              callback_data: `skill_approve:${requestId}`
            }
          ],
          [
            {
              text: '❌ [REJECT]',
              callback_data: `skill_reject:${requestId}`
            }
          ]
        ]
      };

      const chatId = process.env.TELEGRAM_GROUP_ID;
      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });

      logger.info('Skill approval notification sent', { requestId });
    } catch (error) {
      logger.error('Failed to send approval notification', {
        requestId,
        error: error.message
      });
    }
  }

  async handleApprovalCallback(callbackId, requestId, action, userId) {
    try {
      // Verify ownership
      if (userId.toString() !== OWNER_TELEGRAM_ID.toString()) {
        logger.warn('Unauthorized skill approval attempt', {
          userId,
          requestId,
          action
        });
        return {
          success: false,
          message: 'Only the owner can approve or reject skills'
        };
      }

      const approval = this.pendingApprovals.get(requestId);
      if (!approval) {
        logger.error('Approval request not found', { requestId });
        return {
          success: false,
          message: 'Approval request not found'
        };
      }

      if (action === 'approve') {
        return await this.approveSkill(requestId, approval);
      } else if (action === 'reject') {
        return await this.rejectSkill(requestId, approval);
      } else if (action === 'review') {
        return await this.reviewSkill(requestId, approval);
      }

      return {
        success: false,
        message: 'Unknown action'
      };
    } catch (error) {
      logger.error('Error handling approval callback', {
        requestId,
        action,
        error: error.message
      });
      return {
        success: false,
        message: 'Error processing action'
      };
    }
  }

  async approveSkill(requestId, approval) {
    try {
      const { request } = approval;
      const skillName = request.skillName;
      const skillCode = request.skillCode;

      // Compute hash
      const hash = this.computeHash(skillCode);

      // Create skill store entry
      const skillStorePath = path.join(
        path.resolve(SKILL_STORE_DIR),
        `${skillName}.skill`
      );

      const skillPackage = {
        name: skillName,
        author: request.author || 'Unknown',
        description: request.description || '',
        version: request.version || '1.0.0',
        hash: hash,
        createdAt: new Date().toISOString(),
        approvedAt: new Date().toISOString(),
        approvedBy: request.approvedBy || 'Unknown',
        code: skillCode
      };

      fs.writeFileSync(skillStorePath, JSON.stringify(skillPackage, null, 2));

      // Mark request as approved
      const approvedPath = approval.file.replace('req_', 'approved_');
      fs.renameSync(approval.file, approvedPath);

      this.pendingApprovals.delete(requestId);

      logger.success('Skill approved and stored', {
        skillName,
        hash,
        path: skillStorePath
      });

      return {
        success: true,
        message: `Skill '${skillName}' approved and stored with hash ${hash.substring(0, 8)}...`,
        skillName,
        hash
      };
    } catch (error) {
      logger.error('Error approving skill', {
        requestId,
        error: error.message
      });
      return {
        success: false,
        message: 'Error approving skill'
      };
    }
  }

  async rejectSkill(requestId, approval) {
    try {
      const { request } = approval;
      const skillName = request.skillName;

      // Mark request as rejected
      const rejectedPath = approval.file.replace('req_', 'rejected_');
      fs.renameSync(approval.file, rejectedPath);

      this.pendingApprovals.delete(requestId);

      logger.info('Skill rejected', { skillName, requestId });

      return {
        success: true,
        message: `Skill '${skillName}' has been rejected`
      };
    } catch (error) {
      logger.error('Error rejecting skill', {
        requestId,
        error: error.message
      });
      return {
        success: false,
        message: 'Error rejecting skill'
      };
    }
  }

  async reviewSkill(requestId, approval) {
    try {
      const { request } = approval;
      const codePreview = request.skillCode.substring(0, 500);
      const message =
        `<b>Skill Review: ${request.skillName}</b>\n\n` +
        `<b>Author:</b> ${request.author || 'Unknown'}\n` +
        `<b>Description:</b> ${request.description || 'No description'}\n` +
        `<b>Version:</b> ${request.version || '1.0.0'}\n` +
        `<b>Size:</b> ${(request.skillCode.length / 1024).toFixed(2)} KB\n\n` +
        `<b>Code Preview:</b>\n<code>${codePreview}...</code>\n\n` +
        `<b>Full code available in skill store if approved</b>`;

      const chatId = process.env.TELEGRAM_GROUP_ID;
      await this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' });

      logger.info('Skill review sent', { requestId });

      return {
        success: true,
        message: 'Skill review sent to group'
      };
    } catch (error) {
      logger.error('Error reviewing skill', {
        requestId,
        error: error.message
      });
      return {
        success: false,
        message: 'Error sending skill review'
      };
    }
  }

  stopWatching() {
    if (this.watcher) {
      this.watcher.close();
      logger.info('Skill queue watcher stopped');
    }
  }
}

export default SkillHandler;
