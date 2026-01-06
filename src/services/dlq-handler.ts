/**
 * Dead Letter Queue Handler - Processes failed messages
 *
 * Responsibilities:
 * - Monitor all DLQs for failed messages
 * - Log failures for investigation
 * - Send alerts (in production: PagerDuty, Slack, etc.)
 * - Provide replay functionality for recovered messages
 *
 * This demonstrates error-handling strategies for event-driven systems,
 * which is a key skill mentioned in the job description.
 *
 * Production Considerations:
 * - Integration with DataDog for dashboards and alerts
 * - Automatic alerting thresholds
 * - Message replay tooling
 * - Root cause analysis
 */

import { receiveMessages, deleteMessage, sendMessage } from '../queues/sqs-client.js';
import { createLogger } from '../utils/logger.js';
import type { EcommerceEvent } from '../types/index.js';

const logger = createLogger('DLQHandler');

interface DLQConfig {
  ordersDlqUrl: string;
  paymentsDlqUrl: string;
  inventoryDlqUrl: string;
  notificationsDlqUrl: string;
}

interface FailedMessage {
  messageId: string;
  receiptHandle: string;
  queueName: string;
  body: string;
  approximateReceiveCount: number;
  sentTimestamp: string;
  firstReceivedTimestamp: string;
}

export class DLQHandler {
  private config: DLQConfig;
  private isRunning: boolean = false;
  private failedMessages: FailedMessage[] = [];

  constructor(config: DLQConfig) {
    this.config = config;
    logger.info('DLQ Handler initialized');
  }

  /**
   * Start monitoring all DLQs
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('DLQ Handler already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting DLQ monitoring...');

    // Poll all DLQs
    this.pollQueue('orders-dlq', this.config.ordersDlqUrl);
    this.pollQueue('payments-dlq', this.config.paymentsDlqUrl);
    this.pollQueue('inventory-dlq', this.config.inventoryDlqUrl);
    this.pollQueue('notifications-dlq', this.config.notificationsDlqUrl);
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    logger.info('DLQ Handler stopped');
  }

  /**
   * Poll a specific DLQ
   */
  private async pollQueue(queueName: string, queueUrl: string): Promise<void> {
    while (this.isRunning) {
      try {
        const messages = await receiveMessages(queueUrl, {
          maxMessages: 10,
          waitTimeSeconds: 20,
        });

        for (const message of messages) {
          await this.handleFailedMessage(queueName, queueUrl, message);
        }
      } catch (error) {
        if (!this.isRunning) break;
        logger.error('Error polling DLQ', {
          queueName,
          error: String(error),
        });
        await this.delay(5000);
      }

      await this.delay(1000);
    }
  }

  /**
   * Handle a message that ended up in DLQ
   */
  private async handleFailedMessage(
    queueName: string,
    queueUrl: string,
    message: any
  ): Promise<void> {
    const failedMsg: FailedMessage = {
      messageId: message.MessageId,
      receiptHandle: message.ReceiptHandle,
      queueName,
      body: message.Body,
      approximateReceiveCount: parseInt(
        message.Attributes?.ApproximateReceiveCount || '0',
        10
      ),
      sentTimestamp: message.Attributes?.SentTimestamp || '',
      firstReceivedTimestamp: message.Attributes?.ApproximateFirstReceiveTimestamp || '',
    };

    this.failedMessages.push(failedMsg);

    // Parse the message to get more context
    let event: EcommerceEvent | null = null;
    try {
      event = JSON.parse(message.Body);
    } catch {
      // Invalid JSON - corrupted message
    }

    // Log the failure with full context
    logger.error('Message failed processing and moved to DLQ', {
      queueName,
      messageId: failedMsg.messageId,
      receiveCount: failedMsg.approximateReceiveCount,
      eventType: event?.type || 'UNKNOWN',
      correlationId: event?.correlationId || 'UNKNOWN',
      payload: event ? JSON.stringify(event).substring(0, 200) : 'Invalid JSON',
    });

    // Send alert (in production: PagerDuty, Slack, etc.)
    this.sendAlert(queueName, failedMsg, event);

    // Record metric
    logger.metric('dlq.messages', 1, {
      queue: queueName,
      eventType: event?.type || 'unknown',
    });

    // In this demo, we acknowledge the message after logging
    // In production, you might want to keep it for replay
    // await deleteMessage(queueUrl, message.ReceiptHandle);
  }

