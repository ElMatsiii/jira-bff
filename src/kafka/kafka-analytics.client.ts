import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { Kafka, Producer, Consumer } from 'kafkajs';
import { randomUUID } from 'crypto';
import { ConfigService } from '../config/config.service';

/** Classifications MS3 sends in analytics.reply (healthStatus enum of the contract). */
export const MS3_HEALTH_STATUSES = ['HEALTHY', 'AT_RISK', 'CRITICAL', 'NOT_STARTED', 'NO_SCOPE'] as const;

/** MS3's classification, or UNAVAILABLE when MS3 did not answer, failed or sent none. */
export type SprintHealthStatus = (typeof MS3_HEALTH_STATUSES)[number] | 'UNAVAILABLE';

export const HEALTH_STATUS_UNAVAILABLE: SprintHealthStatus = 'UNAVAILABLE';

export const ANALYTICS_QUERY_TOPIC = 'analytics.query';
export const ANALYTICS_REPLY_TOPIC = 'analytics.reply';
/** How long the BFF waits for MS3 before reporting analytics as UNAVAILABLE. */
export const ANALYTICS_REPLY_TIMEOUT_MS = 5000;

/** queryType values accepted by jira-contracts/schemas/analytics.query.json. */
export type AnalyticsQueryType = 'BURNDOWN' | 'VELOCITY';

/** One day of the burndown, as the BFF uses it (local model, not MS3's DTO). */
export interface BurndownPoint {
  day: number;
  date: string;
  idealRemaining: number;
  /** null for days that have not happened yet (the real line ends today). */
  actualRemaining: number | null;
}

/** BFF-local analytics model built from MS3's analytics.reply. */
export interface AnalyticsResult {
  sprintId: string;
  velocity: number;
  /** Closed sprints averaged in velocity (0 = none yet); null when MS3 did not say. */
  velocitySampleSize: number | null;
  /** One value per sprint day. */
  idealBurndown: number[];
  /** Same length as idealBurndown; null for future days. */
  actualBurndown: (number | null)[];
  /** MS1 has no BLOCKED status and MS3 does not report blocked issues, so this is 0 for now. */
  blockedCount: number;
  healthStatus: SprintHealthStatus;
  /** Raw daily points (with dates), e.g. to feed the AI diagnosis. Not exposed in GraphQL. */
  burndownPoints: BurndownPoint[];
}

/** Subset of jira-contracts/schemas/analytics.reply.json the BFF reads. */
interface AnalyticsReply {
  correlationId?: string;
  sprintId?: string;
  status?: 'SUCCESS' | 'FAILED' | string;
  errorMessage?: string | null;
  velocity?: number;
  velocitySampleSize?: number;
  healthScore?: number;
  healthStatus?: string;
  burndownData?: { date?: string; dayIndex?: number; idealRemaining?: number; actualRemaining?: number | null }[];
}

type PendingRequest = { resolve: (reply: AnalyticsReply | null) => void; timer: NodeJS.Timeout };

