import { SprintsResolver } from '../src/graphql/resolvers/sprints.resolver';
import { SprintsGrpcClient } from '../src/grpc/sprints-grpc.client';
import { SprintStatusEnum } from '../src/graphql/models/sprint.model';
import { IdentityService } from '../src/identity/identity.service';

describe('SprintsResolver', () => {
  let resolver: SprintsResolver;
  let mockClient: jest.Mocked<Partial<SprintsGrpcClient>>;

  const sampleSprint = {
    id: 'sprint-1',
    projectId: 'proj-1',
    name: 'Sprint 1',
    goal: 'Deliver MVP',
    start_date: 1700000000000,
    end_date: 1701200000000,
    status: 1,
    total_story_points: 30,
    completed_story_points: 10,
    created_at: 1700000000000,
    updated_at: 1700000000000,
  };

  beforeEach(() => {
    mockClient = {
      getSprint: jest.fn().mockResolvedValue(sampleSprint),
      listSprints: jest.fn().mockResolvedValue([sampleSprint]),
      createSprint: jest.fn().mockResolvedValue(sampleSprint),
      startSprint: jest.fn().mockResolvedValue({ ...sampleSprint, status: 2 }),
      completeSprint: jest.fn().mockResolvedValue({ ...sampleSprint, status: 3 }),
    };
    resolver = new SprintsResolver(
      mockClient as any,
      {
        assertProjectAccess: jest.fn().mockResolvedValue(undefined),
        assertSprintManagementAccess: jest.fn().mockResolvedValue(undefined),
      } as unknown as IdentityService,
    );
  });

  it('should get a sprint by id', async () => {
    const result = await resolver.getSprint('sprint-1', { user: { id: 'user-1' } } as any);
    expect(result.id).toBe('sprint-1');
    expect(result.name).toBe('Sprint 1');
    expect(result.status).toBe(SprintStatusEnum.PLANNED);
    expect(mockClient.getSprint).toHaveBeenCalledWith('sprint-1');
  });

  it('should list sprints by projectId', async () => {
    const result = await resolver.listSprints('proj-1', { user: { id: 'user-1' } } as any);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('sprint-1');
    expect(mockClient.listSprints).toHaveBeenCalledWith('proj-1');
  });

  it('should create a sprint', async () => {
    const input = {
      projectId: 'proj-1',
      name: 'Sprint 2',
      goal: 'Deliver v2',
      capacityStoryPoints: 20,
    };
    const result = await resolver.createSprint(input, { user: { id: 'user-1' } } as any);
    expect(result.id).toBe('sprint-1');
    expect(mockClient.createSprint).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Sprint 2', capacityStoryPoints: 20 }),
    );
  });

  it('should start a sprint', async () => {
    const result = await resolver.startSprint('sprint-1', { user: { id: 'user-1' } } as any);
    expect(result.status).toBe(SprintStatusEnum.ACTIVE);
    expect(mockClient.startSprint).toHaveBeenCalledWith('sprint-1');
  });

  it('should complete a sprint', async () => {
    const result = await resolver.completeSprint('sprint-1', { user: { id: 'user-1' } } as any);
    expect(result.status).toBe(SprintStatusEnum.COMPLETED);
    expect(mockClient.completeSprint).toHaveBeenCalledWith('sprint-1');
  });
});
