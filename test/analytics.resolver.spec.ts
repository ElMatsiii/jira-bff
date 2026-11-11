import { AnalyticsResolver } from '../src/graphql/resolvers/analytics.resolver';
import { KafkaAnalyticsClient } from '../src/kafka/kafka-analytics.client';
import { IdentityService } from '../src/identity/identity.service';
import { SprintsGrpcClient } from '../src/grpc/sprints-grpc.client';

describe('AnalyticsResolver', () => {
  let resolver: AnalyticsResolver;
  let mockClient: jest.Mocked<Partial<KafkaAnalyticsClient>>;
  let mockSprintsClient: jest.Mocked<Partial<SprintsGrpcClient>>;
  let mockIdentity: { assertProjectAccess: jest.Mock; assertWorkspaceAccess: jest.Mock };

  const sampleAnalytics = {
    sprintId: 'sprint-1',
    velocity: 35,
    idealBurndown: [40, 30, 20, 10, 0],
    actualBurndown: [40, 38, 25, 12, 0],
    blockedCount: 1,
    healthStatus: 'HEALTHY',
  };

  beforeEach(() => {
    mockClient = {
      getBurndownAnalytics: jest.fn().mockResolvedValue(sampleAnalytics),
      getTeamVelocity: jest.fn().mockResolvedValue(35),
    };
    mockSprintsClient = { getSprint: jest.fn().mockResolvedValue({ projectId: 'project-1' }) };
    mockIdentity = { assertProjectAccess: jest.fn().mockResolvedValue(undefined), assertWorkspaceAccess: jest.fn().mockResolvedValue(undefined) };
    resolver = new AnalyticsResolver(mockClient as any, mockIdentity as unknown as IdentityService, mockSprintsClient as any);
  });

  it('should get burndown analytics for a sprint', async () => {
    const result = await resolver.getBurndownAnalytics('sprint-1', { user: { id: 'user-1' } } as any);
    expect(result.sprintId).toBe('sprint-1');
    expect(result.velocity).toBe(35);
    expect(result.healthStatus).toBe('HEALTHY');
    expect(mockClient.getBurndownAnalytics).toHaveBeenCalledWith('sprint-1');
  });

  it('should get team velocity', async () => {
    const result = await resolver.getTeamVelocity('team-1', { user: { id: 'user-1' } } as any);
    expect(result).toBe(35);
    expect(mockClient.getTeamVelocity).toHaveBeenCalledWith('team-1');
  });
});
