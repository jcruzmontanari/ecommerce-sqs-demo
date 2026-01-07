/**
 * Base Consumer - Abstract class for all queue consumers
 *
 * Implements common patterns for event-driven processing:
 * - Long polling for efficiency
 * - Graceful shutdown
 * - Message acknowledgment (delete after processing)
 * - Error handling with automatic retry
 * - Idempotency support through message deduplication
 * - Correlation ID propagation for distributed tracing
 * - DataDog metrics and APM tracing integration
 */

import { receiveMessages, deleteMessage, type Message } from '../queues/sqs-client.js';
import { createLogger, type Logger } from '../utils/logger.js';
import { getMetrics, getTracer, METRIC_NAMES, type Span } from '../observability/index.js';

export interface ConsumerConfig {
  queueUrl: string;
  queueName: string;
  batchSize?: number;          // Max messages per poll
  visibilityTimeout?: number;  // Seconds before message becomes visible again
  pollInterval?: number;       // Seconds between polls
  processingTimeout?: number;  // Max seconds for processing
}

export interface ProcessedMessageIds {
  has(id: string): boolean;
  add(id: string): void;
}

export abstract class BaseConsumer<TEvent> {
  protected readonly config: Required<ConsumerConfig>;
  protected readonly logger: Logger;
  protected readonly metrics = getMetrics();
  protected readonly tracer = getTracer();
  protected isRunning: boolean = false;
  private abortController: AbortController | null = null;
  private startTime: number = 0;

  // Simple in-memory idempotency check
  // In production, use DynamoDB or Redis for distributed idempotency
  protected processedMessages: Set<string> = new Set();
  private readonly maxProcessedMessages = 10000;

  constructor(config: ConsumerConfig) {
    this.config = {
      batchSize: 10,
      visibilityTimeout: 30,
      pollInterval: 1,
      processingTimeout: 25,
      ...config,
    };
    this.logger = createLogger(this.config.queueName);
  }

  /**
   * Process a single message - implement in subclass
   */
  protected abstract processMessage(
    event: TEvent,
    correlationId: string,
    span: Span
  ): Promise<void>;

  /**
   * Parse message body - can be overridden for custom parsing
   */
  protected parseMessage(body: string): TEvent {
    return JSON.parse(body) as TEvent;
  }

  /**
   * Extract correlation ID from the event
   */
  protected getCorrelationId(event: TEvent): string {
    // Default implementation assumes event has correlationId property
    return (event as any).correlationId || 'unknown';
  }

  /**
   * Get idempotency key for the message
   */
  protected getIdempotencyKey(event: TEvent): string {
    // Default: use eventId if available
    return (event as any).eventId || '';
  }

  /**
   * Check if message was already processed (idempotency)
   */
  private isAlreadyProcessed(event: TEvent): boolean {
    const key = this.getIdempotencyKey(event);
    if (!key) return false;

    if (this.processedMessages.has(key)) {
      this.logger.warn('Duplicate message detected, skipping', {
        idempotencyKey: key,
      });
      this.metrics.increment(METRIC_NAMES.QUEUE_MESSAGES_PROCESSED, 1, {
        queue_name: this.config.queueName,
        status: 'duplicate',
      });
      return true;
    }

    return false;
  }

  /**
   * Mark message as processed
   */
  private markAsProcessed(event: TEvent): void {
    const key = this.getIdempotencyKey(event);
    if (!key) return;

    this.processedMessages.add(key);

    // Prevent memory leak by limiting set size
    if (this.processedMessages.size > this.maxProcessedMessages) {
      const firstKey = this.processedMessages.values().next().value;
      this.processedMessages.delete(firstKey!);
    }
  }

