import { KafkaAnalyticsClient } from '../src/kafka/kafka-analytics.client';

describe('KafkaAnalyticsClient', () => {
  let client: KafkaAnalyticsClient;

  beforeEach(() => {
    client = new KafkaAnalyticsClient();
  });

  it('should return mock analytics when kafka is offline', async () => {
    const res = await client.getBurndownAnalytics('sprint-mock');
    expect(res.sprintId).toBe('sprint-mock');
    expect(res.velocity).toBeGreaterThan(0);
    expect(res.idealBurndown.length).toBeGreaterThan(0);
    expect(res.actualBurndown.length).toBeGreaterThan(0);
    expect(res.healthStatus).toBe('HEALTHY');
  });

  it('should return team velocity when kafka is offline', async () => {
    const velocity = await client.getTeamVelocity('team-1');
    expect(velocity).toBeGreaterThan(0);
  });

  it('should handle onModuleDestroy gracefully', async () => {
    await expect(client.onModuleDestroy()).resolves.not.toThrow();
  });
});
