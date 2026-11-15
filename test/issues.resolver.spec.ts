import { IssuesResolver } from '../src/graphql/resolvers/issues.resolver';
import { IssuesGrpcClient } from '../src/grpc/issues-grpc.client';
import { IssueStatusEnum } from '../src/graphql/models/issue.model';
import { IdentityService } from '../src/identity/identity.service';
import { SprintsGrpcClient } from '../src/grpc/sprints-grpc.client';

describe('IssuesResolver', () => {
  let resolver: IssuesResolver;
  let mockClient: jest.Mocked<Partial<IssuesGrpcClient>>;

  const sampleIssue = {
    id: 'issue-1',
    key: 'PROJ-1',
    projectId: 'proj-1',
    title: 'Test Issue',
    description: 'Description',
    status: 1,
    priority: 2,
    type: 1,
    story_points: 5,
    sprint_id: 'sprint-1',
    assignee_id: 'user-1',
    reporter_id: 'user-2',
    acceptance_criteria: 'Given test When run Then pass',
    created_at: 1700000000000,
    updated_at: 1700000000000,
  };

  beforeEach(() => {
    mockClient = {
      getIssue: jest.fn().mockResolvedValue(sampleIssue),
      listIssues: jest.fn().mockResolvedValue([sampleIssue]),
      createIssue: jest.fn().mockResolvedValue(sampleIssue),
      updateIssueStatus: jest.fn().mockResolvedValue({ ...sampleIssue, status: 2 }),
    };
    resolver = new IssuesResolver(
      mockClient as any,
      { assertProjectAccess: jest.fn().mockResolvedValue(undefined) } as unknown as IdentityService,
      // The resolver now also needs MS2 (sprint lookup when assigning issues to a sprint).
      { getSprint: jest.fn().mockResolvedValue({ id: 'sprint-1', projectId: 'proj-1' }) } as unknown as SprintsGrpcClient,
    );
  });

  it('should get an issue by id', async () => {
    const result = await resolver.getIssue('issue-1', { user: { id: 'user-1' } } as any);
    expect(result.id).toBe('issue-1');
    expect(result.title).toBe('Test Issue');
    expect(result.status).toBe(IssueStatusEnum.TODO);
    expect(mockClient.getIssue).toHaveBeenCalledWith('issue-1');
  });

  it('should list issues by projectId and sprintId', async () => {
    const result = await resolver.listIssues('proj-1', 'sprint-1', { user: { id: 'user-1' } } as any);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('issue-1');
    expect(mockClient.listIssues).toHaveBeenCalledWith('proj-1', 'sprint-1');
  });

  it('should create an issue', async () => {
    const input = {
      projectId: 'proj-1',
      title: 'New Issue',
      storyPoints: 5,
    };
    const result = await resolver.createIssue(input, { user: { id: 'user-1' } } as any);
    expect(result.id).toBe('issue-1');
    expect(mockClient.createIssue).toHaveBeenCalled();
  });

  it('should update an issue status', async () => {
    const input = {
      id: 'issue-1',
      status: IssueStatusEnum.IN_PROGRESS,
    };
    const result = await resolver.updateIssueStatus(input, { user: { id: 'user-1' } } as any);
    expect(result.status).toBe(IssueStatusEnum.IN_PROGRESS);
    expect(mockClient.updateIssueStatus).toHaveBeenCalledWith('issue-1', 2);
  });
});
