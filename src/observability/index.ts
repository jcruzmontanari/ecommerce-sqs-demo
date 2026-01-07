/**
 * Observability Module
 *
 * Exports all DataDog integrations:
 * - Metrics: Counters, gauges, histograms
 * - Tracing: Distributed tracing with APM
 * - Dashboards: Pre-configured dashboard definitions
 *
 * Usage:
 * ```typescript
 * import { getMetrics, getTracer, METRIC_NAMES } from './observability';
 *
 * const metrics = getMetrics();
 * const tracer = getTracer();
 *
 * // Record a metric
 * metrics.increment(METRIC_NAMES.ORDERS_CREATED, 1, { status: 'success' });
 *
 * // Create a span
 * const span = tracer.startSpan('process-order');
 * // ... do work
 * tracer.finishSpan(span);
 * ```
 */

export {
  getMetrics,
  DataDogMetrics,
  METRIC_NAMES,
  type MetricTags,
  type MetricPoint,
} from './metrics.js';

export {
  getTracer,
  DataDogTracer,
  type Span,
  type SpanContext,
  type SpanTags,
} from './tracing.js';

export {
  OPERATIONS_DASHBOARD,
  BUSINESS_DASHBOARD,
  QUEUE_HEALTH_DASHBOARD,
  ALERT_DEFINITIONS,
  SLO_DEFINITIONS,
  printDashboardSummary,
  type DashboardDefinition,
  type DashboardWidget,
} from './dashboards.js';
