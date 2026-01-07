/**
 * DataDog Metrics Client
 *
 * Provides a unified interface for sending metrics to DataDog.
 * In production, this would use the official datadog-metrics or hot-shots package.
 *
 * Metric Types:
 * - Counter: Tracks cumulative values (orders created, payments processed)
 * - Gauge: Tracks current values (queue depth, active connections)
 * - Histogram: Tracks distributions (response times, message sizes)
 * - Distribution: Similar to histogram but computed server-side
 *
 * Best Practices:
 * - Use consistent naming: <namespace>.<service>.<metric>
 * - Always include relevant tags for filtering
 * - Keep cardinality low (avoid unique IDs in tags)
 *
 * @see https://docs.datadoghq.com/metrics/
 */

export interface MetricTags {
  [key: string]: string | number | boolean;
}

export interface MetricPoint {
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'distribution';
  value: number;
  tags: MetricTags;
  timestamp: number;
}

// In-memory buffer for demo purposes
// In production, this would be the DataDog agent or API
const metricsBuffer: MetricPoint[] = [];
const MAX_BUFFER_SIZE = 1000;

/**
 * Metric naming conventions for e-commerce
 * Following DataDog best practices: <namespace>.<entity>.<action>
 */
export const METRIC_NAMES = {
  // Order metrics
  ORDERS_CREATED: 'ecommerce.orders.created',
  ORDERS_VALUE: 'ecommerce.orders.value',
  ORDERS_ITEMS_COUNT: 'ecommerce.orders.items_count',
  ORDERS_PROCESSING_TIME: 'ecommerce.orders.processing_time_ms',

  // Payment metrics
  PAYMENTS_PROCESSED: 'ecommerce.payments.processed',
  PAYMENTS_FAILED: 'ecommerce.payments.failed',
  PAYMENTS_AMOUNT: 'ecommerce.payments.amount',
  PAYMENTS_PROCESSING_TIME: 'ecommerce.payments.processing_time_ms',

  // Inventory metrics
  INVENTORY_RESERVED: 'ecommerce.inventory.reserved',
  INVENTORY_FAILED: 'ecommerce.inventory.failed',
  INVENTORY_STOCK_LEVEL: 'ecommerce.inventory.stock_level',

  // Notification metrics
  NOTIFICATIONS_SENT: 'ecommerce.notifications.sent',
  NOTIFICATIONS_FAILED: 'ecommerce.notifications.failed',

  // Queue metrics
  QUEUE_MESSAGES_RECEIVED: 'ecommerce.queue.messages_received',
  QUEUE_MESSAGES_PROCESSED: 'ecommerce.queue.messages_processed',
  QUEUE_MESSAGES_FAILED: 'ecommerce.queue.messages_failed',
  QUEUE_PROCESSING_TIME: 'ecommerce.queue.processing_time_ms',
  QUEUE_DEPTH: 'ecommerce.queue.depth',

  // DLQ metrics
  DLQ_MESSAGES_RECEIVED: 'ecommerce.dlq.messages_received',
  DLQ_MESSAGES_REPLAYED: 'ecommerce.dlq.messages_replayed',

  // System metrics
  SERVICE_UPTIME: 'ecommerce.service.uptime_seconds',
  SERVICE_ERRORS: 'ecommerce.service.errors',
} as const;

/**
 * DataDog Metrics Client
 */
class DataDogMetrics {
  private prefix: string;
  private defaultTags: MetricTags;
  private isEnabled: boolean;
  private flushInterval: NodeJS.Timeout | null = null;

  constructor(
    options: {
      prefix?: string;
      defaultTags?: MetricTags;
      enabled?: boolean;
    } = {},
  ) {
    this.prefix = options.prefix || 'ecommerce';
    this.defaultTags = {
      env: process.env.DD_ENV || 'development',
      service: process.env.DD_SERVICE || 'ecommerce-sqs-demo',
      version: process.env.DD_VERSION || '1.0.0',
      ...options.defaultTags,
    };
    this.isEnabled = options.enabled ?? process.env.DD_ENABLED === 'true';

    if (this.isEnabled) {
      // In production, this would connect to DataDog agent
      console.log('[DataDog] Metrics client initialized');
      this.startFlushInterval();
    }
  }

