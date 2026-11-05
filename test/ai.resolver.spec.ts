import { AiResolver } from '../src/graphql/resolvers/ai.resolver';
import { McpAgentClient } from '../src/mcp/mcp-agent.client';
import { IssuesGrpcClient } from '../src/grpc/issues-grpc.client';

describe('AiResolver', () => {
  let resolver: AiResolver;
  let mockMcpClient: jest.Mocked<Partial<McpAgentClient>>;
  let mockIssuesClient: jest.Mocked<Partial<IssuesGrpcClient>>;

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
        story_points: 5,
        priority: 2,
      } as any),
    };

    resolver = new AiResolver(mockMcpClient as any, mockIssuesClient as any);
  });

  it('should decompose an epic using AI', async () => {
    const input = { epicTitle: 'Auth Epic', epicDescription: 'Desc' };
    const result = await resolver.aiDecomposeEpic(input);
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
      sprintGoal: 'Deliver Auth',
      teamCapacityStoryPoints: 20,
      candidateIssueIds: ['issue-1'],
    };
    const result = await resolver.aiPlanSprint(input);
    expect(result.sprintGoal).toBe('Deliver Auth');
    expect(result.allocatedStoryPoints).toBe(10);
    expect(result.recommendedIssueIds).toEqual(['issue-1', 'issue-2']);
    expect(mockIssuesClient.getIssue).toHaveBeenCalledWith('issue-1');
  });

  it('should diagnose sprint metrics using AI', async () => {
    const input = { sprintId: 'sprint-1', blockedIssuesCount: 0 };
    const result = await resolver.aiDiagnoseMetrics(input);
    expect(result.sprintId).toBe('sprint-1');
    expect(result.healthStatus).toBe('HEALTHY');
    expect(mockMcpClient.diagnoseMetrics).toHaveBeenCalledWith({
      sprintId: 'sprint-1',
      blockedIssuesCount: 0,
    });
  });
});
