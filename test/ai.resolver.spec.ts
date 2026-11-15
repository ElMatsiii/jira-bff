import { AiResolver, normalizeAiPriority, protoPriorityToName } from '../src/graphql/resolvers/ai.resolver';
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
  let mockAnalyticsClient: { getBurndownAnalytics: jest.Mock };

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
      breakdownTask: jest.fn().mockResolvedValue({
        parentTitle: 'Crear base de la web',
        subtasks: [
          {
            title: 'Crear frontend',
            description: 'Estructura inicial',
            type: 'TASK',
            priority: 'HIGH',
            estimatedStoryPoints: 3,
            acceptanceCriteriaGherkin: 'Given front When init Then ok',
          },
        ],
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

    mockSprintsClient = { getSprint: jest.fn().mockResolvedValue({ projectId: 'project-1', name: 'Sprint 1' }) };
    mockAnalyticsClient = {
      getBurndownAnalytics: jest.fn().mockResolvedValue({
        sprintId: 'sprint-1', velocity: 0, idealBurndown: [], actualBurndown: [], blockedCount: 0,
        healthStatus: 'UNAVAILABLE', burndownPoints: [],
      }),
    };
    mockIdentity = {
      assertProjectAccess: jest.fn().mockResolvedValue(undefined),
      sprintLoggedHours: jest.fn().mockResolvedValue(0),
    };
    resolver = new AiResolver(
      mockMcpClient as any,
      mockIssuesClient as any,
      mockSprintsClient as any,
      mockIdentity as unknown as IdentityService,
      mockAnalyticsClient as any,
    );
  });

  it('should decompose an epic using AI', async () => {
    const input = { projectId: 'project-1', epicTitle: 'Auth Epic', epicDescription: 'Desc' };
    const result = await resolver.aiDecomposeEpic(input, { user: { id: 'user-1' } } as any);
    expect(result.epicTitle).toBe('Auth Epic');
    expect(result.stories.length).toBe(1);
    expect(result.stories[0].title).toBe('OAuth2 login');
    expect(result.stories[0].priority).toBe('MEDIUM');
    expect(mockMcpClient.decomposeEpic).toHaveBeenCalledWith({
      epicTitle: 'Auth Epic',
      epicDescription: 'Desc',
      projectKey: undefined,
    });
  });

  it('passes the suggested priority of each decomposed story through to GraphQL', async () => {
    (mockMcpClient.decomposeEpic as jest.Mock).mockResolvedValueOnce({
      epicTitle: 'Pagos',
      stories: [
        { title: 'Pasarela', description: 'd', type: 'STORY', priority: 'CRITICAL', estimatedStoryPoints: 8, acceptanceCriteriaGherkin: 'g' },
        { title: 'Formulario', description: 'd', type: 'STORY', priority: 'high', estimatedStoryPoints: 3, acceptanceCriteriaGherkin: 'g' },
        { title: 'Reintentos', description: 'd', type: 'TASK', priority: ' LOW ', estimatedStoryPoints: 2, acceptanceCriteriaGherkin: 'g' },
        { title: 'Sin prioridad', description: 'd', type: 'TASK', estimatedStoryPoints: 1, acceptanceCriteriaGherkin: 'g' },
        { title: 'Prioridad inválida', description: 'd', type: 'BUG', priority: 'URGENT', estimatedStoryPoints: 1, acceptanceCriteriaGherkin: 'g' },
      ],
    });

    const result = await resolver.aiDecomposeEpic(
      { projectId: 'project-1', epicTitle: 'Pagos', projectKey: 'DEMO' },
      { user: { id: 'user-1' } } as any,
    );

    expect(result.stories.map((s) => s.priority)).toEqual(['CRITICAL', 'HIGH', 'LOW', 'MEDIUM', 'MEDIUM']);
  });

  it('normalizeAiPriority accepts only known priorities', () => {
    expect(normalizeAiPriority('critical')).toBe('CRITICAL');
    expect(normalizeAiPriority('MEDIUM')).toBe('MEDIUM');
    expect(normalizeAiPriority(3)).toBe('MEDIUM');
    expect(normalizeAiPriority(undefined)).toBe('MEDIUM');
    expect(normalizeAiPriority('')).toBe('MEDIUM');
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
      sprintName: 'Sprint 1',
      burndownData: [],
      blockedIssuesCount: 0,
      alerts: [
        'No hay datos de burndown disponibles desde el servicio de analítica; el diagnóstico se basa solo en bloqueos y horas registradas.',
        'No hay horas de trabajo registradas todavía; no se puede evaluar el uso del tiempo con datos reales.',
      ],
    });
  });

  it('sends the real MS3 burndown to the agent when analytics are available', async () => {
    (mockAnalyticsClient.getBurndownAnalytics as jest.Mock).mockResolvedValueOnce({
      sprintId: 'sprint-1', velocity: 18, idealBurndown: [20, 10], actualBurndown: [20, 15], blockedCount: 0,
      healthStatus: 'AT_RISK',
      burndownPoints: [
        { day: 0, date: '2026-11-16', idealRemaining: 20, actualRemaining: 20 },
        { day: 1, date: '', idealRemaining: 10, actualRemaining: 15 },
      ],
    });
    mockIdentity.sprintLoggedHours.mockResolvedValueOnce(6.5);

    await resolver.aiDiagnoseMetrics({ projectId: 'project-1', sprintId: 'sprint-1', blockedIssuesCount: 2 }, { user: { id: 'user-1' } } as any);

    expect(mockAnalyticsClient.getBurndownAnalytics).toHaveBeenCalledWith('sprint-1', 'project-1');
    expect(mockMcpClient.diagnoseMetrics).toHaveBeenCalledWith({
      sprintId: 'sprint-1',
      sprintName: 'Sprint 1',
      burndownData: [
        { day: 0, date: '2026-11-16', idealRemaining: 20, actualRemaining: 20 },
        { day: 1, idealRemaining: 10, actualRemaining: 15 },
      ],
      blockedIssuesCount: 2,
      alerts: [expect.stringContaining('registró 6.50 horas')],
    });
  });

  it('should breakdown prospective task into subtasks using AI', async () => {
    const input = {
      projectId: 'project-1',
      title: 'Crear base de la web',
      description: 'Estructura inicial',
    };
    const result = await resolver.aiBreakdownTask(input, { user: { id: 'user-1' } } as any);
    expect(result.parentTitle).toBe('Crear base de la web');
    expect(result.subtasks.length).toBe(1);
    expect(result.subtasks[0].title).toBe('Crear frontend');
    expect(mockMcpClient.breakdownTask).toHaveBeenCalledWith({
      title: 'Crear base de la web',
      description: 'Estructura inicial',
    });
  });

  it('normalizes subtask priorities from the agent', async () => {
    (mockMcpClient.breakdownTask as jest.Mock).mockResolvedValueOnce({
      parentTitle: 'Web',
      subtasks: [
        { title: 'a', description: 'd', type: 'TASK', priority: 'high', estimatedStoryPoints: 3 },
        { title: 'b', description: 'd', type: 'TASK', priority: 'URGENT', estimatedStoryPoints: 3 },
      ],
    });
    const result = await resolver.aiBreakdownTask({ projectId: 'project-1', title: 'Web' }, { user: { id: 'user-1' } } as any);
    expect(result.subtasks.map((s) => s.priority)).toEqual(['HIGH', 'MEDIUM']);
  });

  describe('aiPlanSprint alignment with the agent', () => {
    it('sends candidate priorities as names and falls back to the requested sprintGoal', async () => {
      (mockMcpClient.planSprint as jest.Mock).mockResolvedValueOnce({
        allocatedStoryPoints: 5,
        capacityUtilizationPercent: 50,
        recommendedIssueIds: ['issue-1'],
        riskAssessment: 'LOW',
        rationale: 'ok',
      });
      (mockIssuesClient.getIssue as jest.Mock).mockResolvedValueOnce({
        id: 'issue-1', title: 'Issue 1', storyPoints: 5, priority: 4, projectId: 'project-1',
      });

      const result = await resolver.aiPlanSprint(
        { projectId: 'project-1', sprintGoal: 'Entregar pagos', teamCapacityStoryPoints: 10, candidateIssueIds: ['issue-1'] },
        { user: { id: 'user-1' } } as any,
      );

      expect(mockMcpClient.planSprint).toHaveBeenCalledWith({
        sprintGoal: 'Entregar pagos',
        teamCapacityStoryPoints: 10,
        candidateIssues: [{ id: 'issue-1', title: 'Issue 1', storyPoints: 5, priority: 'CRITICAL' }],
      });
      expect(result).toEqual({
        sprintGoal: 'Entregar pagos',
        allocatedStoryPoints: 5,
        recommendedIssueIds: ['issue-1'],
        riskAssessment: 'LOW',
      });
    });

    it('fills safe defaults when the agent omits optional plan fields', async () => {
      (mockMcpClient.planSprint as jest.Mock).mockResolvedValueOnce({});
      const result = await resolver.aiPlanSprint(
        { projectId: 'project-1', sprintGoal: 'Meta', teamCapacityStoryPoints: 10 },
        { user: { id: 'user-1' } } as any,
      );
      expect(result).toEqual({ sprintGoal: 'Meta', allocatedStoryPoints: 0, recommendedIssueIds: [], riskAssessment: 'MEDIUM' });
    });

    it.each([
      [1, 'LOW'], [2, 'MEDIUM'], [3, 'HIGH'], [4, 'CRITICAL'], [0, 'MEDIUM'], [99, 'MEDIUM'], ['high', 'HIGH'], [undefined, 'MEDIUM'],
    ])('protoPriorityToName(%p) is %p', (value, expected) => {
      expect(protoPriorityToName(value)).toBe(expected);
    });
  });

  describe('aiImproveStory', () => {
    const input = { projectId: 'project-1', title: 'Login con Google', description: 'OAuth2', type: 'STORY' };
    const user = { user: { id: 'user-1' } } as any;

    beforeEach(() => {
      mockMcpClient.improveStory = jest.fn();
    });

    it('maps every field explicitly and passes the story type', async () => {
      (mockMcpClient.improveStory as jest.Mock).mockResolvedValueOnce({
        storyPoints: 5,
        confidence: 1.4,
        reasoning: 'OAuth estándar',
        complexityFactors: ['OAuth2', 7],
        acceptanceCriteriaGherkin: '  Feature: Login\n  Scenario: ok  ',
        extra: 'ignored',
      });

      const result = await resolver.aiImproveStory(input, user);

      expect(mockMcpClient.improveStory).toHaveBeenCalledWith({ title: 'Login con Google', description: 'OAuth2', type: 'STORY' });
      expect(result).toEqual({
        storyPoints: 5,
        confidence: 1,
        reasoning: 'OAuth estándar',
        complexityFactors: ['OAuth2'],
        acceptanceCriteriaGherkin: 'Feature: Login\n  Scenario: ok',
      });
    });

    it('fails with a clear message when the agent omits acceptanceCriteriaGherkin (the reported bug)', async () => {
      (mockMcpClient.improveStory as jest.Mock).mockResolvedValueOnce({
        storyPoints: 3, confidence: 0.9, reasoning: 'r', complexityFactors: [],
      });
      await expect(resolver.aiImproveStory(input, user)).rejects.toThrow('propuesta incompleta');
    });

    it('fails with a clear message when story points are not an integer', async () => {
      (mockMcpClient.improveStory as jest.Mock).mockResolvedValueOnce({
        storyPoints: 'muchos', acceptanceCriteriaGherkin: 'Feature: X',
      });
      await expect(resolver.aiImproveStory(input, user)).rejects.toThrow('propuesta incompleta');
    });

    it('defaults optional fields and the story type', async () => {
      (mockMcpClient.improveStory as jest.Mock).mockResolvedValueOnce({ storyPoints: 2, acceptanceCriteriaGherkin: 'Feature: X' });
      const result = await resolver.aiImproveStory({ projectId: 'project-1', title: 'X' }, user);
      expect(mockMcpClient.improveStory).toHaveBeenCalledWith({ title: 'X', description: undefined, type: 'STORY' });
      expect(result).toEqual({ storyPoints: 2, confidence: 0, reasoning: '', complexityFactors: [], acceptanceCriteriaGherkin: 'Feature: X' });
    });
  });
});
