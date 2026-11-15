import { McpAgentClient, toAgentError } from '../src/mcp/mcp-agent.client';
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
      candidateIssues: [{ id: 'iss-1', title: 'Issue', storyPoints: 5, priority: 'MEDIUM' }],
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

  it('should call improve-story with a 15 s timeout', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { storyPoints: 3, acceptanceCriteriaGherkin: 'Feature: X' } });

    const result = await client.improveStory({ title: 'Login', type: 'STORY' });

    expect(result.storyPoints).toBe(3);
    expect(mockedAxios.post).toHaveBeenCalledWith('http://localhost:3000/agent/improve-story', { title: 'Login', type: 'STORY' }, { timeout: 15000 });
  });

  it('turns an agent 422 into a readable BadRequest with the agent message', async () => {
    mockedAxios.post.mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Request failed with status code 422',
      response: { status: 422, data: { error: 'title is required' } },
    });

    await expect(client.improveStory({ title: '', type: 'STORY' })).rejects.toMatchObject({
      message: 'El agente de IA rechazó la solicitud de mejora de historia (HTTP 422): title is required',
      status: 400,
    });
  });

  describe('toAgentError', () => {
    it('maps agent 5xx answers to Bad Gateway', () => {
      const error = toAgentError('planificación de sprint', { response: { status: 500, data: { error: 'boom' } } });
      expect(error.getStatus()).toBe(502);
      expect(error.message).toBe('El agente de IA falló al procesar planificación de sprint (HTTP 500): boom');
    });

    it('handles string bodies and bodies without message', () => {
      expect(toAgentError('x', { response: { status: 503, data: 'Service Unavailable' } }).message)
        .toBe('El agente de IA falló al procesar x (HTTP 503): Service Unavailable');
      expect(toAgentError('x', { response: { status: 404, data: {} } }).message)
        .toBe('El agente de IA rechazó la solicitud de x (HTTP 404).');
    });

    it('maps timeouts to Gateway Timeout', () => {
      const error = toAgentError('desglose de épica', { code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' });
      expect(error.getStatus()).toBe(504);
      expect(error.message).toBe('El agente de IA no respondió a tiempo en desglose de épica.');
      expect(toAgentError('x', { code: 'ETIMEDOUT' }).getStatus()).toBe(504);
    });

    it('maps connection failures to Service Unavailable keeping the cause', () => {
      const error = toAgentError('diagnóstico de métricas', { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:3000' });
      expect(error.getStatus()).toBe(503);
      expect(error.message).toBe('El agente de IA no está disponible para diagnóstico de métricas (connect ECONNREFUSED 127.0.0.1:3000).');
      expect(toAgentError('x', null).message).toBe('El agente de IA no está disponible para x.');
    });
  });
});
