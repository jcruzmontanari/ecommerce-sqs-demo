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
 *
 * DataDog Integration:
 * - Metrics: payments processed, failed, amount, processing time
 * - Tracing: spans for payment processing, external calls
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseConsumer, type ConsumerConfig } from './base-consumer.js';
import { sendMessage } from '../queues/sqs-client.js';
import { METRIC_NAMES, type Span } from '../observability/index.js';
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
    correlationId: string,
    parentSpan: Span
  ): Promise<void> {
    const { orderId, amount, currency, paymentMethod, customerId } = event.payload;

    // Add payment-specific tags to the parent span
    parentSpan.tags['payment.order_id'] = orderId;
    parentSpan.tags['payment.amount'] = amount;
    parentSpan.tags['payment.currency'] = currency;
    parentSpan.tags['payment.method'] = paymentMethod;

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
      parentSpan.tags['payment.status'] = 'duplicate';
      return;
    }

    // Create child span for the actual payment processing (external call)
    const paymentSpan = this.tracer.createChildSpan(parentSpan, 'payment.process_external', {
      resourceName: `${paymentMethod}:${orderId}`,
      tags: {
        'span.kind': 'client',
        'payment.gateway': 'simulated',
        'payment.amount': amount,
      },
    });

    // Simulate payment processing
    const paymentResult = await this.processPayment(orderId, amount, paymentMethod);

    this.tracer.finishSpan(paymentSpan);

    if (paymentResult.success) {
      // Store for idempotency
      this.processedPayments.set(orderId, paymentResult.transactionId!);
      parentSpan.tags['payment.status'] = 'confirmed';
      parentSpan.tags['payment.transaction_id'] = paymentResult.transactionId;

      // Record DataDog metrics
      this.metrics.increment(METRIC_NAMES.PAYMENTS_PROCESSED, 1, {
        payment_method: paymentMethod,
        currency,
      });
      this.metrics.distribution(METRIC_NAMES.PAYMENTS_AMOUNT, amount, {
        payment_method: paymentMethod,
        currency,
      });

      // Log for observability
      this.logger.info('Payment confirmed', {
        orderId,
        transactionId: paymentResult.transactionId,
        amount,
        correlationId,
      });

      // Create span for downstream message publishing
      const publishSpan = this.tracer.createChildSpan(parentSpan, 'sqs.publish_downstream', {
        tags: { 'messaging.operation': 'publish' },
      });

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

      // Inject trace context into message for distributed tracing
      const messageAttributes = this.tracer.injectToSQSMessage(parentSpan, {
        EventType: { DataType: 'String', StringValue: 'INVENTORY_RESERVE_REQUESTED' },
        CorrelationId: { DataType: 'String', StringValue: correlationId },
      });

      await sendMessage(this.inventoryQueueUrl, inventoryEvent, { messageAttributes });

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
        messageAttributes: this.tracer.injectToSQSMessage(parentSpan, {
          EventType: { DataType: 'String', StringValue: 'NOTIFICATION_REQUESTED' },
          CorrelationId: { DataType: 'String', StringValue: correlationId },
        }),
      });

      this.tracer.finishSpan(publishSpan);

    } else {
      // Payment failed
      parentSpan.tags['payment.status'] = 'failed';
      parentSpan.tags['payment.failure_reason'] = paymentResult.error;

      // Record failure metrics
      this.metrics.increment(METRIC_NAMES.PAYMENTS_FAILED, 1, {
        payment_method: paymentMethod,
        failure_reason: paymentResult.error || 'unknown',
      });

      this.logger.warn('Payment failed', {
        orderId,
        error: paymentResult.error,
        correlationId,
      });

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
    const startTime = Date.now();

    // Simulate network delay
    await this.delay(500 + Math.random() * 1000);

    // Record processing time
    this.metrics.histogram(METRIC_NAMES.PAYMENTS_PROCESSING_TIME, Date.now() - startTime, {
      payment_method: paymentMethod,
    });

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
