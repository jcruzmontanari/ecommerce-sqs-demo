# Project Structure

src/
├── demo.ts                    # Main demo runner
├── index.ts                   # Module exports
├── types/
│   └── index.ts               # TypeScript types for all events
├── queues/
│   ├── sqs-client.ts          # AWS SDK v3 wrapper
│   └── queue-manager.ts       # Queue topology setup
├── services/
│   ├── base-consumer.ts       # Abstract consumer with idempotency
│   ├── order-service.ts       # Order creation (producer)
│   ├── payment-service.ts     # Payment processing (consumer/producer)
│   ├── inventory-service.ts   # Stock reservation (consumer)
│   ├── notification-service.ts # Email notifications (consumer)
│   └── dlq-handler.ts         # Dead Letter Queue monitoring
└── utils/
    └── logger.ts              # Structured logging (DataDog-ready)

# Key Patterns Demonstrated

| JD Requirement            | Implementation                                     |
| ------------------------- | -------------------------------------------------- |
| Event-driven architecture | Orders → Payments → Inventory → Notifications flow |
| Queue-based processing    | SQS queues with visibility timeout, long polling   |
| Dead Letter Queues        | Each queue has DLQ with configurable retry count   |
| Idempotency               | Event deduplication via eventId tracking           |
| Correlation IDs           | Distributed tracing across all services            |
| Observability             | Structured logging with metrics (DataDog-ready)    |
| AWS SDK v3                | Modern async/await patterns                        |

# Architecture Diagram

┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Order      │───▶│   Payment    │───▶│  Inventory   │
│   Service    │    │   Service    │    │   Service    │
└──────────────┘    └──────────────┘    └──────────────┘
        │                   │                   │
        └───────────────────┴───────────────────┘
                          │
                          ▼
                ┌──────────────────┐
                │  Notification    │
                │   Service        │
                └──────────────────┘
                          │
                          ▼
                ┌──────────────────┐
                │   DLQ Handler    │
                │   (Monitoring)   │
                └──────────────────┘

# DataDog Integration Summary

## 1. Metrics (src/observability/metrics.ts)

  ┌─────────────────────────────────────────────────────────────────┐
  │                    METRIC TYPES                                 │
  ├─────────────────────────────────────────────────────────────────┤
  │ Counter     │ Cumulative values (orders created, errors)        │
  │ Gauge       │ Current values (queue depth, stock levels)        │
  │ Histogram   │ Distributions (response times, processing time)   │
  │ Distribution│ Server-side percentiles (latencies)               │
  └─────────────────────────────────────────────────────────────────┘

  Pre-defined metric names:
  METRIC_NAMES = {
    // Orders
    ORDERS_CREATED: 'ecommerce.orders.created',
    ORDERS_VALUE: 'ecommerce.orders.value',
    ORDERS_PROCESSING_TIME: 'ecommerce.orders.processing_time_ms',

    // Payments
    PAYMENTS_PROCESSED: 'ecommerce.payments.processed',
    PAYMENTS_FAILED: 'ecommerce.payments.failed',
    PAYMENTS_AMOUNT: 'ecommerce.payments.amount',

    // Queue
    QUEUE_MESSAGES_PROCESSED: 'ecommerce.queue.messages_processed',
    QUEUE_PROCESSING_TIME: 'ecommerce.queue.processing_time_ms',
    // ... and more
  }

## 2. APM Tracing (src/observability/tracing.ts)

  Distributed tracing across SQS:
  OrderService ─────────────────────────────────────────────────────►
     │
     ├── order.create [span]
     │      │
     │      └── order.publish_events [child span]
     │
     ▼ (trace context injected into SQS message)

  PaymentService ───────────────────────────────────────────────────►
     │
     ├── PaymentService.process [span - linked via trace context]
     │      │
     │      ├── payment.process_external [child span]
     │      └── sqs.publish_downstream [child span]

## 3. Dashboard Configs (src/observability/dashboards.ts)

  Three pre-configured dashboards:

  | Dashboard     | Purpose          | Key Widgets                                            |
  | ------------- | ---------------- | ------------------------------------------------------ |
  | Operations    | Real-time health | Order rate, payment success %, queue depth, DLQ alerts |
  | Business KPIs | Stakeholder view | Revenue, conversion rate, order value distribution     |
  | Queue Health  | SQS monitoring   | Message rates, oldest message age, DLQ depth           |

  Alert definitions:
  - High DLQ message count (P1)
  - Payment failure rate > 10% (P1)
  - Order processing latency > 5s (P2)
  - Queue depth growing (P2)

  SLO definitions:
  - Order processing: 99.9% success rate
  - Payments: 99.5% success rate
  - Notifications: 99.9% delivery rate

## 4. How It Works in Each Service

  | Service             | Metrics                                            | Traces                                                   |
  | ------------------- | -------------------------------------------------- | -------------------------------------------------------- |
  | OrderService        | orders.created, orders.value, processing_time      | order.create → order.publish_events                      |
  | PaymentService      | payments.processed/failed, amount, processing_time | PaymentService.process → payment.process_external        |
  | InventoryService    | inventory.reserved/failed, stock_level             | InventoryService.process → inventory.attempt_reservation |
  | NotificationService | notifications.sent/failed by type                  | NotificationService.process → notification.send_email    |



# How to Run

## Option 1: With LocalStack (local development)
Start LocalStack
docker-compose up -d

Run demo
npm run demo:localstack

## Option 2: With real AWS
Set AWS credentials
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=xxx
export AWS_SECRET_ACCESS_KEY=xxx

Run demo
npm run demo:aws