  /**
   * Increment a counter metric
   * Use for: orders created, messages processed, errors occurred
   */
  increment(name: string, value: number = 1, tags: MetricTags = {}): void {
    this.record({
      name,
      type: 'counter',
      value,
      tags: { ...this.defaultTags, ...tags },
      timestamp: Date.now(),
    });
  }

  /**
   * Set a gauge metric
   * Use for: queue depth, active connections, stock levels
   */
  gauge(name: string, value: number, tags: MetricTags = {}): void {
    this.record({
      name,
      type: 'gauge',
      value,
      tags: { ...this.defaultTags, ...tags },
      timestamp: Date.now(),
    });
  }

  /**
   * Record a histogram value
   * Use for: response times, message sizes, processing durations
   */
  histogram(name: string, value: number, tags: MetricTags = {}): void {
    this.record({
      name,
      type: 'histogram',
      value,
      tags: { ...this.defaultTags, ...tags },
      timestamp: Date.now(),
    });
  }

  /**
   * Record a distribution value (computed server-side)
   * Use for: percentile calculations across all hosts
   */
  distribution(name: string, value: number, tags: MetricTags = {}): void {
    this.record({
      name,
      type: 'distribution',
      value,
      tags: { ...this.defaultTags, ...tags },
      timestamp: Date.now(),
    });
  }

  /**
   * Time a function execution and record as histogram
   */
  async time<T>(
    name: string,
    fn: () => Promise<T>,
    tags: MetricTags = {},
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.histogram(name, Date.now() - start, { ...tags, status: 'success' });
      return result;
    } catch (error) {
      this.histogram(name, Date.now() - start, { ...tags, status: 'error' });
      throw error;
    }
  }

  /**
   * Record metric to buffer
   */
  private record(metric: MetricPoint): void {
    if (!this.isEnabled) {
      // Still log in demo mode
      this.logMetric(metric);
      return;
    }

    metricsBuffer.push(metric);

    // Prevent memory issues
    if (metricsBuffer.length > MAX_BUFFER_SIZE) {
      metricsBuffer.shift();
    }
  }

  /**
   * Log metric for demo/debugging
   */
  private logMetric(metric: MetricPoint): void {
    const tagStr = Object.entries(metric.tags)
      .filter(([k]) => !['env', 'service', 'version'].includes(k))
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');

    const symbol = {
      counter: '↑',
      gauge: '◉',
      histogram: '▤',
      distribution: '◐',
    }[metric.type];

    console.log(
      `\x1b[35m[METRIC]\x1b[0m ${symbol} ${metric.name} = ${metric.value} ${
        tagStr ? `{${tagStr}}` : ''
      }`,
    );
  }

  /**
   * Start periodic flush to DataDog
   */
  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, 10000); // Every 10 seconds
  }

  /**
   * Flush metrics to DataDog
   * In production, this sends to DataDog API or agent
   */
  flush(): MetricPoint[] {
    const metrics = [...metricsBuffer];
    metricsBuffer.length = 0;

    if (metrics.length > 0 && this.isEnabled) {
      console.log(`[DataDog] Flushing ${metrics.length} metrics`);
      // In production: send to DataDog API
      // await datadogClient.sendMetrics(metrics);
    }

    return metrics;
  }

  /**
   * Get buffered metrics (for testing/demo)
   */
  getBuffer(): MetricPoint[] {
    return [...metricsBuffer];
  }

  /**
   * Cleanup
   */
  shutdown(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flush();
  }
}

// Singleton instance
let metricsInstance: DataDogMetrics | null = null;

export function getMetrics(
  options?: ConstructorParameters<typeof DataDogMetrics>[0],
): DataDogMetrics {
  if (!metricsInstance) {
    metricsInstance = new DataDogMetrics(options);
  }
  return metricsInstance;
}

export { DataDogMetrics };
