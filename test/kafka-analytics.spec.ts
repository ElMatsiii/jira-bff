import { Logger } from '@nestjs/common';
import { validateAnalyticsQuery, validateAnalyticsReply } from 'jira-contracts';
import {
  ANALYTICS_QUERY_TOPIC,
  ANALYTICS_REPLY_TOPIC,
  KafkaAnalyticsClient,
  toAnalyticsResult,
  unavailableAnalytics,
} from '../src/kafka/kafka-analytics.client';

jest.mock('kafkajs', () => ({ Kafka: jest.fn() }));
const { Kafka } = jest.requireMock('kafkajs') as { Kafka: jest.Mock };

const SPRINT_ID = '5b3f9d3e-1c1a-4b7a-9d55-3f0a1e6c2b11';
const PROJECT_ID = '0f8e2c7a-6d4b-4e1f-8a90-1234567890ab';

/** In-memory kafkajs: captures what the BFF sends and lets the test deliver replies. */
function fakeKafka(options: { connectError?: Error; sendError?: Error } = {}) {
  const sent: { topic: string; messages: { key: string; value: string; headers: Record<string, string> }[] }[] = [];
  let eachMessage: ((payload: { message: { headers?: Record<string, unknown>; value: Buffer | null } }) => Promise<void>) | undefined;
  const producer = {
    connect: jest.fn(async () => { if (options.connectError) throw options.connectError; }),
    send: jest.fn(async (record) => {
      if (options.sendError) throw options.sendError;
      sent.push(record);
    }),
    disconnect: jest.fn(async () => undefined),
  };
  const consumer = {
    connect: jest.fn(async () => undefined),
    subscribe: jest.fn(async () => undefined),
    run: jest.fn(async (config) => { eachMessage = config.eachMessage; }),
    disconnect: jest.fn(async () => undefined),
  };
  Kafka.mockImplementation(() => ({ producer: () => producer, consumer: () => consumer }));

  const lastQuery = () => JSON.parse(sent[sent.length - 1].messages[0].value);
  const reply = async (body: Record<string, unknown>, header: string | undefined = lastQuery().correlationId) =>
    eachMessage!({ message: { headers: header ? { kafka_correlationId: Buffer.from(header) } : {}, value: Buffer.from(JSON.stringify(body)) } });

  return { sent, producer, consumer, lastQuery, reply };
}

