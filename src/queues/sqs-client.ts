/**
 * AWS SQS Client Configuration
 *
 * Uses AWS SDK v3 with support for:
 * - LocalStack for local development
 * - Real AWS for production
 */

import {
  SQSClient,
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueUrlCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ListQueuesCommand,
  PurgeQueueCommand,
  type SendMessageCommandInput,
  type ReceiveMessageCommandInput,
  type Message,
} from '@aws-sdk/client-sqs';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('SQS-Client');

// Configuration for local development vs AWS
interface SQSConfig {
  region: string;
  endpoint?: string;  // LocalStack endpoint for local dev
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

function getConfig(): SQSConfig {
  const isLocal = process.env.USE_LOCALSTACK === 'true';

  if (isLocal) {
    return {
      region: 'us-east-1',
      endpoint: process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566',
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    };
  }

  return {
    region: process.env.AWS_REGION || 'us-east-1',
  };
}

// Singleton SQS client
let sqsClient: SQSClient | null = null;

export function getSQSClient(): SQSClient {
  if (!sqsClient) {
    const config = getConfig();
    sqsClient = new SQSClient(config);
    logger.info('SQS client initialized', { region: config.region, endpoint: config.endpoint });
  }
  return sqsClient;
}

// Queue management functions
export async function createQueue(
  queueName: string,
  options: {
    delaySeconds?: number;
    visibilityTimeout?: number;
    messageRetentionPeriod?: number;
    fifo?: boolean;
  } = {}
): Promise<string> {
  const client = getSQSClient();

  const attributes: Record<string, string> = {
    DelaySeconds: String(options.delaySeconds ?? 0),
    VisibilityTimeout: String(options.visibilityTimeout ?? 30),
    MessageRetentionPeriod: String(options.messageRetentionPeriod ?? 345600), // 4 days
  };

  if (options.fifo) {
    attributes.FifoQueue = 'true';
    attributes.ContentBasedDeduplication = 'true';
  }

  const command = new CreateQueueCommand({
    QueueName: options.fifo ? `${queueName}.fifo` : queueName,
    Attributes: attributes,
  });

  const response = await client.send(command);
  logger.info(`Queue created: ${queueName}`, { queueUrl: response.QueueUrl });

  return response.QueueUrl!;
}

export async function getQueueUrl(queueName: string): Promise<string> {
  const client = getSQSClient();
  const command = new GetQueueUrlCommand({ QueueName: queueName });
  const response = await client.send(command);
  return response.QueueUrl!;
}

export async function getQueueArn(queueUrl: string): Promise<string> {
  const client = getSQSClient();
  const command = new GetQueueAttributesCommand({
    QueueUrl: queueUrl,
    AttributeNames: ['QueueArn'],
  });
  const response = await client.send(command);
  return response.Attributes?.QueueArn!;
}

export async function configureDeadLetterQueue(
  sourceQueueUrl: string,
  dlqArn: string,
  maxReceiveCount: number = 3
): Promise<void> {
  const client = getSQSClient();

  const redrivePolicy = JSON.stringify({
    deadLetterTargetArn: dlqArn,
    maxReceiveCount: maxReceiveCount,
  });

  const command = new SetQueueAttributesCommand({
    QueueUrl: sourceQueueUrl,
    Attributes: {
      RedrivePolicy: redrivePolicy,
    },
  });

  await client.send(command);
  logger.info('Dead letter queue configured', {
    sourceQueueUrl,
    dlqArn,
    maxReceiveCount,
  });
}

export async function deleteQueue(queueUrl: string): Promise<void> {
  const client = getSQSClient();
  const command = new DeleteQueueCommand({ QueueUrl: queueUrl });
  await client.send(command);
  logger.info(`Queue deleted: ${queueUrl}`);
}

export async function listQueues(prefix?: string): Promise<string[]> {
  const client = getSQSClient();
  const command = new ListQueuesCommand({
    QueueNamePrefix: prefix,
  });
  const response = await client.send(command);
  return response.QueueUrls ?? [];
}

export async function purgeQueue(queueUrl: string): Promise<void> {
  const client = getSQSClient();
  const command = new PurgeQueueCommand({ QueueUrl: queueUrl });
  await client.send(command);
  logger.info(`Queue purged: ${queueUrl}`);
}

// Message operations
export async function sendMessage<T>(
  queueUrl: string,
  message: T,
  options: {
    delaySeconds?: number;
    messageGroupId?: string;  // Required for FIFO
    deduplicationId?: string; // For FIFO
    messageAttributes?: Record<string, { DataType: string; StringValue: string }>;
  } = {}
): Promise<string> {
  const client = getSQSClient();

  const input: SendMessageCommandInput = {
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(message),
    DelaySeconds: options.delaySeconds,
    MessageAttributes: options.messageAttributes,
  };

  if (options.messageGroupId) {
    input.MessageGroupId = options.messageGroupId;
  }

  if (options.deduplicationId) {
    input.MessageDeduplicationId = options.deduplicationId;
  }

  const command = new SendMessageCommand(input);
  const response = await client.send(command);

  logger.debug('Message sent', {
    queueUrl,
    messageId: response.MessageId,
  });

  return response.MessageId!;
}

export async function receiveMessages(
  queueUrl: string,
  options: {
    maxMessages?: number;
    visibilityTimeout?: number;
    waitTimeSeconds?: number;
  } = {}
): Promise<Message[]> {
  const client = getSQSClient();

  const input: ReceiveMessageCommandInput = {
    QueueUrl: queueUrl,
    MaxNumberOfMessages: options.maxMessages ?? 10,
    VisibilityTimeout: options.visibilityTimeout ?? 30,
    WaitTimeSeconds: options.waitTimeSeconds ?? 20,  // Long polling
    MessageAttributeNames: ['All'],
    AttributeNames: ['All'],
  };

  const command = new ReceiveMessageCommand(input);
  const response = await client.send(command);

  return response.Messages ?? [];
}

export async function deleteMessage(
  queueUrl: string,
  receiptHandle: string
): Promise<void> {
  const client = getSQSClient();
  const command = new DeleteMessageCommand({
    QueueUrl: queueUrl,
    ReceiptHandle: receiptHandle,
  });
  await client.send(command);
  logger.debug('Message deleted', { queueUrl, receiptHandle: receiptHandle.substring(0, 20) });
}

export { type Message };
