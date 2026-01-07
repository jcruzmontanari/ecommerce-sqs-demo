/**
 * E-commerce SQS Demo - Event-Driven Architecture Demonstration
 *
 * This demo showcases:
 * 1. Queue-based microservices architecture
 * 2. Event-driven order processing flow
 * 3. Dead Letter Queue handling
 * 4. Idempotency and correlation ID tracing
 * 5. Async workflow orchestration
 *
 * Architecture:
 * ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
 * │   Order      │───▶│   Payment    │───▶│  Inventory   │
 * │   Service    │    │   Service    │    │  Service     │
 * └──────────────┘    └──────────────┘    └──────────────┘
 *        │                   │                   │
 *        │                   │                   │
 *        ▼                   ▼                   ▼
 * ┌────────────────────────────────────────────────────────┐
 * │                 Notification Service                    │
 * └────────────────────────────────────────────────────────┘
 *
 * Usage:
 *   # With LocalStack (local development)
 *   USE_LOCALSTACK=true npx tsx src/demo.ts
 *
 *   # With real AWS (requires credentials)
 *   AWS_REGION=us-east-1 npx tsx src/demo.ts
 */

import { initializeQueues, printTopology, destroyQueues } from './queues/queue-manager.js';
import { OrderService, type CreateOrderRequest } from './services/order-service.js';
import { PaymentService } from './services/payment-service.js';
import { InventoryService } from './services/inventory-service.js';
import { NotificationService } from './services/notification-service.js';
import { DLQHandler } from './services/dlq-handler.js';
import { createLogger } from './utils/logger.js';
import {
  getMetrics,
  getTracer,
  printDashboardSummary,
  METRIC_NAMES,
} from './observability/index.js';

const logger = createLogger('Demo');
const metrics = getMetrics();
const tracer = getTracer();

// Sample order data
const SAMPLE_ORDERS: CreateOrderRequest[] = [
  {
    customerId: 'CUST-001',
    customerEmail: 'john.doe@example.com',
    items: [
      {
        productId: 'PROD-001',
        sku: 'SKU-LAPTOP-001',
        name: 'MacBook Pro 16"',
        quantity: 1,
        unitPrice: 2499.99,
      },
      {
        productId: 'PROD-004',
        sku: 'SKU-HEADPHONES-001',
        name: 'AirPods Pro',
        quantity: 2,
        unitPrice: 249.99,
      },
    ],
    shippingAddress: {
      street: '123 Main Street',
      city: 'San Francisco',
      state: 'CA',
      zipCode: '94102',
      country: 'USA',
    },
    paymentMethod: 'credit_card',
  },
  {
    customerId: 'CUST-002',
    customerEmail: 'jane.smith@example.com',
    items: [
      {
        productId: 'PROD-002',
        sku: 'SKU-PHONE-001',
        name: 'iPhone 15 Pro',
        quantity: 1,
        unitPrice: 1199.99,
      },
      {
        productId: 'PROD-005',
        sku: 'SKU-CHARGER-001',
        name: 'MagSafe Charger',
        quantity: 1,
        unitPrice: 39.99,
      },
    ],
    shippingAddress: {
      street: '456 Oak Avenue',
      city: 'New York',
      state: 'NY',
      zipCode: '10001',
      country: 'USA',
    },
    paymentMethod: 'debit_card',
  },
  {
    customerId: 'CUST-003',
    customerEmail: 'bob.wilson@example.com',
    items: [
      {
        productId: 'PROD-003',
        sku: 'SKU-TABLET-001',
        name: 'iPad Pro 12.9"',
        quantity: 2,
        unitPrice: 1099.99,
      },
    ],
    shippingAddress: {
      street: '789 Pine Road',
      city: 'Seattle',
      state: 'WA',
      zipCode: '98101',
      country: 'USA',
    },
    paymentMethod: 'bank_transfer',
  },
];

