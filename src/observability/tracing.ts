/**
 * DataDog APM Tracing
 *
 * Provides distributed tracing across microservices.
 * In production, this would use dd-trace package.
 *
 * Concepts:
 * - Trace: A complete request journey across services
 * - Span: A single operation within a trace
 * - Parent/Child: Spans can be nested to show call hierarchy
 *
 * For SQS-based systems:
 * - The correlationId becomes the trace ID
 * - Each service creates spans for its operations
 * - Context is propagated through message attributes
 *
 * @see https://docs.datadoghq.com/tracing/
 */

import { v4 as uuidv4 } from 'uuid';

export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  samplingPriority: number;
}

export interface SpanTags {
  [key: string]: string | number | boolean | undefined;
}

export interface Span {
  context: SpanContext;
  operationName: string;
  serviceName: string;
  resourceName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  tags: SpanTags;
  error?: boolean;
  errorMessage?: string;
  children: Span[];
}

// Active spans storage
const activeSpans: Map<string, Span> = new Map();
const completedSpans: Span[] = [];

/**
 * DataDog APM Tracer
 *
 * Simulates dd-trace functionality for the demo.
 * In production, you would use:
 *
 * ```typescript
 * import tracer from 'dd-trace';
 * tracer.init({
 *   service: 'ecommerce-sqs-demo',
 *   env: 'production',
 *   version: '1.0.0',
 * });
 * ```
 */
class DataDogTracer {
  private serviceName: string;
  private env: string;
  private version: string;
  private isEnabled: boolean;

  constructor(
    options: {
      serviceName?: string;
      env?: string;
      version?: string;
      enabled?: boolean;
    } = {},
  ) {
    this.serviceName =
      options.serviceName || process.env.DD_SERVICE || 'ecommerce-sqs-demo';
    this.env = options.env || process.env.DD_ENV || 'development';
    this.version = options.version || process.env.DD_VERSION || '1.0.0';
    this.isEnabled = options.enabled ?? true;

    console.log(`[DataDog] APM Tracer initialized for ${this.serviceName}`);
  }

  /**
   * Start a new span
   *
   * @param operationName - The operation being performed (e.g., 'sqs.receive')
   * @param options - Span options
   */
  startSpan(
    operationName: string,
    options: {
      resourceName?: string;
      parentContext?: SpanContext;
      tags?: SpanTags;
      serviceName?: string;
    } = {},
  ): Span {
    const spanId = uuidv4().replace(/-/g, '').substring(0, 16);
    const traceId =
      options.parentContext?.traceId ||
      uuidv4().replace(/-/g, '').substring(0, 16);

    const span: Span = {
      context: {
        traceId,
        spanId,
        parentSpanId: options.parentContext?.spanId,
        samplingPriority: 1,
      },
      operationName,
      serviceName: options.serviceName || this.serviceName,
      resourceName: options.resourceName || operationName,
      startTime: Date.now(),
      tags: {
        env: this.env,
        version: this.version,
        'span.kind': 'internal',
        ...options.tags,
      },
      children: [],
    };

    activeSpans.set(span.context.spanId, span);

    this.logSpanStart(span);

    return span;
  }

  /**
   * Finish a span
   */
  finishSpan(span: Span, error?: Error): void {
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;

    if (error) {
      span.error = true;
      span.errorMessage = error.message;
      span.tags['error.type'] = error.name;
      span.tags['error.message'] = error.message;
      span.tags['error.stack'] = error.stack?.substring(0, 500);
    }

    activeSpans.delete(span.context.spanId);
    completedSpans.push(span);

    // Keep buffer manageable
    if (completedSpans.length > 1000) {
      completedSpans.shift();
    }

    this.logSpanFinish(span);
  }

  /**
   * Create a child span
   */
  createChildSpan(
    parent: Span,
    operationName: string,
    options: {
      resourceName?: string;
      tags?: SpanTags;
    } = {},
  ): Span {
    const child = this.startSpan(operationName, {
      resourceName: options.resourceName,
      parentContext: parent.context,
      tags: options.tags,
    });

    parent.children.push(child);
    return child;
  }

