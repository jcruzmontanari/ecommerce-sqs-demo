/**
 * E-commerce Event Types
 *
 * This demonstrates event-driven architecture patterns for e-commerce:
 * - Order lifecycle events
 * - Payment processing events
 * - Inventory management events
 * - Notification triggers
 */

// Base event structure with correlation ID for distributed tracing
export interface BaseEvent {
  eventId: string;           // Unique event identifier
  correlationId: string;     // Traces entire order flow across services
  timestamp: string;         // ISO timestamp
  version: string;           // Event schema version
}

// Order domain types
export interface OrderItem {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface Order {
  orderId: string;
  customerId: string;
  customerEmail: string;
  items: OrderItem[];
  totalAmount: number;
  currency: string;
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
}

export type OrderStatus =
  | 'pending'
  | 'payment_processing'
  | 'payment_confirmed'
  | 'payment_failed'
  | 'inventory_reserved'
  | 'inventory_failed'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

// Event types for the order processing pipeline
export interface OrderCreatedEvent extends BaseEvent {
  type: 'ORDER_CREATED';
  payload: Order;
}

export interface PaymentRequestEvent extends BaseEvent {
  type: 'PAYMENT_REQUESTED';
  payload: {
    orderId: string;
    customerId: string;
    amount: number;
    currency: string;
    paymentMethod: 'credit_card' | 'debit_card' | 'bank_transfer';
  };
}

export interface PaymentResultEvent extends BaseEvent {
  type: 'PAYMENT_CONFIRMED' | 'PAYMENT_FAILED';
  payload: {
    orderId: string;
    transactionId?: string;
    amount: number;
    currency: string;
    failureReason?: string;
  };
}

export interface InventoryReserveEvent extends BaseEvent {
  type: 'INVENTORY_RESERVE_REQUESTED';
  payload: {
    orderId: string;
    items: Array<{
      productId: string;
      sku: string;
      quantity: number;
    }>;
  };
}

export interface InventoryResultEvent extends BaseEvent {
  type: 'INVENTORY_RESERVED' | 'INVENTORY_FAILED';
  payload: {
    orderId: string;
    reservationId?: string;
    items: Array<{
      productId: string;
      sku: string;
      quantity: number;
      reserved: boolean;
      availableStock?: number;
    }>;
    failureReason?: string;
  };
}

export interface NotificationEvent extends BaseEvent {
  type: 'NOTIFICATION_REQUESTED';
  payload: {
    orderId: string;
    customerId: string;
    customerEmail: string;
    notificationType: 'order_confirmation' | 'payment_received' | 'payment_failed' | 'order_shipped' | 'order_cancelled';
    templateData: Record<string, unknown>;
  };
}

// Union type for all events
export type EcommerceEvent =
  | OrderCreatedEvent
  | PaymentRequestEvent
  | PaymentResultEvent
  | InventoryReserveEvent
  | InventoryResultEvent
  | NotificationEvent;

// Queue configuration
export interface QueueConfig {
  name: string;
  url?: string;
  arn?: string;
  dlqName?: string;
  dlqUrl?: string;
  dlqArn?: string;
  visibilityTimeout: number;
  maxReceiveCount: number;  // Before sending to DLQ
}

// Message processing result for idempotency
export interface ProcessingResult {
  success: boolean;
  messageId: string;
  correlationId: string;
  error?: string;
  retryable: boolean;
}
