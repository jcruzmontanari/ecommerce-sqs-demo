/**
 * DataDog Dashboard Configurations
 *
 * These are example dashboard definitions that can be imported into DataDog.
 * In production, these would be managed via Terraform or DataDog API.
 *
 * Dashboard Types:
 * - Operational: Real-time system health
 * - Business: KPIs and business metrics
 * - Debug: Detailed technical metrics
 *
 * @see https://docs.datadoghq.com/dashboards/
 */

/**
 * Widget types available in DataDog dashboards
 */
export type WidgetType =
  | 'timeseries'
  | 'query_value'
  | 'toplist'
  | 'heatmap'
  | 'distribution'
  | 'alert_graph'
  | 'slo'
  | 'log_stream';

export interface DashboardWidget {
  title: string;
  type: WidgetType;
  query: string;
  displayType?: 'line' | 'bars' | 'area';
  alertThreshold?: number;
}

export interface DashboardDefinition {
  title: string;
  description: string;
  widgets: DashboardWidget[];
  templateVariables?: Array<{
    name: string;
    prefix: string;
    default: string;
  }>;
}

/**
 * E-commerce Operations Dashboard
 *
 * Shows real-time health of the order processing pipeline
 */
export const OPERATIONS_DASHBOARD: DashboardDefinition = {
  title: 'E-commerce Operations',
  description: 'Real-time monitoring of order processing pipeline',
  templateVariables: [
    { name: 'env', prefix: 'env', default: 'production' },
    { name: 'service', prefix: 'service', default: '*' },
  ],
  widgets: [
    // Row 1: High-level KPIs
    {
      title: 'Orders Created (Last Hour)',
      type: 'query_value',
      query: 'sum:ecommerce.orders.created{$env}.as_count()',
    },
    {
      title: 'Payment Success Rate',
      type: 'query_value',
      query:
        '(sum:ecommerce.payments.processed{$env} / (sum:ecommerce.payments.processed{$env} + sum:ecommerce.payments.failed{$env})) * 100',
      alertThreshold: 95,
    },
    {
      title: 'Order Processing Time (p99)',
      type: 'query_value',
      query:
        'percentile:ecommerce.orders.processing_time_ms{$env} by {service}.as_count()',
      alertThreshold: 5000,
    },
    {
      title: 'Active DLQ Messages',
      type: 'query_value',
      query: 'sum:ecommerce.dlq.messages_received{$env}.as_count()',
      alertThreshold: 10,
    },

    // Row 2: Order Volume
    {
      title: 'Orders Over Time',
      type: 'timeseries',
      query: 'sum:ecommerce.orders.created{$env} by {status}.as_count()',
      displayType: 'bars',
    },
    {
      title: 'Order Value Distribution',
      type: 'distribution',
      query: 'avg:ecommerce.orders.value{$env}',
    },

    // Row 3: Payment Processing
    {
      title: 'Payment Processing',
      type: 'timeseries',
      query:
        'sum:ecommerce.payments.processed{$env}, sum:ecommerce.payments.failed{$env}',
      displayType: 'area',
    },
    {
      title: 'Payment Processing Time',
      type: 'heatmap',
      query: 'avg:ecommerce.payments.processing_time_ms{$env}',
    },

    // Row 4: Queue Health
    {
      title: 'Queue Depth',
      type: 'timeseries',
      query: 'avg:ecommerce.queue.depth{$env} by {queue_name}',
      displayType: 'line',
    },
    {
      title: 'Message Processing Rate',
      type: 'timeseries',
      query:
        'sum:ecommerce.queue.messages_processed{$env} by {queue_name}.as_rate()',
      displayType: 'line',
    },

    // Row 5: Errors
    {
      title: 'Failed Messages by Queue',
      type: 'toplist',
      query:
        'sum:ecommerce.queue.messages_failed{$env} by {queue_name}.as_count()',
    },
    {
      title: 'Error Rate',
      type: 'timeseries',
      query: 'sum:ecommerce.service.errors{$env} by {error_type}.as_count()',
      displayType: 'bars',
    },
  ],
};

/**
 * Business KPIs Dashboard
 *
 * Shows business metrics for stakeholders
 */
