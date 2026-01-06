/**
 * Notification Service - Handles all customer communications
 *
 * Responsibilities:
 * - Consume NotificationRequested events
 * - Route to appropriate notification channels (email, SMS, push)
 * - Template rendering
 * - Rate limiting and deduplication
 *
 * Event Flow:
 * Notifications Queue → NotificationService → Email/SMS/Push (simulated)
 *
 * Patterns Demonstrated:
 * - Template pattern for different notification types
 * - Deduplication for preventing spam
 * - Rate limiting per customer
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseConsumer, type ConsumerConfig } from './base-consumer.js';
import type { NotificationEvent } from '../types/index.js';

interface NotificationServiceConfig extends Omit<ConsumerConfig, 'queueName'> {}

interface SentNotification {
  notificationId: string;
  orderId: string;
  type: string;
  channel: string;
  sentAt: string;
  recipient: string;
}

// Email templates (simplified)
const EMAIL_TEMPLATES = {
  order_confirmation: {
    subject: 'Order Confirmed - #{orderNumber}',
    body: `
Thank you for your order!

Order Number: #{orderNumber}
Total: $#{totalAmount}

Your order is being processed and you will receive updates as it progresses.
    `,
  },
  payment_received: {
    subject: 'Payment Received - Transaction #{transactionId}',
    body: `
Your payment has been successfully processed.

Transaction ID: #{transactionId}
Amount: $#{amount} #{currency}

Thank you for your purchase!
    `,
  },
  payment_failed: {
    subject: 'Payment Failed - Action Required',
    body: `
Unfortunately, we were unable to process your payment.

Reason: #{reason}
Amount: $#{amount} #{currency}

Please update your payment method and try again.
    `,
  },
  order_shipped: {
    subject: 'Your Order Has Shipped! - #{orderNumber}',
    body: `
Great news! Your order is on its way.

Tracking Number: #{trackingNumber}
Estimated Delivery: #{estimatedDelivery}
    `,
  },
  order_cancelled: {
    subject: 'Order Cancelled - #{orderNumber}',
    body: `
Your order has been cancelled.

Reason: #{reason}

If you have any questions, please contact our support team.
    `,
  },
};

export class NotificationService extends BaseConsumer<NotificationEvent> {
  // Track sent notifications for analytics and deduplication
  private sentNotifications: SentNotification[] = [];

  // Rate limiting: track notifications per customer
  private customerNotificationCount: Map<string, { count: number; resetAt: Date }> = new Map();
  private readonly MAX_NOTIFICATIONS_PER_HOUR = 10;

  constructor(config: NotificationServiceConfig) {
    super({ ...config, queueName: 'NotificationService' });
  }

  protected async processMessage(
    event: NotificationEvent,
    correlationId: string
  ): Promise<void> {
    const { orderId, customerId, customerEmail, notificationType, templateData } = event.payload;

    this.logger.info('Processing notification', {
      orderId,
      notificationType,
      correlationId,
    });

    // Rate limiting check
    if (!this.checkRateLimit(customerId)) {
      this.logger.warn('Rate limit exceeded for customer', {
        customerId,
        correlationId,
      });
      // Don't throw - just skip this notification
      return;
    }

    // Deduplication: check if we've already sent this exact notification
    const dedupeKey = `${orderId}:${notificationType}`;
    const alreadySent = this.sentNotifications.some(
      (n) => n.orderId === orderId && n.type === notificationType
    );

    if (alreadySent) {
      this.logger.warn('Duplicate notification skipped', {
        orderId,
        notificationType,
        correlationId,
      });
      return;
    }

    // Render template
    const template = EMAIL_TEMPLATES[notificationType];
    if (!template) {
      this.logger.error('Unknown notification type', {
        notificationType,
        correlationId,
      });
      return;
    }

    const renderedSubject = this.renderTemplate(template.subject, templateData);
    const renderedBody = this.renderTemplate(template.body, templateData);

    // Simulate sending email
    await this.sendEmail({
      to: customerEmail || 'customer@example.com',
      subject: renderedSubject,
      body: renderedBody,
    });

    // Track sent notification
    const notification: SentNotification = {
      notificationId: uuidv4(),
      orderId,
      type: notificationType,
      channel: 'email',
      sentAt: new Date().toISOString(),
      recipient: customerEmail || 'customer@example.com',
    };

    this.sentNotifications.push(notification);

    // Update rate limit counter
    this.incrementRateLimit(customerId);

    this.logger.info('Notification sent', {
      notificationId: notification.notificationId,
      orderId,
      notificationType,
      channel: 'email',
      correlationId,
    });

    this.logger.metric('notifications.sent', 1, {
      type: notificationType,
      channel: 'email',
    });
  }

  /**
   * Render a template with data
   */
  private renderTemplate(template: string, data: Record<string, unknown>): string {
    let rendered = template;

    for (const [key, value] of Object.entries(data)) {
      const placeholder = `#{${key}}`;
      rendered = rendered.replace(new RegExp(placeholder, 'g'), String(value ?? ''));
    }

    return rendered;
  }

  /**
   * Simulate sending an email
   */
  private async sendEmail(params: {
    to: string;
    subject: string;
    body: string;
  }): Promise<void> {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 300));

    // In production, this would call SES, SendGrid, etc.
    this.logger.debug('Email sent (simulated)', {
      to: params.to,
      subject: params.subject,
    });

    console.log('\n┌────────────────────────────────────────────────────────────┐');
    console.log('│ 📧 EMAIL SENT (Simulated)                                  │');
    console.log('├────────────────────────────────────────────────────────────┤');
    console.log(`│ To:      ${params.to.padEnd(50)} │`);
    console.log(`│ Subject: ${params.subject.substring(0, 50).padEnd(50)} │`);
    console.log('├────────────────────────────────────────────────────────────┤');
    console.log(`│ ${params.body.split('\n')[0].substring(0, 58).padEnd(58)} │`);
    console.log('└────────────────────────────────────────────────────────────┘\n');
  }

  /**
   * Check if customer is within rate limits
   */
  private checkRateLimit(customerId: string): boolean {
    const now = new Date();
    const record = this.customerNotificationCount.get(customerId);

    if (!record) {
      return true;
    }

    // Reset if hour has passed
    if (now > record.resetAt) {
      this.customerNotificationCount.delete(customerId);
      return true;
    }

    return record.count < this.MAX_NOTIFICATIONS_PER_HOUR;
  }

  /**
   * Increment rate limit counter
   */
  private incrementRateLimit(customerId: string): void {
    const now = new Date();
    const record = this.customerNotificationCount.get(customerId);

    if (!record || now > record.resetAt) {
      this.customerNotificationCount.set(customerId, {
        count: 1,
        resetAt: new Date(now.getTime() + 60 * 60 * 1000), // 1 hour from now
      });
    } else {
      record.count++;
    }
  }

  /**
   * Get notification history (for monitoring)
   */
  getNotificationHistory(): SentNotification[] {
    return [...this.sentNotifications];
  }

  protected getIdempotencyKey(event: NotificationEvent): string {
    return `notification:${event.payload.orderId}:${event.payload.notificationType}`;
  }
}
