import { McpAgentClient } from '../src/mcp/mcp-agent.client';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('McpAgentClient', () => {
  let client: McpAgentClient;

  beforeEach(() => {
    client = new McpAgentClient();
    jest.clearAllMocks();
  });

  it('should call decompose-epic and return response on success', async () => {
    const mockData = {
      epicTitle: 'Test Epic',
      stories: [
        {
          title: 'Story 1',
          description: 'Desc',
          type: 'STORY',
          estimatedStoryPoints: 3,
          acceptanceCriteriaGherkin: 'Given... When... Then...',
        },
      ],
    };
    mockedAxios.post.mockResolvedValueOnce({ data: mockData });

    const result = await client.decomposeEpic({ epicTitle: 'Test Epic' });
    expect(result.epicTitle).toBe('Test Epic');
    expect(result.stories.length).toBe(1);
  });

  it('should fallback gracefully when decompose-epic fails', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

    const result = await client.decomposeEpic({ epicTitle: 'Fallback Epic' });
    expect(result.epicTitle).toBe('Fallback Epic');
    expect(result.stories.length).toBeGreaterThanOrEqual(3);
  });

  it('should call plan-sprint and return response on success', async () => {
    const mockPlan = {
      sprintGoal: 'Goal',
      allocatedStoryPoints: 15,
      recommendedIssueIds: ['iss-1'],
      riskAssessment: 'LOW_RISK',
    };
    mockedAxios.post.mockResolvedValueOnce({ data: mockPlan });

    const result = await client.planSprint({
      sprintGoal: 'Goal',
      teamCapacityStoryPoints: 20,
    });
    expect(result.allocatedStoryPoints).toBe(15);
  });

  it('should fallback gracefully when plan-sprint fails', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

    const result = await client.planSprint({
      sprintGoal: 'Goal',
      teamCapacityStoryPoints: 20,
      candidateIssues: [{ id: 'iss-1', storyPoints: 5 }],
    });
    expect(result.allocatedStoryPoints).toBe(5);
    expect(result.recommendedIssueIds).toContain('iss-1');
  });

  it('should call diagnose-metrics and return response on success', async () => {
    const mockDiag = {
      sprintId: 'sprint-1',
      healthStatus: 'HEALTHY',
      summary: 'OK',
      rootCauses: [],
      recommendations: [],
    };
    mockedAxios.post.mockResolvedValueOnce({ data: mockDiag });

    const result = await client.diagnoseMetrics({ sprintId: 'sprint-1' });
    expect(result.healthStatus).toBe('HEALTHY');
  });

  it('should fallback gracefully when diagnose-metrics fails', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

    const result = await client.diagnoseMetrics({ sprintId: 'sprint-1', blockedIssuesCount: 3 });
    expect(result.healthStatus).toBe('AT_RISK');
    expect(result.rootCauses.length).toBeGreaterThan(0);
  });
});
