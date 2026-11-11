import { Resolver, Mutation, Args, Context } from '@nestjs/graphql';
import { BadRequestException, InternalServerErrorException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { McpAgentClient } from '../../mcp/mcp-agent.client';
import { IssuesGrpcClient } from '../../grpc/issues-grpc.client';
import { SprintsGrpcClient } from '../../grpc/sprints-grpc.client';
import { AiDecompositionModel, AiSprintPlanModel, AiDiagnosisModel, AiStoryImprovementModel } from '../models/ai.model';
import { DecomposeEpicInput, PlanSprintInput, DiagnoseMetricsInput, ImproveStoryInput } from '../dto/ai.inputs';
import { GqlAuthGuard } from '../../identity/gql-auth.guard';
import { IdentityService } from '../../identity/identity.service';
import { UserModel } from '../../identity/identity.models';

@Resolver()
@UseGuards(GqlAuthGuard)
export class AiResolver {
  constructor(
    private readonly mcpClient: McpAgentClient,
    private readonly issuesClient: IssuesGrpcClient,
    private readonly sprintsClient: SprintsGrpcClient,
    private readonly identity: IdentityService,
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
    let candidateIssues: { id: string; title: string; storyPoints: number; priority: number }[] = [];
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
          priority: i.priority,
        }));
    }

    const res = await this.mcpClient.planSprint({
      sprintGoal: input.sprintGoal,
      teamCapacityStoryPoints: input.teamCapacityStoryPoints,
      candidateIssues,
    });

    return {
      sprintGoal: res.sprintGoal,
      allocatedStoryPoints: res.allocatedStoryPoints,
      recommendedIssueIds: res.recommendedIssueIds,
      riskAssessment: res.riskAssessment,
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
    const res = await this.mcpClient.diagnoseMetrics({
      sprintId: input.sprintId,
      blockedIssuesCount: input.blockedIssuesCount,
      alerts: timeAlerts,
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
    return this.mcpClient.improveStory({
      title: input.title,
      description: input.description,
      type: input.type || 'STORY',
    });
  }
}