  /**
   * Handle a single message from the queue
   */
  private async handleMessage(message: Message): Promise<boolean> {
    const messageId = message.MessageId || 'unknown';
    const startTime = Date.now();

    // Extract trace context from message attributes for distributed tracing
    const parentContext = this.tracer.extractFromSQSMessage(message.MessageAttributes || {});

    // Start a span for this message processing
    const span = this.tracer.startSpan(`${this.config.queueName}.process`, {
      resourceName: messageId,
      parentContext,
      tags: {
        'messaging.system': 'aws_sqs',
        'messaging.destination': this.config.queueName,
        'messaging.message_id': messageId,
      },
    });

    try {
      const event = this.parseMessage(message.Body!);
      const correlationId = this.getCorrelationId(event);

      // Add correlation ID to span
      span.tags['correlation_id'] = correlationId;
      span.tags['event_type'] = (event as any).type || 'unknown';

      this.logger.info('Processing message', {
        messageId,
        correlationId,
      });

      // Record message received metric
      this.metrics.increment(METRIC_NAMES.QUEUE_MESSAGES_RECEIVED, 1, {
        queue_name: this.config.queueName,
      });

      // Idempotency check
      if (this.isAlreadyProcessed(event)) {
        // Still delete the message - it's a duplicate
        await deleteMessage(this.config.queueUrl, message.ReceiptHandle!);
        this.tracer.finishSpan(span);
        return true;
      }

      // Process with timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('Processing timeout')),
          this.config.processingTimeout * 1000
        );
      });

      await Promise.race([
        this.processMessage(event, correlationId, span),
        timeoutPromise,
      ]);

      // Success - delete message and mark as processed
      await deleteMessage(this.config.queueUrl, message.ReceiptHandle!);
      this.markAsProcessed(event);

      // Record success metrics
      const processingTime = Date.now() - startTime;
      this.metrics.increment(METRIC_NAMES.QUEUE_MESSAGES_PROCESSED, 1, {
        queue_name: this.config.queueName,
        status: 'success',
      });
      this.metrics.histogram(METRIC_NAMES.QUEUE_PROCESSING_TIME, processingTime, {
        queue_name: this.config.queueName,
      });

      this.logger.info('Message processed successfully', {
        messageId,
        correlationId,
        processingTimeMs: processingTime,
      });

      this.tracer.finishSpan(span);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const processingTime = Date.now() - startTime;

      // Record failure metrics
      this.metrics.increment(METRIC_NAMES.QUEUE_MESSAGES_FAILED, 1, {
        queue_name: this.config.queueName,
        error_type: error instanceof Error ? error.name : 'UnknownError',
      });
      this.metrics.histogram(METRIC_NAMES.QUEUE_PROCESSING_TIME, processingTime, {
        queue_name: this.config.queueName,
        status: 'error',
      });
      this.metrics.increment(METRIC_NAMES.SERVICE_ERRORS, 1, {
        service: this.config.queueName,
        error_type: error instanceof Error ? error.name : 'UnknownError',
      });

      this.logger.error('Failed to process message', {
        messageId,
        error: errorMessage,
        processingTimeMs: processingTime,
      });

      // Finish span with error
      this.tracer.finishSpan(span, error as Error);

      // Don't delete the message - let it retry or go to DLQ
      return false;
    }
  }

  /**
   * Main poll loop
   */
  private async poll(): Promise<void> {
    while (this.isRunning) {
      try {
        const messages = await receiveMessages(this.config.queueUrl, {
          maxMessages: this.config.batchSize,
          visibilityTimeout: this.config.visibilityTimeout,
          waitTimeSeconds: 20, // Long polling
        });

        if (messages.length > 0) {
          this.logger.debug(`Received ${messages.length} messages`);

          // Process messages concurrently
          const results = await Promise.allSettled(
            messages.map((msg) => this.handleMessage(msg))
          );

          const succeeded = results.filter(
            (r) => r.status === 'fulfilled' && r.value
          ).length;
          const failed = messages.length - succeeded;

          if (failed > 0) {
            this.logger.warn(`${failed} message(s) failed processing`);
          }
        }

        // Record uptime metric periodically
        if (this.startTime > 0) {
          const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
          this.metrics.gauge(METRIC_NAMES.SERVICE_UPTIME, uptimeSeconds, {
            service: this.config.queueName,
          });
        }
      } catch (error) {
        if (!this.isRunning) break; // Graceful shutdown

        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error('Error in poll loop', { error: errorMessage });

        this.metrics.increment(METRIC_NAMES.SERVICE_ERRORS, 1, {
          service: this.config.queueName,
          error_type: 'poll_error',
        });

        // Back off on errors
        await this.sleep(5000);
      }

      // Small delay between polls
      await this.sleep(this.config.pollInterval * 1000);
    }
  }

  /**
   * Start the consumer
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Consumer already running');
      return;
    }

    this.isRunning = true;
    this.startTime = Date.now();
    this.abortController = new AbortController();

    this.logger.info('Consumer started', {
      queueName: this.config.queueName,
      batchSize: this.config.batchSize,
    });

    // Start polling in background
    this.poll().catch((error) => {
      this.logger.error('Poll loop crashed', { error: String(error) });
      this.isRunning = false;
    });
  }

  /**
   * Stop the consumer gracefully
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping consumer...');
    this.isRunning = false;
    this.abortController?.abort();

    // Wait for current processing to complete
    await this.sleep(1000);

    this.logger.info('Consumer stopped');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
