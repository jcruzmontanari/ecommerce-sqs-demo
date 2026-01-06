  Project Structure

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

  Key Patterns Demonstrated

  | JD Requirement            | Implementation                                     |
  | ------------------------- | -------------------------------------------------- |
  | Event-driven architecture | Orders → Payments → Inventory → Notifications flow |
  | Queue-based processing    | SQS queues with visibility timeout, long polling   |
  | Dead Letter Queues        | Each queue has DLQ with configurable retry count   |
  | Idempotency               | Event deduplication via eventId tracking           |
  | Correlation IDs           | Distributed tracing across all services            |
  | Observability             | Structured logging with metrics (DataDog-ready)    |
  | AWS SDK v3                | Modern async/await patterns                        |

  How to Run

  Option 1: With LocalStack (local development)
  # Start LocalStack
  docker-compose up -d

  # Run demo
  npm run demo:localstack

  Option 2: With real AWS
  # Set AWS credentials
  export AWS_REGION=us-east-1
  export AWS_ACCESS_KEY_ID=xxx
  export AWS_SECRET_ACCESS_KEY=xxx

  # Run demo
  npm run demo:aws

  Architecture Diagram

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
