/**
 * Payment Service - Processes payment events and triggers downstream actions
 *
 * Responsibilities:
 * - Consume PaymentRequested events from Payments queue
 * - Process payments (simulated)
 * - Emit PaymentConfirmed/PaymentFailed events
 * - Trigger inventory reservation on success
 * - Send payment notifications
 *
 * Event Flow:
 * Payments Queue → PaymentService → Inventory Queue (on success)
 *                                 → Notifications Queue
 *
 * Error Handling:
 * - Retries with exponential backoff (handled by SQS visibility timeout)
 * - Dead Letter Queue after max retries
 * - Idempotent processing (won't charge twice)
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseConsumer, type ConsumerConfig } from './base-consumer.js';
import { sendMessage } from '../queues/sqs-client.js';
import type {
  PaymentRequestEvent,
  PaymentResultEvent,
  InventoryReserveEvent,
  NotificationEvent,
} from '../types/index.js';

interface PaymentServiceConfig extends Omit<ConsumerConfig, 'queueName'> {
  inventoryQueueUrl: string;
  notificationsQueueUrl: string;
}

// Simulated payment processor responses
const SIMULATED_FAILURES = new Set(['FAIL', 'DECLINE', 'ERROR']);

export class PaymentService extends BaseConsumer<PaymentRequestEvent> {
  private inventoryQueueUrl: string;
  private notificationsQueueUrl: string;

  // Track processed payments for idempotency
  private processedPayments: Map<string, string> = new Map(); // orderId -> transactionId

  constructor(config: PaymentServiceConfig) {
    super({ ...config, queueName: 'PaymentService' });
    this.inventoryQueueUrl = config.inventoryQueueUrl;
    this.notificationsQueueUrl = config.notificationsQueueUrl;
  }

  protected async processMessage(
    event: PaymentRequestEvent,
    correlationId: string
  ): Promise<void> {
    const { orderId, amount, currency, paymentMethod, customerId } = event.payload;

    this.logger.info('Processing payment', {
      orderId,
      amount,
      currency,
      paymentMethod,
      correlationId,
    });

    // Idempotency check - don't process same order twice
    if (this.processedPayments.has(orderId)) {
      this.logger.warn('Payment already processed for order', {
        orderId,
        transactionId: this.processedPayments.get(orderId),
        correlationId,
      });
      return;
    }

    // Simulate payment processing
    const paymentResult = await this.processPayment(orderId, amount, paymentMethod);

    if (paymentResult.success) {
      // Store for idempotency
      this.processedPayments.set(orderId, paymentResult.transactionId!);

      // Emit PaymentConfirmed event
      const confirmEvent: PaymentResultEvent = {
        eventId: uuidv4(),
        correlationId,
        timestamp: new Date().toISOString(),
        version: '1.0',
        type: 'PAYMENT_CONFIRMED',
        payload: {
          orderId,
          transactionId: paymentResult.transactionId,
          amount,
          currency,
        },
      };

      // Log for observability (DataDog metrics in production)
      this.logger.info('Payment confirmed', {
        orderId,
        transactionId: paymentResult.transactionId,
        amount,
        correlationId,
      });
      this.logger.metric('payments.confirmed', 1, { paymentMethod });
      this.logger.metric('payments.value', amount, { currency });

      // Trigger inventory reservation
      const inventoryEvent: InventoryReserveEvent = {
        eventId: uuidv4(),
        correlationId,
        timestamp: new Date().toISOString(),
        version: '1.0',
        type: 'INVENTORY_RESERVE_REQUESTED',
        payload: {
          orderId,
          items: [], // In real system, would get from order details
        },
      };

      await sendMessage(this.inventoryQueueUrl, inventoryEvent, {
        messageAttributes: {
          EventType: { DataType: 'String', StringValue: 'INVENTORY_RESERVE_REQUESTED' },
          CorrelationId: { DataType: 'String', StringValue: correlationId },
        },
      });

      // Send payment confirmation notification
      const notificationEvent: NotificationEvent = {
        eventId: uuidv4(),
        correlationId,
        timestamp: new Date().toISOString(),
        version: '1.0',
        type: 'NOTIFICATION_REQUESTED',
        payload: {
          orderId,
          customerId,
          customerEmail: '', // Would get from order details
          notificationType: 'payment_received',
          templateData: {
            transactionId: paymentResult.transactionId,
            amount,
            currency,
          },
        },
      };

      await sendMessage(this.notificationsQueueUrl, notificationEvent, {
        messageAttributes: {
          EventType: { DataType: 'String', StringValue: 'NOTIFICATION_REQUESTED' },
          CorrelationId: { DataType: 'String', StringValue: correlationId },
        },
      });

    } else {
      // Payment failed
      const failEvent: PaymentResultEvent = {
        eventId: uuidv4(),
        correlationId,
        timestamp: new Date().toISOString(),
        version: '1.0',
        type: 'PAYMENT_FAILED',
        payload: {
          orderId,
          amount,
          currency,
          failureReason: paymentResult.error,
        },
      };

      this.logger.warn('Payment failed', {
        orderId,
        error: paymentResult.error,
        correlationId,
      });
      this.logger.metric('payments.failed', 1, { reason: paymentResult.error || 'unknown' });

      // Send payment failed notification
      const notificationEvent: NotificationEvent = {
        eventId: uuidv4(),
        correlationId,
        timestamp: new Date().toISOString(),
        version: '1.0',
        type: 'NOTIFICATION_REQUESTED',
        payload: {
          orderId,
          customerId,
          customerEmail: '',
          notificationType: 'payment_failed',
          templateData: {
            reason: paymentResult.error,
            amount,
            currency,
          },
        },
      };

      await sendMessage(this.notificationsQueueUrl, notificationEvent, {
        messageAttributes: {
          EventType: { DataType: 'String', StringValue: 'NOTIFICATION_REQUESTED' },
          CorrelationId: { DataType: 'String', StringValue: correlationId },
        },
      });

      // If payment fails, we might want to retry (throw error)
      // or accept the failure (don't throw)
      // For this demo, we accept failures as final
    }
  }

  /**
   * Simulate payment processing
   * In production, this would call Stripe, PayPal, etc.
   */
  private async processPayment(
    orderId: string,
    amount: number,
    paymentMethod: string
  ): Promise<{ success: boolean; transactionId?: string; error?: string }> {
    // Simulate network delay
    await this.delay(500 + Math.random() * 1000);

    // Simulate random failures (10% failure rate)
    const shouldFail = Math.random() < 0.1;

    // Check for test failure triggers in orderId
    const hasFailureTrigger = Array.from(SIMULATED_FAILURES).some(
      (trigger) => orderId.includes(trigger)
    );

    if (shouldFail || hasFailureTrigger) {
      const reasons = [
        'Insufficient funds',
        'Card declined',
        'Payment gateway timeout',
        'Invalid card number',
      ];
      return {
        success: false,
        error: reasons[Math.floor(Math.random() * reasons.length)],
      };
    }

    // Success
    return {
      success: true,
      transactionId: `TXN-${uuidv4().substring(0, 12).toUpperCase()}`,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected getIdempotencyKey(event: PaymentRequestEvent): string {
    // Use orderId for payment idempotency
    return `payment:${event.payload.orderId}`;
  }
}
