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

  it('should report the failure when decompose-epic is unavailable', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

    await expect(client.decomposeEpic({ epicTitle: 'Unavailable Epic' })).rejects.toThrow('Network error');
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

  it('should report the failure when plan-sprint is unavailable', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

    await expect(client.planSprint({
      sprintGoal: 'Goal',
      teamCapacityStoryPoints: 20,
      candidateIssues: [{ id: 'iss-1', title: 'Issue', storyPoints: 5, priority: 2 }],
    })).rejects.toThrow('Network error');
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

  it('should report the failure when diagnose-metrics is unavailable', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

    await expect(client.diagnoseMetrics({ sprintId: 'sprint-1', blockedIssuesCount: 3 })).rejects.toThrow('Network error');
  });

  it('should call breakdown-task and return response on success', async () => {
    const mockBreakdown = {
      parentTitle: 'Crear base web',
      subtasks: [
        {
          title: 'Crear frontend',
          description: 'Estructura inicial',
          type: 'TASK',
          priority: 'HIGH',
          estimatedStoryPoints: 3,
        },
      ],
    };
    mockedAxios.post.mockResolvedValueOnce({ data: mockBreakdown });

    const result = await client.breakdownTask({ title: 'Crear base web' });
    expect(result.parentTitle).toBe('Crear base web');
    expect(result.subtasks.length).toBe(1);
  });
});
