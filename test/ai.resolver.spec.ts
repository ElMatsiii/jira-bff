import { AiResolver } from '../src/graphql/resolvers/ai.resolver';
import { McpAgentClient } from '../src/mcp/mcp-agent.client';
import { IssuesGrpcClient } from '../src/grpc/issues-grpc.client';
import { SprintsGrpcClient } from '../src/grpc/sprints-grpc.client';
import { IdentityService } from '../src/identity/identity.service';

describe('AiResolver', () => {
  let resolver: AiResolver;
  let mockMcpClient: jest.Mocked<Partial<McpAgentClient>>;
  let mockIssuesClient: jest.Mocked<Partial<IssuesGrpcClient>>;
  let mockSprintsClient: jest.Mocked<Partial<SprintsGrpcClient>>;
  let mockIdentity: { assertProjectAccess: jest.Mock; sprintLoggedHours: jest.Mock };

  beforeEach(() => {
    mockMcpClient = {
      decomposeEpic: jest.fn().mockResolvedValue({
        epicTitle: 'Auth Epic',
        stories: [
          {
            title: 'OAuth2 login',
            description: 'Implement login',
            type: 'STORY',
            estimatedStoryPoints: 5,
            acceptanceCriteriaGherkin: 'Given user When login Then success',
          },
        ],
      }),
      planSprint: jest.fn().mockResolvedValue({
        sprintGoal: 'Deliver Auth',
        allocatedStoryPoints: 10,
        recommendedIssueIds: ['issue-1', 'issue-2'],
        riskAssessment: 'LOW_RISK',
      }),
      diagnoseMetrics: jest.fn().mockResolvedValue({
        sprintId: 'sprint-1',
        healthStatus: 'HEALTHY',
        summary: 'Sprint on track',
        rootCauses: ['Stable velocity'],
        recommendations: ['Maintain pace'],
      }),
    };

    mockIssuesClient = {
      getIssue: jest.fn().mockResolvedValue({
        id: 'issue-1',
        title: 'Issue 1',
        storyPoints: 5,
        priority: 2,
        projectId: 'project-1',
      } as any),
    };

    mockSprintsClient = { getSprint: jest.fn().mockResolvedValue({ projectId: 'project-1' }) };
    mockIdentity = {
      assertProjectAccess: jest.fn().mockResolvedValue(undefined),
      sprintLoggedHours: jest.fn().mockResolvedValue(0),
    };
    resolver = new AiResolver(
      mockMcpClient as any,
      mockIssuesClient as any,
      mockSprintsClient as any,
      mockIdentity as unknown as IdentityService,
    );
  });

  it('should decompose an epic using AI', async () => {
    const input = { projectId: 'project-1', epicTitle: 'Auth Epic', epicDescription: 'Desc' };
    const result = await resolver.aiDecomposeEpic(input, { user: { id: 'user-1' } } as any);
    expect(result.epicTitle).toBe('Auth Epic');
    expect(result.stories.length).toBe(1);
    expect(result.stories[0].title).toBe('OAuth2 login');
    expect(mockMcpClient.decomposeEpic).toHaveBeenCalledWith({
      epicTitle: 'Auth Epic',
      epicDescription: 'Desc',
      projectKey: undefined,
    });
  });

  it('should plan a sprint using AI with candidate issues', async () => {
    const input = {
      projectId: 'project-1',
      sprintGoal: 'Deliver Auth',
      teamCapacityStoryPoints: 20,
      candidateIssueIds: ['issue-1'],
    };
    const result = await resolver.aiPlanSprint(input, { user: { id: 'user-1' } } as any);
    expect(result.sprintGoal).toBe('Deliver Auth');
    expect(result.allocatedStoryPoints).toBe(10);
    expect(result.recommendedIssueIds).toEqual(['issue-1', 'issue-2']);
    expect(mockIssuesClient.getIssue).toHaveBeenCalledWith('issue-1');
  });

  it('should diagnose sprint metrics using AI', async () => {
    const input = { projectId: 'project-1', sprintId: 'sprint-1', blockedIssuesCount: 0 };
    const result = await resolver.aiDiagnoseMetrics(input, { user: { id: 'user-1' } } as any);
    expect(result.sprintId).toBe('sprint-1');
    expect(result.healthStatus).toBe('HEALTHY');
    expect(mockMcpClient.diagnoseMetrics).toHaveBeenCalledWith({
      sprintId: 'sprint-1',
      blockedIssuesCount: 0,
      alerts: ['No hay horas de trabajo registradas todavía; no se puede evaluar el uso del tiempo con datos reales.'],
    });
  });
});