async function runDemo(): Promise<void> {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         E-COMMERCE SQS DEMO - EVENT-DRIVEN ARCHITECTURE         ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║  This demo demonstrates:                                        ║');
  console.log('║  • Microservices communicating via SQS queues                   ║');
  console.log('║  • Event-driven order processing pipeline                       ║');
  console.log('║  • Dead Letter Queues for failed messages                       ║');
  console.log('║  • Idempotency and correlation ID tracing                       ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('\n');

  // Check environment
  const isLocalStack = process.env.USE_LOCALSTACK === 'true';
  logger.info(`Running with ${isLocalStack ? 'LocalStack' : 'AWS'}`, {
    region: process.env.AWS_REGION || 'us-east-1',
  });

  try {
    // Step 1: Initialize queue infrastructure
    logger.info('Step 1: Initializing queue infrastructure...');
    const topology = await initializeQueues();
    printTopology(topology);

    // Step 2: Initialize services
    logger.info('Step 2: Initializing services...');

    const orderService = new OrderService({
      ordersQueueUrl: topology.orders.url!,
      paymentsQueueUrl: topology.payments.url!,
      notificationsQueueUrl: topology.notifications.url!,
    });

    const paymentService = new PaymentService({
      queueUrl: topology.payments.url!,
      inventoryQueueUrl: topology.inventory.url!,
      notificationsQueueUrl: topology.notifications.url!,
    });

    const inventoryService = new InventoryService({
      queueUrl: topology.inventory.url!,
      notificationsQueueUrl: topology.notifications.url!,
    });

    const notificationService = new NotificationService({
      queueUrl: topology.notifications.url!,
    });

    const dlqHandler = new DLQHandler({
      ordersDlqUrl: topology.orders.dlqUrl!,
      paymentsDlqUrl: topology.payments.dlqUrl!,
      inventoryDlqUrl: topology.inventory.dlqUrl!,
      notificationsDlqUrl: topology.notifications.dlqUrl!,
    });

    // Step 3: Start consumers
    logger.info('Step 3: Starting service consumers...');
    await paymentService.start();
    await inventoryService.start();
    await notificationService.start();
    await dlqHandler.start();

    // Give consumers time to start
    await delay(2000);

    // Step 4: Create sample orders
    logger.info('Step 4: Creating sample orders...');
    console.log('\n┌────────────────────────────────────────────────────────────┐');
    console.log('│              CREATING SAMPLE ORDERS                         │');
    console.log('└────────────────────────────────────────────────────────────┘\n');

    const createdOrders = [];
    for (const orderRequest of SAMPLE_ORDERS) {
      const order = await orderService.createOrder(orderRequest);
      createdOrders.push(order);

      console.log(`✅ Order ${order.orderId} created`);
      console.log(`   Customer: ${order.customerEmail}`);
      console.log(`   Items: ${order.items.length}`);
      console.log(`   Total: $${order.totalAmount.toFixed(2)}\n`);

      // Small delay between orders
      await delay(500);
    }

    // Step 5: Wait for processing
    logger.info('Step 5: Waiting for event processing...');
    console.log('\n┌────────────────────────────────────────────────────────────┐');
    console.log('│              PROCESSING EVENTS (15 seconds)                 │');
    console.log('└────────────────────────────────────────────────────────────┘\n');

    await delay(15000);

    // Step 6: Print summary
    console.log('\n┌────────────────────────────────────────────────────────────┐');
    console.log('│                      DEMO SUMMARY                           │');
    console.log('├────────────────────────────────────────────────────────────┤');
    console.log(`│ Orders Created:        ${String(createdOrders.length).padEnd(35)} │`);
    console.log(`│ Total Revenue:         $${createdOrders.reduce((sum, o) => sum + o.totalAmount, 0).toFixed(2).padEnd(34)} │`);
    console.log('├────────────────────────────────────────────────────────────┤');
    console.log('│ Notification History:                                       │');

    const notifications = notificationService.getNotificationHistory();
    for (const notif of notifications.slice(0, 5)) {
      console.log(`│   • ${notif.type.padEnd(25)} → ${notif.recipient.substring(0, 25).padEnd(25)} │`);
    }
    if (notifications.length > 5) {
      console.log(`│   ... and ${notifications.length - 5} more                                   │`);
    }

    console.log('├────────────────────────────────────────────────────────────┤');
    console.log('│ Inventory Status:                                           │');

    const inventory = inventoryService.getInventoryStatus();
    for (const item of inventory.slice(0, 3)) {
      console.log(`│   ${item.sku.padEnd(25)} Avail: ${String(item.available).padStart(3)} Reserved: ${String(item.reserved).padStart(3)} │`);
    }

    console.log('└────────────────────────────────────────────────────────────┘\n');

    // Print DLQ summary
    dlqHandler.printSummary();

    // Print DataDog observability summary
    printDashboardSummary();

    // Print metrics summary
    const metricsBuffer = metrics.flush();
    console.log('\n┌────────────────────────────────────────────────────────────┐');
    console.log('│           DATADOG METRICS SUMMARY                          │');
    console.log('├────────────────────────────────────────────────────────────┤');
    console.log(`│ Total Metrics Recorded: ${String(metricsBuffer.length).padEnd(34)} │`);

    // Group metrics by name
    const metricCounts: Record<string, number> = {};
    for (const m of metricsBuffer) {
      metricCounts[m.name] = (metricCounts[m.name] || 0) + 1;
    }
    for (const [name, count] of Object.entries(metricCounts).slice(0, 8)) {
      console.log(`│   ${name.substring(0, 40).padEnd(40)} ${String(count).padStart(5)} │`);
    }
    console.log('└────────────────────────────────────────────────────────────┘\n');

    // Print trace summary
    const completedSpans = tracer.getCompletedSpans();
    console.log('┌────────────────────────────────────────────────────────────┐');
    console.log('│           DATADOG APM TRACE SUMMARY                        │');
    console.log('├────────────────────────────────────────────────────────────┤');
    console.log(`│ Total Spans Recorded: ${String(completedSpans.length).padEnd(36)} │`);

    // Group spans by operation
    const spanCounts: Record<string, number> = {};
    for (const s of completedSpans) {
      spanCounts[s.operationName] = (spanCounts[s.operationName] || 0) + 1;
    }
    for (const [name, count] of Object.entries(spanCounts).slice(0, 6)) {
      console.log(`│   ${name.substring(0, 40).padEnd(40)} ${String(count).padStart(5)} │`);
    }
    console.log('└────────────────────────────────────────────────────────────┘\n');

    // Step 7: Cleanup
    logger.info('Step 7: Stopping services...');
    await paymentService.stop();
    await inventoryService.stop();
    await notificationService.stop();
    await dlqHandler.stop();

    // Ask about queue cleanup
    const shouldCleanup = process.env.CLEANUP_QUEUES === 'true';
    if (shouldCleanup) {
      logger.info('Cleaning up queues...');
      await destroyQueues();
    } else {
      logger.info('Skipping queue cleanup (set CLEANUP_QUEUES=true to clean up)');
    }

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                     DEMO COMPLETED                              ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

  } catch (error) {
    logger.error('Demo failed', { error: String(error) });
    throw error;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run demo
runDemo().catch((error) => {
  console.error('Demo failed:', error);
  process.exit(1);
});
