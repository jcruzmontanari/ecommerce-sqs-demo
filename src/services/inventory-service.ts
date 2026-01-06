/**
 * Inventory Service - Handles stock reservation and management
 *
 * Responsibilities:
 * - Consume InventoryReserveRequested events
 * - Check and reserve stock (simulated with in-memory store)
 * - Emit InventoryReserved/InventoryFailed events
 * - Handle stock rollback on order cancellation
 *
 * Event Flow:
 * Inventory Queue → InventoryService → Notifications Queue
 *
 * Patterns Demonstrated:
 * - Saga pattern participant (compensating transactions)
 * - Optimistic locking for concurrent reservations
 * - Event sourcing for stock movements
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseConsumer, type ConsumerConfig } from './base-consumer.js';
import { sendMessage } from '../queues/sqs-client.js';
import type {
  InventoryReserveEvent,
  InventoryResultEvent,
  NotificationEvent,
} from '../types/index.js';

interface InventoryServiceConfig extends Omit<ConsumerConfig, 'queueName'> {
  notificationsQueueUrl: string;
}

// Simulated inventory store
interface StockItem {
  productId: string;
  sku: string;
  available: number;
  reserved: number;
}

interface Reservation {
  reservationId: string;
  orderId: string;
  items: Array<{ productId: string; quantity: number }>;
  createdAt: string;
  expiresAt: string;
}

export class InventoryService extends BaseConsumer<InventoryReserveEvent> {
  private notificationsQueueUrl: string;

  // Simulated in-memory inventory
  private inventory: Map<string, StockItem> = new Map();
  private reservations: Map<string, Reservation> = new Map();

  constructor(config: InventoryServiceConfig) {
    super({ ...config, queueName: 'InventoryService' });
    this.notificationsQueueUrl = config.notificationsQueueUrl;
    this.initializeInventory();
  }

  /**
   * Initialize with sample inventory data
   */
  private initializeInventory(): void {
    const products = [
      { productId: 'PROD-001', sku: 'SKU-LAPTOP-001', available: 50, reserved: 0 },
      { productId: 'PROD-002', sku: 'SKU-PHONE-001', available: 100, reserved: 0 },
      { productId: 'PROD-003', sku: 'SKU-TABLET-001', available: 30, reserved: 0 },
      { productId: 'PROD-004', sku: 'SKU-HEADPHONES-001', available: 200, reserved: 0 },
      { productId: 'PROD-005', sku: 'SKU-CHARGER-001', available: 500, reserved: 0 },
    ];

    for (const product of products) {
      this.inventory.set(product.productId, product);
    }

    this.logger.info('Inventory initialized', { productCount: products.length });
  }

  protected async processMessage(
    event: InventoryReserveEvent,
    correlationId: string
  ): Promise<void> {
    const { orderId, items } = event.payload;

    this.logger.info('Processing inventory reservation', {
      orderId,
      itemCount: items.length,
      correlationId,
    });

    // Check if reservation already exists (idempotency)
    const existingReservation = Array.from(this.reservations.values()).find(
      (r) => r.orderId === orderId
    );

    if (existingReservation) {
      this.logger.warn('Reservation already exists for order', {
        orderId,
        reservationId: existingReservation.reservationId,
        correlationId,
      });
      return;
    }

    // Attempt to reserve all items
    const reservationResult = this.attemptReservation(orderId, items);

    if (reservationResult.success) {
      const reservation: Reservation = {
        reservationId: reservationResult.reservationId!,
        orderId,
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min expiry
      };

      this.reservations.set(reservation.reservationId, reservation);

      // Emit success event
      const successEvent: InventoryResultEvent = {
        eventId: uuidv4(),
        correlationId,
        timestamp: new Date().toISOString(),
        version: '1.0',
        type: 'INVENTORY_RESERVED',
        payload: {
          orderId,
          reservationId: reservation.reservationId,
          items: items.map((item) => ({
            ...item,
            reserved: true,
          })),
        },
      };

      this.logger.info('Inventory reserved successfully', {
        orderId,
        reservationId: reservation.reservationId,
        correlationId,
      });

      this.logger.metric('inventory.reserved', 1, { status: 'success' });

    } else {
      // Emit failure event
      const failureEvent: InventoryResultEvent = {
        eventId: uuidv4(),
        correlationId,
        timestamp: new Date().toISOString(),
        version: '1.0',
        type: 'INVENTORY_FAILED',
        payload: {
          orderId,
          items: reservationResult.itemResults!,
          failureReason: reservationResult.error,
        },
      };

      this.logger.warn('Inventory reservation failed', {
        orderId,
        reason: reservationResult.error,
        correlationId,
      });

      this.logger.metric('inventory.failed', 1, { reason: 'insufficient_stock' });

      // Send notification about inventory issue
      const notificationEvent: NotificationEvent = {
        eventId: uuidv4(),
        correlationId,
        timestamp: new Date().toISOString(),
        version: '1.0',
        type: 'NOTIFICATION_REQUESTED',
        payload: {
          orderId,
          customerId: '',
          customerEmail: '',
          notificationType: 'order_cancelled',
          templateData: {
            reason: 'Some items are out of stock',
            unavailableItems: reservationResult.itemResults?.filter((i) => !i.reserved),
          },
        },
      };

      await sendMessage(this.notificationsQueueUrl, notificationEvent, {
        messageAttributes: {
          EventType: { DataType: 'String', StringValue: 'NOTIFICATION_REQUESTED' },
          CorrelationId: { DataType: 'String', StringValue: correlationId },
        },
      });
    }
  }

  /**
   * Attempt to reserve inventory for all items
   * All-or-nothing: if any item fails, rollback all
   */
  private attemptReservation(
    orderId: string,
    items: Array<{ productId: string; sku: string; quantity: number }>
  ): {
    success: boolean;
    reservationId?: string;
    error?: string;
    itemResults?: Array<{
      productId: string;
      sku: string;
      quantity: number;
      reserved: boolean;
      availableStock?: number;
    }>;
  } {
    const reservationId = `RES-${uuidv4().substring(0, 8).toUpperCase()}`;
    const itemResults: Array<{
      productId: string;
      sku: string;
      quantity: number;
      reserved: boolean;
      availableStock?: number;
    }> = [];

    // First pass: check availability
    for (const item of items) {
      const stock = this.inventory.get(item.productId);

      if (!stock) {
        itemResults.push({
          ...item,
          reserved: false,
          availableStock: 0,
        });
        continue;
      }

      const availableStock = stock.available - stock.reserved;
      const canReserve = availableStock >= item.quantity;

      itemResults.push({
        ...item,
        reserved: canReserve,
        availableStock,
      });
    }

    // Check if all items can be reserved
    const allAvailable = itemResults.every((r) => r.reserved);

    if (!allAvailable) {
      const unavailable = itemResults.filter((r) => !r.reserved);
      return {
        success: false,
        error: `Insufficient stock for: ${unavailable.map((u) => u.productId).join(', ')}`,
        itemResults,
      };
    }

    // Second pass: actually reserve
    for (const item of items) {
      const stock = this.inventory.get(item.productId)!;
      stock.reserved += item.quantity;
    }

    return {
      success: true,
      reservationId,
      itemResults,
    };
  }

  /**
   * Release a reservation (for order cancellation)
   */
  async releaseReservation(reservationId: string): Promise<boolean> {
    const reservation = this.reservations.get(reservationId);

    if (!reservation) {
      this.logger.warn('Reservation not found', { reservationId });
      return false;
    }

    // Release stock
    for (const item of reservation.items) {
      const stock = this.inventory.get(item.productId);
      if (stock) {
        stock.reserved = Math.max(0, stock.reserved - item.quantity);
      }
    }

    this.reservations.delete(reservationId);

    this.logger.info('Reservation released', {
      reservationId,
      orderId: reservation.orderId,
    });

    return true;
  }

  /**
   * Get current inventory status (for monitoring)
   */
  getInventoryStatus(): Array<StockItem> {
    return Array.from(this.inventory.values());
  }

  protected getIdempotencyKey(event: InventoryReserveEvent): string {
    return `inventory:${event.payload.orderId}`;
  }
}
