/**
 * Queue Manager - E-commerce Queue Infrastructure
 *
 * Sets up the complete queue topology for an e-commerce system:
 *
 * Order Flow:
 * ┌─────────────┐     ┌─────────────┐     ┌─────────────────────┐
 * │   Orders    │────▶│  Payments   │────▶│  Inventory          │
 * │   Queue     │     │  Queue      │     │  Queue              │
 * └─────────────┘     └─────────────┘     └─────────────────────┘
 *        │                  │                       │
 *        │                  │                       │
 *        ▼                  ▼                       ▼
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    Notifications Queue                       │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Each main queue has a corresponding Dead Letter Queue (DLQ)
 */

import {
  createQueue,
  getQueueUrl,
  getQueueArn,
  configureDeadLetterQueue,
  deleteQueue,
  listQueues,
} from './sqs-client.js';
import { createLogger } from '../utils/logger.js';
import type { QueueConfig } from '../types/index.js';

const logger = createLogger('QueueManager');

// Queue definitions
export const QUEUE_NAMES = {
  ORDERS: 'ecommerce-orders',
  ORDERS_DLQ: 'ecommerce-orders-dlq',
  PAYMENTS: 'ecommerce-payments',
  PAYMENTS_DLQ: 'ecommerce-payments-dlq',
  INVENTORY: 'ecommerce-inventory',
  INVENTORY_DLQ: 'ecommerce-inventory-dlq',
  NOTIFICATIONS: 'ecommerce-notifications',
  NOTIFICATIONS_DLQ: 'ecommerce-notifications-dlq',
} as const;

// Store queue URLs after initialization
const queueUrls: Map<string, string> = new Map();
const queueArns: Map<string, string> = new Map();

export interface QueueTopology {
  orders: QueueConfig;
  payments: QueueConfig;
  inventory: QueueConfig;
  notifications: QueueConfig;
}

/**
 * Initialize all queues for the e-commerce system
 * Creates both main queues and their corresponding DLQs
 */