@Injectable()
export class KafkaAnalyticsClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaAnalyticsClient.name);
  private kafka?: Kafka;
  private producer?: Producer;
  private consumer?: Consumer;
  private isConnected = false;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  /** Overridable in tests; production uses ANALYTICS_REPLY_TIMEOUT_MS. */
  replyTimeoutMs = ANALYTICS_REPLY_TIMEOUT_MS;

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
      // One group per BFF instance: every instance must see the replies to its own requests.
      this.consumer = this.kafka.consumer({ groupId: `jira-bff-analytics-${randomUUID()}` });

      await this.producer.connect();
      await this.consumer.connect();
      await this.consumer.subscribe({ topic: ANALYTICS_REPLY_TOPIC, fromBeginning: false });
      await this.consumer.run({
        eachMessage: async ({ message }) => this.handleReply(message.headers?.kafka_correlationId, message.value),
      });

      this.isConnected = true;
      this.logger.log(`KafkaAnalyticsClient connected to ${brokers.join(',')}`);
    } catch (err: any) {
      this.logger.warn(`Kafka unavailable (${err.message}); analytics will be reported as UNAVAILABLE`);
      this.isConnected = false;
    }
  }

  async onModuleDestroy() {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.resolve(null);
    }
    this.pendingRequests.clear();

    try {
      if (this.producer) await this.producer.disconnect();
      if (this.consumer) await this.consumer.disconnect();
    } catch {
      // Ignore cleanup errors on shutdown.
    }
  }

  /** Routes an analytics.reply message to the request waiting for its correlation id. */
  handleReply(header: Buffer | string | (Buffer | string)[] | undefined, value: Buffer | null | undefined): void {
    try {
      const body: AnalyticsReply | null = value ? JSON.parse(value.toString()) : null;
      const headerValue = Array.isArray(header) ? header[0] : header;
      const correlationId = headerValue?.toString() || body?.correlationId;
      if (!correlationId) return;

      const pending = this.pendingRequests.get(correlationId);
      if (!pending) return; // reply for another BFF instance, or arrived after the timeout
      clearTimeout(pending.timer);
      this.pendingRequests.delete(correlationId);
      pending.resolve(body);
    } catch (e) {
      this.logger.warn(`Error handling analytics reply: ${e}`);
    }
  }

  /**
   * Kafka request-reply towards MS3 (jira-analytics-dotnet). Resolves to the raw reply, or null
   * when Kafka is down, the send fails or MS3 does not answer in time.
   */
  private request(sprintId: string, queryType: AnalyticsQueryType, projectId?: string): Promise<AnalyticsReply | null> {
    if (!this.isConnected || !this.producer) return Promise.resolve(null);

    return new Promise((resolve) => {
      const correlationId = randomUUID();
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        this.logger.warn(`No analytics.reply from MS3 within ${this.replyTimeoutMs} ms (sprint ${sprintId}, ${queryType})`);
        resolve(null);
      }, this.replyTimeoutMs);
      this.pendingRequests.set(correlationId, { resolve, timer });

      // Shape required by jira-contracts/schemas/analytics.query.json (MS3 reads the same field names).
      const query = {
        queryId: randomUUID(),
        correlationId,
        replyTopic: ANALYTICS_REPLY_TOPIC,
        sprintId,
        ...(projectId ? { projectId } : {}),
        queryType,
        timestamp: new Date().toISOString(),
      };

      this.producer!
        .send({
          topic: ANALYTICS_QUERY_TOPIC,
          messages: [{ key: sprintId, value: JSON.stringify(query), headers: { kafka_correlationId: correlationId } }],
        })
        .catch((err) => {
          clearTimeout(timer);
          this.pendingRequests.delete(correlationId);
          this.logger.warn(`Failed to send analytics.query: ${err.message}`);
          resolve(null);
        });
    });
  }

  async getBurndownAnalytics(sprintId: string, projectId?: string): Promise<AnalyticsResult> {
    return toAnalyticsResult(sprintId, await this.request(sprintId, 'BURNDOWN', projectId), this.logger);
  }

  /** MS3's rolling velocity (story points per sprint) for the project of the given sprint, or null. */
  async getVelocity(sprintId: string, projectId?: string): Promise<number | null> {
    const reply = await this.request(sprintId, 'VELOCITY', projectId);
    if (!reply || reply.status !== 'SUCCESS' || typeof reply.velocity !== 'number' || !Number.isFinite(reply.velocity)) {
      return null;
    }
    return reply.velocity;
  }
}

export function unavailableAnalytics(sprintId: string): AnalyticsResult {
  return {
    sprintId,
    velocity: 0,
    velocitySampleSize: null,
    idealBurndown: [],
    actualBurndown: [],
    blockedCount: 0,
    healthStatus: HEALTH_STATUS_UNAVAILABLE,
    burndownPoints: [],
  };
}

/** Converts MS3's analytics.reply into the BFF-local model (interoperability rule). */
export function toAnalyticsResult(sprintId: string, reply: AnalyticsReply | null, logger?: Logger): AnalyticsResult {
  if (!reply) return unavailableAnalytics(sprintId);
  if (reply.status !== 'SUCCESS') {
    logger?.warn(`MS3 answered FAILED for sprint ${sprintId}: ${reply.errorMessage ?? 'no message'}`);
    return unavailableAnalytics(sprintId);
  }

  // A day without ideal value is unusable; a day without actual value has not happened yet and is
  // kept (with null) so the ideal line covers the whole sprint.
  const points: BurndownPoint[] = (Array.isArray(reply.burndownData) ? reply.burndownData : [])
    .filter((p) => isFiniteNumber(p?.idealRemaining))
    .map((p, index) => ({
      day: typeof p.dayIndex === 'number' ? p.dayIndex : index,
      date: typeof p.date === 'string' ? p.date : '',
      idealRemaining: p.idealRemaining as number,
      actualRemaining: isFiniteNumber(p.actualRemaining) ? p.actualRemaining : null,
    }))
    .sort((a, b) => a.day - b.day);

  return {
    sprintId,
    velocity: isFiniteNumber(reply.velocity) ? reply.velocity : 0,
    velocitySampleSize:
      Number.isInteger(reply.velocitySampleSize) && (reply.velocitySampleSize as number) >= 0
        ? (reply.velocitySampleSize as number)
        : null,
    idealBurndown: points.map((p) => Math.round(p.idealRemaining)),
    actualBurndown: points.map((p) => (p.actualRemaining === null ? null : Math.round(p.actualRemaining))),
    blockedCount: 0,
    healthStatus: toHealthStatus(reply.healthStatus),
    burndownPoints: points,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** MS3 classifies the sprint; anything else (missing or unknown) is UNAVAILABLE, never guessed here. */
export function toHealthStatus(value: unknown): SprintHealthStatus {
  return (MS3_HEALTH_STATUSES as readonly unknown[]).includes(value) ? (value as SprintHealthStatus) : HEALTH_STATUS_UNAVAILABLE;
}
