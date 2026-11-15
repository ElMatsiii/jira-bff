import { Resolver, Mutation, Args, Context } from '@nestjs/graphql';
import { BadRequestException, InternalServerErrorException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { McpAgentClient } from '../../mcp/mcp-agent.client';
import { IssuesGrpcClient } from '../../grpc/issues-grpc.client';
import { SprintsGrpcClient } from '../../grpc/sprints-grpc.client';
import { KafkaAnalyticsClient } from '../../kafka/kafka-analytics.client';
import { AiDecompositionModel, AiSprintPlanModel, AiDiagnosisModel, AiStoryImprovementModel, AiBreakdownTaskModel } from '../models/ai.model';
import { DecomposeEpicInput, PlanSprintInput, DiagnoseMetricsInput, ImproveStoryInput, BreakdownTaskInput } from '../dto/ai.inputs';
import { GqlAuthGuard } from '../../identity/gql-auth.guard';
import { IdentityService } from '../../identity/identity.service';
import { UserModel } from '../../identity/identity.models';

const AI_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

/** Maps the agent's suggested priority to the GraphQL value, defaulting to MEDIUM when missing or unknown. */
export function normalizeAiPriority(value: unknown): string {
  const upper = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return (AI_PRIORITIES as readonly string[]).includes(upper) ? upper : 'MEDIUM';
}

/** Converts MS1's proto IssuePriority number (1..4) to the name the agent expects; unknown → MEDIUM. */
export function protoPriorityToName(value: unknown): string {
  const byNumber: Record<number, string> = { 1: 'LOW', 2: 'MEDIUM', 3: 'HIGH', 4: 'CRITICAL' };
  return typeof value === 'number' ? byNumber[value] ?? 'MEDIUM' : normalizeAiPriority(value);
}

@Resolver()
@UseGuards(GqlAuthGuard)
export class AiResolver {
  constructor(
    private readonly mcpClient: McpAgentClient,
    private readonly issuesClient: IssuesGrpcClient,
    private readonly sprintsClient: SprintsGrpcClient,
    private readonly identity: IdentityService,
    private readonly analyticsClient: KafkaAnalyticsClient,
  ) {}

  @Mutation(() => AiDecompositionModel, { name: 'aiDecomposeEpic' })
  async aiDecomposeEpic(
    @Args('input') input: DecomposeEpicInput,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<AiDecompositionModel> {
    await this.identity.assertProjectAccess(request.user.id, input.projectId);
    const res = await this.mcpClient.decomposeEpic({
      epicTitle: input.epicTitle,
      epicDescription: input.epicDescription,
      projectKey: input.projectKey,
    });

    return {
      epicTitle: res.epicTitle,
      stories: (res.stories || []).map((s) => ({
        title: s.title,
        description: s.description || '',
        type: s.type || 'STORY',
        priority: normalizeAiPriority(s.priority),
        estimatedStoryPoints: s.estimatedStoryPoints || 3,
        acceptanceCriteriaGherkin: s.acceptanceCriteriaGherkin || '',
      })),
    };
  }

  @Mutation(() => AiSprintPlanModel, { name: 'aiPlanSprint' })
  async aiPlanSprint(
    @Args('input') input: PlanSprintInput,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<AiSprintPlanModel> {
    await this.identity.assertProjectAccess(request.user.id, input.projectId);
    let candidateIssues: { id: string; title: string; storyPoints: number; priority: string }[] = [];
    if (input.candidateIssueIds && input.candidateIssueIds.length > 0) {
      const issuePromises = input.candidateIssueIds.map((id) =>
        this.issuesClient.getIssue(id).catch(() => null),
      );
      const issues = await Promise.all(issuePromises);
      const requestedIssues = issues.filter((i) => i !== null);
      for (const issue of requestedIssues) {
        if (issue.projectId !== input.projectId) {
          throw new BadRequestException('Todas las historias deben pertenecer al proyecto seleccionado.');
        }
      }
      candidateIssues = requestedIssues
        .map((i) => ({
          id: i.id,
          title: i.title,
          storyPoints: i.storyPoints,
          // The agent validates priority as LOW | MEDIUM | HIGH | CRITICAL; MS1 sends the proto number.
          priority: protoPriorityToName(i.priority),
        }));
    }

    const res = await this.mcpClient.planSprint({
      sprintGoal: input.sprintGoal,
      teamCapacityStoryPoints: input.teamCapacityStoryPoints,
      candidateIssues,
    });

    return {
      // The agent does not echo the goal, and the GraphQL field is non-null.
      sprintGoal: res.sprintGoal || input.sprintGoal,
      allocatedStoryPoints: Number(res.allocatedStoryPoints) || 0,
      recommendedIssueIds: Array.isArray(res.recommendedIssueIds) ? res.recommendedIssueIds : [],
      riskAssessment: res.riskAssessment || 'MEDIUM',
    };
  }

  @Mutation(() => AiDiagnosisModel, { name: 'aiDiagnoseMetrics' })
  async aiDiagnoseMetrics(
    @Args('input') input: DiagnoseMetricsInput,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<AiDiagnosisModel> {
    const sprint = await this.sprintsClient.getSprint(input.sprintId);
    if (sprint.projectId !== input.projectId) {
      throw new BadRequestException('El sprint no pertenece al proyecto seleccionado.');
    }
    await this.identity.assertProjectAccess(request.user.id, input.projectId);
    const loggedHours = await this.identity.sprintLoggedHours(input.projectId, input.sprintId);
    const timeAlerts = loggedHours > 0
      ? [`El equipo registró ${loggedHours.toFixed(2)} horas de trabajo en este sprint. Esta cifra describe el tiempo cargado, no mide por sí sola productividad.`]
      : ['No hay horas de trabajo registradas todavía; no se puede evaluar el uso del tiempo con datos reales.'];

    // Real burndown from MS3 (Kafka request-reply), so the agent diagnoses with data.
    const analytics = await this.analyticsClient.getBurndownAnalytics(input.sprintId, input.projectId);
    const burndownData = analytics.burndownPoints.map((point) => ({
      day: point.day,
      ...(point.date ? { date: point.date } : {}),
      idealRemaining: point.idealRemaining,
      actualRemaining: point.actualRemaining,
    }));
    const dataAlerts = burndownData.length
      ? []
      : ['No hay datos de burndown disponibles desde el servicio de analítica; el diagnóstico se basa solo en bloqueos y horas registradas.'];

    const res = await this.mcpClient.diagnoseMetrics({
      sprintId: input.sprintId,
      sprintName: sprint.name,
      burndownData,
      blockedIssuesCount: input.blockedIssuesCount,
      alerts: [...dataAlerts, ...timeAlerts],
    });
    const summary = res.summary || res.diagnosis;
    const recommendations = res.recommendations || res.actionableRecommendations;
    if (!summary || !recommendations) {
      throw new InternalServerErrorException('El agente devolvió un diagnóstico incompleto.');
    }

    return {
      sprintId: input.sprintId,
      healthStatus: res.healthStatus,
      summary,
      rootCauses: res.rootCauses || [],
      recommendations,
    };
  }

  @Mutation(() => AiStoryImprovementModel, { name: 'aiImproveStory' })
  async aiImproveStory(
    @Args('input') input: ImproveStoryInput,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<AiStoryImprovementModel> {
    await this.identity.assertProjectAccess(request.user.id, input.projectId);
    const res = await this.mcpClient.improveStory({
      title: input.title,
      description: input.description,
      type: input.type || 'STORY',
    });

    // Map field by field: a missing value must become a clear error, not a GraphQL non-null violation.
    const storyPoints = Number(res?.storyPoints);
    const gherkin = typeof res?.acceptanceCriteriaGherkin === 'string' ? res.acceptanceCriteriaGherkin.trim() : '';
    if (!Number.isInteger(storyPoints) || storyPoints < 0 || !gherkin) {
      throw new InternalServerErrorException(
        'El agente de IA devolvió una propuesta incompleta (faltan los story points o los criterios de aceptación).',
      );
    }
    const confidence = Number(res.confidence);
    return {
      storyPoints,
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
      reasoning: typeof res.reasoning === 'string' ? res.reasoning : '',
      complexityFactors: Array.isArray(res.complexityFactors)
        ? res.complexityFactors.filter((factor): factor is string => typeof factor === 'string')
        : [],
      acceptanceCriteriaGherkin: gherkin,
    };
  }

  @Mutation(() => AiBreakdownTaskModel, { name: 'aiBreakdownTask' })
  async aiBreakdownTask(
    @Args('input') input: BreakdownTaskInput,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<AiBreakdownTaskModel> {
    await this.identity.assertProjectAccess(request.user.id, input.projectId);
    const res = await this.mcpClient.breakdownTask({
      title: input.title,
      description: input.description,
    });

    return {
      parentTitle: res.parentTitle || input.title,
      subtasks: (res.subtasks || []).map((st) => ({
        title: st.title,
        description: st.description || '',
        type: st.type || 'TASK',
        priority: normalizeAiPriority(st.priority),
        estimatedStoryPoints: st.estimatedStoryPoints || 3,
        acceptanceCriteriaGherkin: st.acceptanceCriteriaGherkin || '',
      })),
    };
  }
}
