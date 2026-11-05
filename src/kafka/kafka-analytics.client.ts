import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { Kafka, Producer, Consumer } from 'kafkajs';
import { randomUUID } from 'crypto';
import { ConfigService } from '../config/config.service';

export interface AnalyticsResult {
  sprintId: string;
  velocity: number;
  idealBurndown: number[];
  actualBurndown: number[];
  blockedCount: number;
  healthStatus: string;
}

@Injectable()
export class KafkaAnalyticsClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaAnalyticsClient.name);
  private kafka?: Kafka;
  private producer?: Producer;
  private consumer?: Consumer;
  private isConnected = false;
  private pendingRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void; timer: NodeJS.Timeout }>();

  constructor(@Optional() private readonly configService?: ConfigService) {}

  async onModuleInit() {
    const brokers = this.configService?.kafkaBrokers || ['localhost:9092'];
    try {
      this.kafka = new Kafka({
        clientId: this.configService?.kafkaClientId || 'jira-bff-gateway',
        brokers,
        retry: { retries: 2 },
      });

      this.producer = this.kafka.producer();
      this.consumer = this.kafka.consumer({ groupId: `jira-bff-analytics-${randomUUID()}` });

      await this.producer.connect();
      await this.consumer.connect();
      await this.consumer.subscribe({ topic: 'analytics.reply', fromBeginning: false });

      await this.consumer.run({
        eachMessage: async ({ message }) => {
          try {
            const correlationId = message.headers?.['kafka_correlationId']?.toString() ||
              (message.value ? JSON.parse(message.value.toString()).correlationId : null);

            if (correlationId && this.pendingRequests.has(correlationId)) {
              const pending = this.pendingRequests.get(correlationId)!;
              clearTimeout(pending.timer);
              this.pendingRequests.delete(correlationId);
              const data = JSON.parse(message.value!.toString());
              pending.resolve(data);
            }
          } catch (e) {
            this.logger.warn(`Error handling Kafka reply: ${e}`);
          }
        },
      });

      this.isConnected = true;
      this.logger.log(`KafkaAnalyticsClient connected to ${brokers.join(',')}`);
    } catch (err: any) {
      this.logger.warn(`Kafka unavailable (${err.message}), falling back to offline analytics provider`);
      this.isConnected = false;
    }
  }

  async onModuleDestroy() {
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error('Client shutting down'));
    }
    this.pendingRequests.clear();

    try {
      if (this.producer) await this.producer.disconnect();
      if (this.consumer) await this.consumer.disconnect();
    } catch (e) {
      // Ignore cleanup error
    }
  }

  async getBurndownAnalytics(sprintId: string): Promise<AnalyticsResult> {
    if (!this.isConnected || !this.producer) {
      return this.generateMockAnalytics(sprintId);
    }

    return new Promise((resolve) => {
      const correlationId = randomUUID();
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        this.logger.warn(`Kafka Request-Reply timeout for sprintId: ${sprintId}, returning offline fallback`);
        resolve(this.generateMockAnalytics(sprintId));
      }, 3000);

      this.pendingRequests.set(correlationId, {
        resolve: (data) => resolve(this.mapReplyToResult(sprintId, data)),
        reject: () => resolve(this.generateMockAnalytics(sprintId)),
        timer,
      });

      this.producer!.send({
        topic: 'analytics.query',
        messages: [
          {
            key: sprintId,
            value: JSON.stringify({
              correlationId,
              queryType: 'BURNDOWN_QUERY',
              sprintId,
              timestamp: Date.now(),
            }),
            headers: {
              kafka_correlationId: correlationId,
            },
          },
        ],
      }).catch((err) => {
        clearTimeout(timer);
        this.pendingRequests.delete(correlationId);
        this.logger.warn(`Failed to produce Kafka query: ${err.message}`);
        resolve(this.generateMockAnalytics(sprintId));
      });
    });
  }

  async getTeamVelocity(teamId: string): Promise<number> {
    const analytics = await this.getBurndownAnalytics(teamId);
    return analytics.velocity;
  }

  private mapReplyToResult(sprintId: string, reply: any): AnalyticsResult {
    return {
      sprintId,
      velocity: reply.velocity || 35,
      idealBurndown: reply.idealBurndown || [40, 32, 24, 16, 8, 0],
      actualBurndown: reply.actualBurndown || [40, 38, 30, 22, 12, 5],
      blockedCount: reply.blockedCount || 0,
      healthStatus: reply.healthStatus || 'HEALTHY',
    };
  }

  private generateMockAnalytics(sprintId: string): AnalyticsResult {
    return {
      sprintId,
      velocity: 32,
      idealBurndown: [40, 32, 24, 16, 8, 0],
      actualBurndown: [40, 38, 31, 25, 18, 10],
      blockedCount: 1,
      healthStatus: 'HEALTHY',
    };
  }
}
