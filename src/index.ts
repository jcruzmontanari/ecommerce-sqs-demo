/**
 * E-commerce SQS Demo - Main Exports
 *
 * This module exports all the components needed for the e-commerce
 * event-driven architecture demonstration.
 */

// Types
export * from './types/index.js';

// Queue Management
export * from './queues/sqs-client.js';
export * from './queues/queue-manager.js';

// Services
export { OrderService, type CreateOrderRequest } from './services/order-service.js';
export { PaymentService } from './services/payment-service.js';
export { InventoryService } from './services/inventory-service.js';
export { NotificationService } from './services/notification-service.js';
export { DLQHandler } from './services/dlq-handler.js';
export { BaseConsumer, type ConsumerConfig } from './services/base-consumer.js';

// Utilities
export { createLogger, type Logger } from './utils/logger.js';
