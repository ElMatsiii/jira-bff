import { SprintStatus } from 'jira-contracts/gen/ts';
import { AnalyticsResolver, pickReferenceSprint } from '../src/graphql/resolvers/analytics.resolver';
import { KafkaAnalyticsClient } from '../src/kafka/kafka-analytics.client';
import { IdentityService } from '../src/identity/identity.service';
import { SprintsGrpcClient } from '../src/grpc/sprints-grpc.client';

const sprint = (id: string, status: SprintStatus, endDate: number) =>
  ({ id, projectId: 'project-1', name: id, goal: '', startDate: 0, endDate, status, totalStoryPoints: 0, completedStoryPoints: 0, createdAt: 0, updatedAt: 0 });

describe('AnalyticsResolver', () => {
  let resolver: AnalyticsResolver;
  let mockClient: jest.Mocked<Partial<KafkaAnalyticsClient>>;
  let mockSprintsClient: jest.Mocked<Partial<SprintsGrpcClient>>;
  let mockIdentity: { assertProjectAccess: jest.Mock; assertWorkspaceAccess: jest.Mock };
  const user = { user: { id: 'user-1' } } as any;

  const sampleAnalytics = {
    sprintId: 'sprint-1',
    velocity: 35,
    idealBurndown: [40, 30, 20, 10, 0],
    actualBurndown: [40, 38, 25, 12, 0],
    blockedCount: 0,
    healthStatus: 'HEALTHY' as const,
    burndownPoints: [{ day: 0, date: '2026-11-16', idealRemaining: 40, actualRemaining: 40 }],
  };

  beforeEach(() => {
    mockClient = {
      getBurndownAnalytics: jest.fn().mockResolvedValue(sampleAnalytics),
      getVelocity: jest.fn().mockResolvedValue(21.5),
    };
    mockSprintsClient = {
      getSprint: jest.fn().mockResolvedValue({ projectId: 'project-1' }),
      listSprints: jest.fn().mockResolvedValue([]),
    };
    mockIdentity = { assertProjectAccess: jest.fn().mockResolvedValue(undefined), assertWorkspaceAccess: jest.fn() };
    resolver = new AnalyticsResolver(mockClient as any, mockIdentity as unknown as IdentityService, mockSprintsClient as any);
  });

  it('gets burndown analytics for a sprint, passing its project, without exposing raw points', async () => {
    const result = await resolver.getBurndownAnalytics('sprint-1', user);

    expect(mockIdentity.assertProjectAccess).toHaveBeenCalledWith('user-1', 'project-1');
    expect(mockClient.getBurndownAnalytics).toHaveBeenCalledWith('sprint-1', 'project-1');
    expect(result).toEqual({
      sprintId: 'sprint-1', velocity: 35, idealBurndown: [40, 30, 20, 10, 0], actualBurndown: [40, 38, 25, 12, 0],
      blockedCount: 0, healthStatus: 'HEALTHY',
    });
  });

  it('passes UNAVAILABLE through when MS3 did not answer', async () => {
    (mockClient.getBurndownAnalytics as jest.Mock).mockResolvedValueOnce({
      ...sampleAnalytics, velocity: 0, idealBurndown: [], actualBurndown: [], healthStatus: 'UNAVAILABLE', burndownPoints: [],
    });
    const result = await resolver.getBurndownAnalytics('sprint-1', user);
    expect(result.healthStatus).toBe('UNAVAILABLE');
    expect(result.idealBurndown).toEqual([]);
  });

  describe('getProjectVelocity', () => {
    it('asks MS3 for the velocity using the active sprint of the project', async () => {
      (mockSprintsClient.listSprints as jest.Mock).mockResolvedValueOnce([
        sprint('done-1', SprintStatus.SPRINT_STATUS_COMPLETED, 100),
        sprint('active', SprintStatus.SPRINT_STATUS_ACTIVE, 300),
        sprint('planned', SprintStatus.SPRINT_STATUS_PLANNED, 500),
      ]);

      await expect(resolver.getProjectVelocity('project-1', user)).resolves.toBe(21.5);
      expect(mockIdentity.assertProjectAccess).toHaveBeenCalledWith('user-1', 'project-1');
      expect(mockClient.getVelocity).toHaveBeenCalledWith('active', 'project-1');
    });

    it('returns null when the project has no sprints, without querying MS3', async () => {
      await expect(resolver.getProjectVelocity('project-1', user)).resolves.toBeNull();
      expect(mockClient.getVelocity).not.toHaveBeenCalled();
    });

    it('returns null when MS3 is unavailable', async () => {
      (mockSprintsClient.listSprints as jest.Mock).mockResolvedValueOnce([sprint('a', SprintStatus.SPRINT_STATUS_ACTIVE, 1)]);
      (mockClient.getVelocity as jest.Mock).mockResolvedValueOnce(null);
      await expect(resolver.getProjectVelocity('project-1', user)).resolves.toBeNull();
    });

    it('does not reach MS2 or MS3 when the user has no access to the project', async () => {
      mockIdentity.assertProjectAccess.mockRejectedValueOnce(new Error('No tienes acceso a este proyecto.'));
      await expect(resolver.getProjectVelocity('project-1', user)).rejects.toThrow('No tienes acceso');
      expect(mockSprintsClient.listSprints).not.toHaveBeenCalled();
    });
  });

  describe('pickReferenceSprint', () => {
    it('prefers the active sprint, then the latest completed, then the latest non-cancelled', () => {
      const completedOld = sprint('c-old', SprintStatus.SPRINT_STATUS_COMPLETED, 100);
      const completedNew = sprint('c-new', SprintStatus.SPRINT_STATUS_COMPLETED, 200);
      const planned = sprint('p', SprintStatus.SPRINT_STATUS_PLANNED, 900);
      const cancelled = sprint('x', SprintStatus.SPRINT_STATUS_CANCELLED, 999);
      const active = sprint('a', SprintStatus.SPRINT_STATUS_ACTIVE, 50);

      expect(pickReferenceSprint([completedOld, active, completedNew])?.id).toBe('a');
      expect(pickReferenceSprint([completedOld, completedNew, planned])?.id).toBe('c-new');
      expect(pickReferenceSprint([cancelled, planned])?.id).toBe('p');
      expect(pickReferenceSprint([cancelled])).toBeNull();
      expect(pickReferenceSprint([])).toBeNull();
    });
  });
});
