import fs from 'fs';
import path from 'path';

/**
 * Simple file logger for debugging
 */
class FileLogger {
  private logFile: string;
  private errorFile: string;

  constructor() {
    const logDir = path.join(process.cwd(), 'logs');

    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    this.logFile = path.join(logDir, `bot-${this.getDateString()}.log`);
    this.errorFile = path.join(logDir, `error-${this.getDateString()}.log`);
  }

  private getDateString(): string {
    const now = new Date();
    return now.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  private getTimestamp(): string {
    return new Date().toISOString();
  }

  private formatMessage(level: string, message: string): string {
    return `[${this.getTimestamp()}] [${level}] ${message}\n`;
  }

  log(message: string, data?: any) {
    const logMessage = data
      ? `${message}\n${JSON.stringify(data, null, 2)}`
      : message;

    const formatted = this.formatMessage('INFO', logMessage);

    // Write to console
    console.log(message, data || '');

    // Write to file
    fs.appendFileSync(this.logFile, formatted);
  }

  error(message: string, error?: any) {
    let errorMessage = message;

    if (error) {
      if (error instanceof Error) {
        errorMessage += `\nError: ${error.message}\nStack: ${error.stack}`;
      } else if (typeof error === 'object') {
        errorMessage += `\n${JSON.stringify(error, null, 2)}`;
      } else {
        errorMessage += `\n${String(error)}`;
      }
    }

    const formatted = this.formatMessage('ERROR', errorMessage);

    // Write to console
    console.error(message, error || '');

    // Write to both files
    fs.appendFileSync(this.logFile, formatted);
    fs.appendFileSync(this.errorFile, formatted);
  }

  grammy(ctx: any, error: any) {
    console.error('\n============ FULL GRAMMY ERROR ============');
    console.error('Error:', error);

    if (error instanceof Error) {
      console.error('\nError Message:', error.message);
      console.error('\nError Name:', error.name);
      console.error('\nFull Stack Trace:');
      console.error(error.stack);
    }

    console.error('\nUpdate Context:', JSON.stringify(ctx.update, null, 2));
    console.error('==========================================\n');

    const errorData = {
      update: ctx.update,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : error,
    };

    this.error('💥 Grammy Error Handler', errorData);
  }
}

export const logger = new FileLogger();