  /**
   * Wrap an async function with a span
   */
  async trace<T>(
    operationName: string,
    fn: (span: Span) => Promise<T>,
    options: {
      resourceName?: string;
      parentContext?: SpanContext;
      tags?: SpanTags;
    } = {},
  ): Promise<T> {
    const span = this.startSpan(operationName, options);

    try {
      const result = await fn(span);
      this.finishSpan(span);
      return result;
    } catch (error) {
      this.finishSpan(span, error as Error);
      throw error;
    }
  }

  /**
   * Extract trace context from SQS message attributes
   * This allows distributed tracing across queue boundaries
   */
  extractFromSQSMessage(
    messageAttributes: Record<string, any>,
  ): SpanContext | undefined {
    const traceId = messageAttributes?.['dd-trace-id']?.StringValue;
    const spanId = messageAttributes?.['dd-span-id']?.StringValue;

    if (traceId && spanId) {
      return {
        traceId,
        spanId,
        samplingPriority: 1,
      };
    }

    // Fallback to correlationId as trace ID
    const correlationId = messageAttributes?.['CorrelationId']?.StringValue;
    if (correlationId) {
      return {
        traceId: correlationId.replace(/-/g, '').substring(0, 16),
        spanId: uuidv4().replace(/-/g, '').substring(0, 16),
        samplingPriority: 1,
      };
    }

    return undefined;
  }

  /**
   * Inject trace context into SQS message attributes
   */
  injectToSQSMessage(
    span: Span,
    messageAttributes: Record<string, any> = {},
  ): Record<string, any> {
    return {
      ...messageAttributes,
      'dd-trace-id': {
        DataType: 'String',
        StringValue: span.context.traceId,
      },
      'dd-span-id': {
        DataType: 'String',
        StringValue: span.context.spanId,
      },
    };
  }

  /**
   * Get active spans (for debugging)
   */
  getActiveSpans(): Span[] {
    return Array.from(activeSpans.values());
  }

  /**
   * Get completed spans (for testing/demo)
   */
  getCompletedSpans(): Span[] {
    return [...completedSpans];
  }

  /**
   * Generate a trace visualization (for demo)
   */
  visualizeTrace(traceId: string): void {
    const spans = completedSpans.filter((s) => s.context.traceId === traceId);

    if (spans.length === 0) {
      console.log(`No spans found for trace ${traceId}`);
      return;
    }

    console.log(
      '\n┌────────────────────────────────────────────────────────────┐',
    );
    console.log(
      '│                    TRACE VISUALIZATION                      │',
    );
    console.log(`│ Trace ID: ${traceId.padEnd(48)} │`);
    console.log(
      '├────────────────────────────────────────────────────────────┤',
    );

    // Sort by start time
    spans.sort((a, b) => a.startTime - b.startTime);

    const baseTime = spans[0].startTime;

    for (const span of spans) {
      const offset = span.startTime - baseTime;
      const indent = span.context.parentSpanId ? '  └─' : '──';
      const status = span.error ? '✗' : '✓';
      const duration = span.duration || 0;

      console.log(
        `│ ${indent} [${status}] ${span.operationName.padEnd(30)} ${duration
          .toString()
          .padStart(5)}ms │`,
      );
    }

    console.log(
      '└────────────────────────────────────────────────────────────┘\n',
    );
  }

  private logSpanStart(span: Span): void {
    if (!this.isEnabled) return;

    console.log(
      `\x1b[36m[TRACE]\x1b[0m ▶ ${span.operationName} ` +
        `[trace:${span.context.traceId.substring(0, 8)}] ` +
        `[span:${span.context.spanId.substring(0, 8)}]`,
    );
  }

  private logSpanFinish(span: Span): void {
    if (!this.isEnabled) return;

    const status = span.error ? '\x1b[31m✗\x1b[0m' : '\x1b[32m✓\x1b[0m';
    console.log(
      `\x1b[36m[TRACE]\x1b[0m ${status} ${span.operationName} ` +
        `completed in ${span.duration}ms`,
    );
  }
}

// Singleton instance
let tracerInstance: DataDogTracer | null = null;

export function getTracer(
  options?: ConstructorParameters<typeof DataDogTracer>[0],
): DataDogTracer {
  if (!tracerInstance) {
    tracerInstance = new DataDogTracer(options);
  }
  return tracerInstance;
}

export { DataDogTracer };