export async function initializeQueues(): Promise<QueueTopology> {
  logger.info('Initializing e-commerce queue infrastructure...');

  // Create DLQs first (they need to exist before main queues can reference them)
  logger.info('Creating Dead Letter Queues...');

  const ordersDlqUrl = await createQueue(QUEUE_NAMES.ORDERS_DLQ, {
    messageRetentionPeriod: 1209600, // 14 days for DLQ
  });
  queueUrls.set(QUEUE_NAMES.ORDERS_DLQ, ordersDlqUrl);
  queueArns.set(QUEUE_NAMES.ORDERS_DLQ, await getQueueArn(ordersDlqUrl));

  const paymentsDlqUrl = await createQueue(QUEUE_NAMES.PAYMENTS_DLQ, {
    messageRetentionPeriod: 1209600,
  });
  queueUrls.set(QUEUE_NAMES.PAYMENTS_DLQ, paymentsDlqUrl);
  queueArns.set(QUEUE_NAMES.PAYMENTS_DLQ, await getQueueArn(paymentsDlqUrl));

  const inventoryDlqUrl = await createQueue(QUEUE_NAMES.INVENTORY_DLQ, {
    messageRetentionPeriod: 1209600,
  });
  queueUrls.set(QUEUE_NAMES.INVENTORY_DLQ, inventoryDlqUrl);
  queueArns.set(QUEUE_NAMES.INVENTORY_DLQ, await getQueueArn(inventoryDlqUrl));

  const notificationsDlqUrl = await createQueue(QUEUE_NAMES.NOTIFICATIONS_DLQ, {
    messageRetentionPeriod: 1209600,
  });
  queueUrls.set(QUEUE_NAMES.NOTIFICATIONS_DLQ, notificationsDlqUrl);
  queueArns.set(QUEUE_NAMES.NOTIFICATIONS_DLQ, await getQueueArn(notificationsDlqUrl));

  // Create main queues
  logger.info('Creating main queues...');

  const ordersUrl = await createQueue(QUEUE_NAMES.ORDERS, {
    visibilityTimeout: 60,  // 60 seconds to process an order
  });
  queueUrls.set(QUEUE_NAMES.ORDERS, ordersUrl);
  queueArns.set(QUEUE_NAMES.ORDERS, await getQueueArn(ordersUrl));

  const paymentsUrl = await createQueue(QUEUE_NAMES.PAYMENTS, {
    visibilityTimeout: 120, // 2 minutes for payment processing
  });
  queueUrls.set(QUEUE_NAMES.PAYMENTS, paymentsUrl);
  queueArns.set(QUEUE_NAMES.PAYMENTS, await getQueueArn(paymentsUrl));

  const inventoryUrl = await createQueue(QUEUE_NAMES.INVENTORY, {
    visibilityTimeout: 30,  // 30 seconds for inventory
  });
  queueUrls.set(QUEUE_NAMES.INVENTORY, inventoryUrl);
  queueArns.set(QUEUE_NAMES.INVENTORY, await getQueueArn(inventoryUrl));

  const notificationsUrl = await createQueue(QUEUE_NAMES.NOTIFICATIONS, {
    visibilityTimeout: 30,
  });
  queueUrls.set(QUEUE_NAMES.NOTIFICATIONS, notificationsUrl);
  queueArns.set(QUEUE_NAMES.NOTIFICATIONS, await getQueueArn(notificationsUrl));

  // Configure DLQs for main queues
  logger.info('Configuring Dead Letter Queue policies...');

  await configureDeadLetterQueue(
    ordersUrl,
    queueArns.get(QUEUE_NAMES.ORDERS_DLQ)!,
    3  // After 3 failed attempts, send to DLQ
  );

  await configureDeadLetterQueue(
    paymentsUrl,
    queueArns.get(QUEUE_NAMES.PAYMENTS_DLQ)!,
    5  // More retries for payments (external dependency)
  );

  await configureDeadLetterQueue(
    inventoryUrl,
    queueArns.get(QUEUE_NAMES.INVENTORY_DLQ)!,
    3
  );

  await configureDeadLetterQueue(
    notificationsUrl,
    queueArns.get(QUEUE_NAMES.NOTIFICATIONS_DLQ)!,
    3
  );

  logger.info('Queue infrastructure initialized successfully');

  return {
    orders: {
      name: QUEUE_NAMES.ORDERS,
      url: ordersUrl,
      arn: queueArns.get(QUEUE_NAMES.ORDERS),
      dlqName: QUEUE_NAMES.ORDERS_DLQ,
      dlqUrl: ordersDlqUrl,
      dlqArn: queueArns.get(QUEUE_NAMES.ORDERS_DLQ),
      visibilityTimeout: 60,
      maxReceiveCount: 3,
    },
    payments: {
      name: QUEUE_NAMES.PAYMENTS,
      url: paymentsUrl,
      arn: queueArns.get(QUEUE_NAMES.PAYMENTS),
      dlqName: QUEUE_NAMES.PAYMENTS_DLQ,
      dlqUrl: paymentsDlqUrl,
      dlqArn: queueArns.get(QUEUE_NAMES.PAYMENTS_DLQ),
      visibilityTimeout: 120,
      maxReceiveCount: 5,
    },
    inventory: {
      name: QUEUE_NAMES.INVENTORY,
      url: inventoryUrl,
      arn: queueArns.get(QUEUE_NAMES.INVENTORY),
      dlqName: QUEUE_NAMES.INVENTORY_DLQ,
      dlqUrl: inventoryDlqUrl,
      dlqArn: queueArns.get(QUEUE_NAMES.INVENTORY_DLQ),
      visibilityTimeout: 30,
      maxReceiveCount: 3,
    },
    notifications: {
      name: QUEUE_NAMES.NOTIFICATIONS,
      url: notificationsUrl,
      arn: queueArns.get(QUEUE_NAMES.NOTIFICATIONS),
      dlqName: QUEUE_NAMES.NOTIFICATIONS_DLQ,
      dlqUrl: notificationsDlqUrl,
      dlqArn: queueArns.get(QUEUE_NAMES.NOTIFICATIONS_DLQ),
      visibilityTimeout: 30,
      maxReceiveCount: 3,
    },
  };
}

/**
 * Get a queue URL by name
 */
export function getQueueUrlByName(queueName: string): string | undefined {
  return queueUrls.get(queueName);
}

/**
 * Clean up all queues (for testing/development)
 */
export async function destroyQueues(): Promise<void> {
  logger.info('Destroying all e-commerce queues...');

  const queues = await listQueues('ecommerce-');

  for (const queueUrl of queues) {
    try {
      await deleteQueue(queueUrl);
    } catch (error) {
      logger.warn(`Failed to delete queue: ${queueUrl}`, { error: String(error) });
    }
  }

  queueUrls.clear();
  queueArns.clear();

  logger.info('All queues destroyed');
}

/**
 * Print queue topology for debugging
 */
export function printTopology(topology: QueueTopology): void {
  console.log('\n┌────────────────────────────────────────────────────────────┐');
  console.log('│           E-COMMERCE QUEUE TOPOLOGY                        │');
  console.log('├────────────────────────────────────────────────────────────┤');

  for (const [name, config] of Object.entries(topology)) {
    console.log(`│ ${name.toUpperCase().padEnd(15)} │`);
    console.log(`│   Queue: ${config.name.padEnd(45)} │`);
    console.log(`│   DLQ:   ${config.dlqName?.padEnd(45)} │`);
    console.log(`│   Visibility: ${String(config.visibilityTimeout).padEnd(4)}s │ Max Retries: ${config.maxReceiveCount}        │`);
    console.log('├────────────────────────────────────────────────────────────┤');
  }

  console.log('└────────────────────────────────────────────────────────────┘\n');
}