export const BUSINESS_DASHBOARD: DashboardDefinition = {
  title: 'E-commerce Business KPIs',
  description: 'Key business metrics for e-commerce operations',
  widgets: [
    {
      title: 'Total Revenue (Today)',
      type: 'query_value',
      query: 'sum:ecommerce.orders.value{env:production}',
    },
    {
      title: 'Orders Completed',
      type: 'query_value',
      query:
        'sum:ecommerce.orders.created{env:production,status:completed}.as_count()',
    },
    {
      title: 'Average Order Value',
      type: 'query_value',
      query: 'avg:ecommerce.orders.value{env:production}',
    },
    {
      title: 'Conversion Rate',
      type: 'query_value',
      query:
        '(sum:ecommerce.payments.processed{env:production} / sum:ecommerce.orders.created{env:production}) * 100',
    },
    {
      title: 'Revenue Over Time',
      type: 'timeseries',
      query: 'sum:ecommerce.orders.value{env:production}.rollup(sum, 3600)',
      displayType: 'bars',
    },
    {
      title: 'Orders by Status',
      type: 'toplist',
      query:
        'sum:ecommerce.orders.created{env:production} by {status}.as_count()',
    },
    {
      title: 'Payment Method Distribution',
      type: 'toplist',
      query:
        'sum:ecommerce.payments.processed{env:production} by {payment_method}.as_count()',
    },
    {
      title: 'Notification Delivery Rate',
      type: 'timeseries',
      query:
        'sum:ecommerce.notifications.sent{env:production} by {type}.as_rate()',
      displayType: 'area',
    },
  ],
};

/**
 * SQS Queue Health Dashboard
 *
 * Detailed monitoring of SQS queues
 */
export const QUEUE_HEALTH_DASHBOARD: DashboardDefinition = {
  title: 'SQS Queue Health',
  description: 'Detailed SQS queue monitoring',
  widgets: [
    {
      title: 'Messages In Flight',
      type: 'timeseries',
      query:
        'avg:aws.sqs.approximate_number_of_messages_not_visible{*} by {queuename}',
      displayType: 'line',
    },
    {
      title: 'Messages Available',
      type: 'timeseries',
      query:
        'avg:aws.sqs.approximate_number_of_messages_visible{*} by {queuename}',
      displayType: 'line',
    },
    {
      title: 'Messages Sent',
      type: 'timeseries',
      query: 'sum:aws.sqs.number_of_messages_sent{*} by {queuename}.as_rate()',
      displayType: 'bars',
    },
    {
      title: 'Messages Received',
      type: 'timeseries',
      query:
        'sum:aws.sqs.number_of_messages_received{*} by {queuename}.as_rate()',
      displayType: 'bars',
    },
    {
      title: 'Messages Deleted',
      type: 'timeseries',
      query:
        'sum:aws.sqs.number_of_messages_deleted{*} by {queuename}.as_rate()',
      displayType: 'bars',
    },
    {
      title: 'DLQ Depth',
      type: 'timeseries',
      query:
        'avg:aws.sqs.approximate_number_of_messages_visible{queuename:*-dlq}',
      displayType: 'area',
      alertThreshold: 100,
    },
    {
      title: 'Oldest Message Age',
      type: 'toplist',
      query: 'max:aws.sqs.approximate_age_of_oldest_message{*} by {queuename}',
    },
    {
      title: 'Empty Receives',
      type: 'timeseries',
      query: 'sum:aws.sqs.number_of_empty_receives{*} by {queuename}.as_rate()',
      displayType: 'line',
    },
  ],
};

/**
 * Alert Definitions
 *
 * These can be created via DataDog API or Terraform
 */