/** A reply shaped like MS3's AnalyticsReplyDto. */
const ms3Reply = (correlationId: string, overrides: Record<string, unknown> = {}) => ({
  replyId: '9d1c2b3a-0000-4000-8000-000000000001',
  correlationId,
  sprintId: SPRINT_ID,
  status: 'SUCCESS',
  errorMessage: null,
  totalPoints: 20,
  completedPoints: 8,
  remainingPoints: 12,
  velocity: 18.5,
  velocitySampleSize: 2,
  healthScore: 62.4,
  healthStatus: 'AT_RISK',
  burndownData: [
    { date: '2026-11-17', dayIndex: 1, idealRemaining: 17.14, actualRemaining: 20, completedOnDay: 0 },
    { date: '2026-11-16', dayIndex: 0, idealRemaining: 20, actualRemaining: 20, completedOnDay: 0 },
    { date: '2026-11-18', dayIndex: 2, idealRemaining: 14.29, actualRemaining: 12.5, completedOnDay: 8 },
    { date: '2026-11-19', dayIndex: 3, idealRemaining: 11.43, actualRemaining: null },
  ],
  diagnostics: [],
  recommendations: [],
  timestamp: '2026-11-18T12:00:00Z',
  ...overrides,
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

async function connectedClient(options?: { connectError?: Error; sendError?: Error }) {
  const kafka = fakeKafka(options);
  const client = new KafkaAnalyticsClient({ kafkaBrokers: ['kafka:9092'], kafkaClientId: 'bff-test' } as any);
  await client.onModuleInit();
  return { client, ...kafka };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('KafkaAnalyticsClient request-reply with MS3', () => {
  it('sends a query that satisfies analytics.query.json and subscribes to analytics.reply', async () => {
    const { client, consumer, sent, lastQuery, reply } = await connectedClient();

    const pending = client.getBurndownAnalytics(SPRINT_ID, PROJECT_ID);
    await flush();

    expect(consumer.subscribe).toHaveBeenCalledWith({ topic: ANALYTICS_REPLY_TOPIC, fromBeginning: false });
    expect(sent[0].topic).toBe(ANALYTICS_QUERY_TOPIC);
    const query = lastQuery();
    const validation = validateAnalyticsQuery(query);
    expect(validation.errors ?? []).toEqual([]);
    expect(validation.valid).toBe(true);
    expect(query).toMatchObject({ sprintId: SPRINT_ID, projectId: PROJECT_ID, queryType: 'BURNDOWN', replyTopic: 'analytics.reply' });
    expect(query.queryId).not.toBe(query.correlationId);
    expect(sent[0].messages[0].headers.kafka_correlationId).toBe(query.correlationId);
    expect(sent[0].messages[0].key).toBe(SPRINT_ID);

    await reply(ms3Reply(query.correlationId));
    await expect(pending).resolves.toEqual({
      sprintId: SPRINT_ID,
      velocity: 18.5,
      velocitySampleSize: 2,
      idealBurndown: [20, 17, 14, 11],
      actualBurndown: [20, 20, 13, null],
      blockedCount: 0,
      healthStatus: 'AT_RISK',
      burndownPoints: [
        { day: 0, date: '2026-11-16', idealRemaining: 20, actualRemaining: 20 },
        { day: 1, date: '2026-11-17', idealRemaining: 17.14, actualRemaining: 20 },
        { day: 2, date: '2026-11-18', idealRemaining: 14.29, actualRemaining: 12.5 },
        { day: 3, date: '2026-11-19', idealRemaining: 11.43, actualRemaining: null },
      ],
    });
  });

  it('the MS3 reply fixture used here is valid against analytics.reply.json', () => {
    const result = validateAnalyticsReply(ms3Reply('2c7e1d55-8f3b-4a6e-9c21-7d4b3a2e1f00'));
    expect(result.errors ?? []).toEqual([]);
  });

  it('omits projectId when unknown and asks MS3 for VELOCITY', async () => {
    const { client, lastQuery, reply } = await connectedClient();

    const pending = client.getVelocity(SPRINT_ID);
    await flush();
    const query = lastQuery();
    expect(query.queryType).toBe('VELOCITY');
    expect(query).not.toHaveProperty('projectId');
    expect(validateAnalyticsQuery(query).valid).toBe(true);

    await reply(ms3Reply(query.correlationId, { velocity: 21 }));
    await expect(pending).resolves.toBe(21);
  });

  it('falls back to the body correlationId when the header is missing', async () => {
    const { client, lastQuery, reply } = await connectedClient();
    const pending = client.getBurndownAnalytics(SPRINT_ID);
    await flush();

    await reply(ms3Reply(lastQuery().correlationId), undefined);

    await expect(pending).resolves.toMatchObject({ healthStatus: 'AT_RISK' });
  });

  it('ignores replies for other requests and malformed messages', async () => {
    const { client, lastQuery, reply } = await connectedClient();
    client.replyTimeoutMs = 50;
    const pending = client.getBurndownAnalytics(SPRINT_ID);
    await flush();

    await reply(ms3Reply('another-request'), 'another-request');
    client.handleReply(undefined, Buffer.from('{not json'));
    client.handleReply(undefined, null);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('Error handling analytics reply'));

    await reply(ms3Reply(lastQuery().correlationId));
    await expect(pending).resolves.toMatchObject({ velocity: 18.5 });
  });

  it('reports UNAVAILABLE (not fabricated data) when MS3 answers FAILED', async () => {
    const { client, lastQuery, reply } = await connectedClient();
    const pending = client.getBurndownAnalytics(SPRINT_ID);
    await flush();

    await reply(ms3Reply(lastQuery().correlationId, { status: 'FAILED', errorMessage: 'Mongo down' }));

    await expect(pending).resolves.toEqual(unavailableAnalytics(SPRINT_ID));
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('Mongo down'));
  });

  it('reports UNAVAILABLE when MS3 does not answer in time', async () => {
    const { client } = await connectedClient();
    client.replyTimeoutMs = 20;

    await expect(client.getBurndownAnalytics(SPRINT_ID)).resolves.toMatchObject({ healthStatus: 'UNAVAILABLE', idealBurndown: [] });
    await expect(client.getVelocity(SPRINT_ID)).resolves.toBeNull();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('No analytics.reply from MS3 within 20 ms'));
  });

  it('reports UNAVAILABLE when the query cannot be sent', async () => {
    const { client } = await connectedClient({ sendError: new Error('leader not available') });

    await expect(client.getBurndownAnalytics(SPRINT_ID)).resolves.toMatchObject({ healthStatus: 'UNAVAILABLE' });
    expect(Logger.prototype.warn).toHaveBeenCalledWith('Failed to send analytics.query: leader not available');
  });

  it('reports UNAVAILABLE when Kafka is down at startup, without trying to send', async () => {
    const { client, producer } = await connectedClient({ connectError: new Error('ECONNREFUSED') });

    await expect(client.getBurndownAnalytics(SPRINT_ID)).resolves.toEqual(unavailableAnalytics(SPRINT_ID));
    expect(producer.send).not.toHaveBeenCalled();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('Kafka unavailable (ECONNREFUSED)'));
  });

  it('is UNAVAILABLE before onModuleInit and survives onModuleDestroy without Kafka', async () => {
    const client = new KafkaAnalyticsClient();
    await expect(client.getBurndownAnalytics(SPRINT_ID)).resolves.toMatchObject({ healthStatus: 'UNAVAILABLE' });
    await expect(client.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('resolves pending requests as UNAVAILABLE and disconnects on shutdown', async () => {
    const { client, producer, consumer } = await connectedClient();
    const pending = client.getBurndownAnalytics(SPRINT_ID);
    await flush();

    await client.onModuleDestroy();

    await expect(pending).resolves.toMatchObject({ healthStatus: 'UNAVAILABLE' });
    expect(producer.disconnect).toHaveBeenCalled();
    expect(consumer.disconnect).toHaveBeenCalled();
  });

  it('getVelocity returns null for FAILED or non-numeric velocity', async () => {
    const { client, lastQuery, reply } = await connectedClient();

    let pending = client.getVelocity(SPRINT_ID);
    await flush();
    await reply(ms3Reply(lastQuery().correlationId, { status: 'FAILED' }));
    await expect(pending).resolves.toBeNull();

    pending = client.getVelocity(SPRINT_ID);
    await flush();
    await reply(ms3Reply(lastQuery().correlationId, { velocity: 'n/a' }));
    await expect(pending).resolves.toBeNull();
  });
});

describe('toAnalyticsResult (MS3 reply → BFF model)', () => {
  it('keeps days without actual value as null, drops days without ideal value and keeps order by day', () => {
    const result = toAnalyticsResult(SPRINT_ID, {
      status: 'SUCCESS',
      healthStatus: 'HEALTHY',
      burndownData: [
        { idealRemaining: 12, actualRemaining: 12 },
        { dayIndex: 2, idealRemaining: 4, actualRemaining: null },
        { dayIndex: 1, actualRemaining: 9 },
        { dayIndex: 3, idealRemaining: 0 },
      ],
    });

    expect(result).toMatchObject({
      velocity: 0,
      velocitySampleSize: null,
      healthStatus: 'HEALTHY',
      idealBurndown: [12, 4, 0],
      actualBurndown: [12, null, null],
    });
    expect(result.burndownPoints.map((p) => p.date)).toEqual(['', '', '']);
  });

  it.each(['HEALTHY', 'AT_RISK', 'CRITICAL', 'NOT_STARTED', 'NO_SCOPE'])('uses the %s classification sent by MS3', (status) => {
    expect(toAnalyticsResult(SPRINT_ID, { status: 'SUCCESS', healthStatus: status, healthScore: 100 }).healthStatus).toBe(status);
  });

  it('never classifies the score itself: without a valid healthStatus it is UNAVAILABLE', () => {
    expect(toAnalyticsResult(SPRINT_ID, { status: 'SUCCESS', healthScore: 90 }).healthStatus).toBe('UNAVAILABLE');
    expect(toAnalyticsResult(SPRINT_ID, { status: 'SUCCESS', healthStatus: 'GREAT' }).healthStatus).toBe('UNAVAILABLE');
  });

  it('keeps velocitySampleSize 0 (no closed sprints) and ignores invalid values', () => {
    expect(toAnalyticsResult(SPRINT_ID, { status: 'SUCCESS', velocitySampleSize: 0 }).velocitySampleSize).toBe(0);
    expect(toAnalyticsResult(SPRINT_ID, { status: 'SUCCESS', velocitySampleSize: -1 }).velocitySampleSize).toBeNull();
    expect(toAnalyticsResult(SPRINT_ID, { status: 'SUCCESS', velocitySampleSize: 1.5 }).velocitySampleSize).toBeNull();
  });

  it('is UNAVAILABLE without a reply', () => {
    expect(toAnalyticsResult(SPRINT_ID, null)).toEqual(unavailableAnalytics(SPRINT_ID));
    expect(unavailableAnalytics(SPRINT_ID).velocitySampleSize).toBeNull();
    expect(toAnalyticsResult(SPRINT_ID, { status: 'SUCCESS', burndownData: 'x' as any }).idealBurndown).toEqual([]);
  });
});