  /**
   * Send alert for failed message
   */
  private sendAlert(
    queueName: string,
    message: FailedMessage,
    event: EcommerceEvent | null
  ): void {
    console.log('\n┌────────────────────────────────────────────────────────────┐');
    console.log('│ 🚨 DLQ ALERT - Message Failed Processing                   │');
    console.log('├────────────────────────────────────────────────────────────┤');
    console.log(`│ Queue:       ${queueName.padEnd(46)} │`);
    console.log(`│ Message ID:  ${message.messageId.substring(0, 36).padEnd(46)} │`);
    console.log(`│ Attempts:    ${String(message.approximateReceiveCount).padEnd(46)} │`);

    if (event) {
      console.log(`│ Event Type:  ${event.type.padEnd(46)} │`);
      console.log(`│ Correlation: ${event.correlationId.substring(0, 36).padEnd(46)} │`);
    }

    console.log('├────────────────────────────────────────────────────────────┤');
    console.log('│ Action Required: Investigate and replay if needed          │');
    console.log('└────────────────────────────────────────────────────────────┘\n');
  }

  /**
   * Replay a failed message back to its source queue
   */
  async replayMessage(
    messageId: string,
    sourceQueueUrl: string
  ): Promise<boolean> {
    const failedMsg = this.failedMessages.find((m) => m.messageId === messageId);

    if (!failedMsg) {
      logger.warn('Message not found for replay', { messageId });
      return false;
    }

    try {
      await sendMessage(sourceQueueUrl, JSON.parse(failedMsg.body));
      logger.info('Message replayed successfully', { messageId });
      return true;
    } catch (error) {
      logger.error('Failed to replay message', {
        messageId,
        error: String(error),
      });
      return false;
    }
  }

  /**
   * Get summary of failed messages
   */
  getFailureSummary(): {
    total: number;
    byQueue: Record<string, number>;
    byEventType: Record<string, number>;
  } {
    const byQueue: Record<string, number> = {};
    const byEventType: Record<string, number> = {};

    for (const msg of this.failedMessages) {
      byQueue[msg.queueName] = (byQueue[msg.queueName] || 0) + 1;

      try {
        const event = JSON.parse(msg.body) as EcommerceEvent;
        byEventType[event.type] = (byEventType[event.type] || 0) + 1;
      } catch {
        byEventType['INVALID'] = (byEventType['INVALID'] || 0) + 1;
      }
    }

    return {
      total: this.failedMessages.length,
      byQueue,
      byEventType,
    };
  }

  /**
   * Print failure summary
   */
  printSummary(): void {
    const summary = this.getFailureSummary();

    console.log('\n┌────────────────────────────────────────────────────────────┐');
    console.log('│           DLQ FAILURE SUMMARY                              │');
    console.log('├────────────────────────────────────────────────────────────┤');
    console.log(`│ Total Failed Messages: ${String(summary.total).padEnd(35)} │`);
    console.log('├────────────────────────────────────────────────────────────┤');
    console.log('│ By Queue:                                                  │');

    for (const [queue, count] of Object.entries(summary.byQueue)) {
      console.log(`│   ${queue.padEnd(40)} ${String(count).padStart(5)} │`);
    }

    console.log('├────────────────────────────────────────────────────────────┤');
    console.log('│ By Event Type:                                             │');

    for (const [type, count] of Object.entries(summary.byEventType)) {
      console.log(`│   ${type.padEnd(40)} ${String(count).padStart(5)} │`);
    }

    console.log('└────────────────────────────────────────────────────────────┘\n');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