export const ALERT_DEFINITIONS = [
  {
    name: 'High DLQ Message Count',
    type: 'metric alert',
    query: 'sum(last_5m):sum:ecommerce.dlq.messages_received{*} > 10',
    message: `
      {{#is_alert}}
      High number of messages in Dead Letter Queue!

      Current count: {{value}}
      Threshold: {{threshold}}

      This indicates messages are failing processing repeatedly.

      **Actions:**
      1. Check application logs for errors
      2. Review recent deployments
      3. Check external service health
      {{/is_alert}}

      {{#is_recovery}}
      DLQ message count returned to normal.
      {{/is_recovery}}

      @slack-ecommerce-alerts @pagerduty-ecommerce
    `,
    priority: 'P1',
  },
  {
    name: 'Payment Failure Rate High',
    type: 'metric alert',
    query:
      'sum(last_5m):sum:ecommerce.payments.failed{*} / sum:ecommerce.payments.processed{*} > 0.1',
    message: `
      {{#is_alert}}
      Payment failure rate exceeded 10%!

      Current rate: {{value}}

      **Possible causes:**
      - Payment gateway issues
      - Invalid payment data
      - Fraud detection triggers

      **Actions:**
      1. Check payment gateway status
      2. Review failed payment logs
      3. Contact payment provider if needed
      {{/is_alert}}

      @slack-payments-alerts @pagerduty-payments
    `,
    priority: 'P1',
  },
  {
    name: 'Order Processing Latency High',
    type: 'metric alert',
    query:
      'avg(last_5m):percentile:ecommerce.orders.processing_time_ms{*}.as_count() > 5000',
    message: `
      {{#is_alert}}
      Order processing p99 latency > 5 seconds!

      Current p99: {{value}}ms

      **Actions:**
      1. Check queue depths
      2. Review consumer scaling
      3. Check database performance
      {{/is_alert}}

      @slack-ecommerce-alerts
    `,
    priority: 'P2',
  },
  {
    name: 'Queue Depth Growing',
    type: 'metric alert',
    query: 'avg(last_15m):avg:ecommerce.queue.depth{*} by {queue_name} > 1000',
    message: `
      {{#is_alert}}
      Queue {{queue_name.name}} depth > 1000 messages

      Messages may be processing slower than they arrive.

      **Actions:**
      1. Scale up consumers
      2. Check for processing errors
      3. Review message throughput
      {{/is_alert}}

      @slack-ecommerce-alerts
    `,
    priority: 'P2',
  },
];

/**
 * SLO Definitions
 *
 * Service Level Objectives for the e-commerce platform
 */
export const SLO_DEFINITIONS = [
  {
    name: 'Order Processing Success Rate',
    description: '99.9% of orders should be processed successfully',
    type: 'metric',
    query: {
      numerator: 'sum:ecommerce.orders.created{status:completed}.as_count()',
      denominator: 'sum:ecommerce.orders.created{*}.as_count()',
    },
    thresholds: {
      target: 99.9,
      warning: 99.5,
    },
    timeframe: '7d',
  },
  {
    name: 'Payment Success Rate',
    description: '99.5% of payment attempts should succeed',
    type: 'metric',
    query: {
      numerator: 'sum:ecommerce.payments.processed{*}.as_count()',
      denominator:
        'sum:ecommerce.payments.processed{*}.as_count() + sum:ecommerce.payments.failed{*}.as_count()',
    },
    thresholds: {
      target: 99.5,
      warning: 99.0,
    },
    timeframe: '7d',
  },
  {
    name: 'Notification Delivery Rate',
    description: '99.9% of notifications should be delivered',
    type: 'metric',
    query: {
      numerator: 'sum:ecommerce.notifications.sent{*}.as_count()',
      denominator:
        'sum:ecommerce.notifications.sent{*}.as_count() + sum:ecommerce.notifications.failed{*}.as_count()',
    },
    thresholds: {
      target: 99.9,
      warning: 99.5,
    },
    timeframe: '30d',
  },
];

/**
 * Print dashboard summary for demo
 */
export function printDashboardSummary(): void {
  console.log(
    '\n┌────────────────────────────────────────────────────────────┐',
  );
  console.log(
    '│           DATADOG DASHBOARD CONFIGURATIONS                  │',
  );
  console.log('├────────────────────────────────────────────────────────────┤');

  for (const dashboard of [
    OPERATIONS_DASHBOARD,
    BUSINESS_DASHBOARD,
    QUEUE_HEALTH_DASHBOARD,
  ]) {
    console.log(
      `│                                                            │`,
    );
    console.log(`│ 📊 ${dashboard.title.padEnd(54)} │`);
    console.log(
      `│    ${dashboard.widgets.length} widgets                                              │`,
    );
  }

  console.log('├────────────────────────────────────────────────────────────┤');
  console.log(
    `│ 🚨 ${ALERT_DEFINITIONS.length} Alert Definitions                                      │`,
  );
  console.log(
    `│ 🎯 ${SLO_DEFINITIONS.length} SLO Definitions                                         │`,
  );
  console.log(
    '└────────────────────────────────────────────────────────────┘\n',
  );
}
