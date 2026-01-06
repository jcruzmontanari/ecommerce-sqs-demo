/**
 * Simple structured logger for observability
 * In production, this would integrate with DataDog, CloudWatch, etc.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  correlationId?: string;
  service?: string;
  orderId?: string;
  messageId?: string;
  [key: string]: unknown;
}

const LOG_COLORS = {
  debug: '\x1b[36m',  // Cyan
  info: '\x1b[32m',   // Green
  warn: '\x1b[33m',   // Yellow
  error: '\x1b[31m',  // Red
  reset: '\x1b[0m',
};

class Logger {
  private service: string;

  constructor(service: string) {
    this.service = service;
  }

  private log(level: LogLevel, message: string, context: LogContext = {}): void {
    const timestamp = new Date().toISOString();
    const color = LOG_COLORS[level];
    const reset = LOG_COLORS.reset;

    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      service: this.service,
      message,
      ...context,
    };

    // Structured log for production (JSON)
    // In DataDog, you'd parse this JSON and create dashboards/alerts
    const jsonLog = JSON.stringify(logEntry);

    // Pretty console output for development
    console.log(
      `${color}[${timestamp}] [${level.toUpperCase()}] [${this.service}]${reset} ${message}`,
      Object.keys(context).length > 0 ? context : ''
    );
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  // Metrics helper - in production would send to DataDog
  metric(name: string, value: number, tags: Record<string, string> = {}): void {
    this.info(`METRIC: ${name}=${value}`, { metricName: name, metricValue: value, ...tags });
  }
}

export function createLogger(service: string): Logger {
  return new Logger(service);
}

export type { Logger };
