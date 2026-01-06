/**
 * Order Service - Entry point for e-commerce order processing
 *
 * Responsibilities:
 * - Receive new order requests (API → Queue)
 * - Validate order data
 * - Emit OrderCreated events to trigger downstream processing
 * - Send messages to Payment and Notification queues
 *
 * Event Flow:
 * [API] → OrderService.createOrder() → Orders Queue → PaymentService
 *                                    → Notifications Queue
 */

import { v4 as uuidv4 } from 'uuid';
import { sendMessage } from '../queues/sqs-client.js';
import { createLogger } from '../utils/logger.js';
import type {
  Order,
  OrderItem,
  OrderCreatedEvent,
  PaymentRequestEvent,
  NotificationEvent,
} from '../types/index.js';

const logger = createLogger('OrderService');

export interface CreateOrderRequest {
  customerId: string;
  customerEmail: string;
  items: Array<{
    productId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  paymentMethod: 'credit_card' | 'debit_card' | 'bank_transfer';
}

export interface OrderServiceConfig {
  ordersQueueUrl: string;
  paymentsQueueUrl: string;
  notificationsQueueUrl: string;
}

export class OrderService {
  private config: OrderServiceConfig;

  constructor(config: OrderServiceConfig) {
    this.config = config;
    logger.info('OrderService initialized');
  }

  /**
   * Create a new order and emit events to start the processing pipeline
   */
  async createOrder(request: CreateOrderRequest): Promise<Order> {
    const orderId = `ORD-${uuidv4().substring(0, 8).toUpperCase()}`;
    const correlationId = uuidv4();
    const timestamp = new Date().toISOString();

    logger.info('Creating new order', {
      orderId,
      correlationId,
      customerId: request.customerId,
      itemCount: request.items.length,
    });

    // Validate order
    this.validateOrder(request);

    // Calculate total
    const totalAmount = request.items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0
    );

    // Build order object
    const order: Order = {
      orderId,
      customerId: request.customerId,
      customerEmail: request.customerEmail,
      items: request.items,
      totalAmount,
      currency: 'USD',
      shippingAddress: request.shippingAddress,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // 1. Emit OrderCreated event to Orders queue
    const orderCreatedEvent: OrderCreatedEvent = {
      eventId: uuidv4(),
      correlationId,
      timestamp,
      version: '1.0',
      type: 'ORDER_CREATED',
      payload: order,
    };

    await sendMessage(this.config.ordersQueueUrl, orderCreatedEvent, {
      messageAttributes: {
        EventType: { DataType: 'String', StringValue: 'ORDER_CREATED' },
        CorrelationId: { DataType: 'String', StringValue: correlationId },
      },
    });

    logger.info('OrderCreated event emitted', { orderId, correlationId });

    // 2. Emit PaymentRequested event to Payments queue
    const paymentEvent: PaymentRequestEvent = {
      eventId: uuidv4(),
      correlationId,
      timestamp,
      version: '1.0',
      type: 'PAYMENT_REQUESTED',
      payload: {
        orderId,
        customerId: request.customerId,
        amount: totalAmount,
        currency: 'USD',
        paymentMethod: request.paymentMethod,
      },
    };

    await sendMessage(this.config.paymentsQueueUrl, paymentEvent, {
      messageAttributes: {
        EventType: { DataType: 'String', StringValue: 'PAYMENT_REQUESTED' },
        CorrelationId: { DataType: 'String', StringValue: correlationId },
      },
    });

    logger.info('PaymentRequested event emitted', { orderId, correlationId });

    // 3. Emit notification for order confirmation email
    const notificationEvent: NotificationEvent = {
      eventId: uuidv4(),
      correlationId,
      timestamp,
      version: '1.0',
      type: 'NOTIFICATION_REQUESTED',
      payload: {
        orderId,
        customerId: request.customerId,
        customerEmail: request.customerEmail,
        notificationType: 'order_confirmation',
        templateData: {
          orderNumber: orderId,
          items: request.items,
          totalAmount,
          shippingAddress: request.shippingAddress,
        },
      },
    };

    await sendMessage(this.config.notificationsQueueUrl, notificationEvent, {
      messageAttributes: {
        EventType: { DataType: 'String', StringValue: 'NOTIFICATION_REQUESTED' },
        CorrelationId: { DataType: 'String', StringValue: correlationId },
      },
    });

    logger.info('Order confirmation notification queued', { orderId, correlationId });

    logger.metric('orders.created', 1, { status: 'success' });
    logger.metric('orders.value', totalAmount, { currency: 'USD' });

    return order;
  }

  /**
   * Validate order request
   */
  private validateOrder(request: CreateOrderRequest): void {
    if (!request.customerId) {
      throw new Error('Customer ID is required');
    }

    if (!request.customerEmail || !this.isValidEmail(request.customerEmail)) {
      throw new Error('Valid email is required');
    }

    if (!request.items || request.items.length === 0) {
      throw new Error('Order must have at least one item');
    }

    for (const item of request.items) {
      if (item.quantity <= 0) {
        throw new Error(`Invalid quantity for product ${item.productId}`);
      }
      if (item.unitPrice <= 0) {
        throw new Error(`Invalid price for product ${item.productId}`);
      }
    }

    if (!request.shippingAddress?.street || !request.shippingAddress?.city) {
      throw new Error('Complete shipping address is required');
    }
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
}
