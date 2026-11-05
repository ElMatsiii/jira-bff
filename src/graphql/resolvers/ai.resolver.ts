import { Resolver, Mutation, Args } from '@nestjs/graphql';
import { McpAgentClient } from '../../mcp/mcp-agent.client';
import { IssuesGrpcClient } from '../../grpc/issues-grpc.client';
import { AiDecompositionModel, AiSprintPlanModel, AiDiagnosisModel } from '../models/ai.model';
import { DecomposeEpicInput, PlanSprintInput, DiagnoseMetricsInput } from '../dto/ai.inputs';

@Resolver()
export class AiResolver {
  constructor(
    private readonly mcpClient: McpAgentClient,
    private readonly issuesClient: IssuesGrpcClient,
  ) {}

  @Mutation(() => AiDecompositionModel, { name: 'aiDecomposeEpic' })
  async aiDecomposeEpic(@Args('input') input: DecomposeEpicInput): Promise<AiDecompositionModel> {
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
  async aiPlanSprint(@Args('input') input: PlanSprintInput): Promise<AiSprintPlanModel> {
    let candidateIssues: any[] = [];
    if (input.candidateIssueIds && input.candidateIssueIds.length > 0) {
      const issuePromises = input.candidateIssueIds.map((id) =>
        this.issuesClient.getIssue(id).catch(() => null),
      );
      const issues = await Promise.all(issuePromises);
      candidateIssues = issues
        .filter((i) => i !== null)
        .map((i) => ({
          id: i.id,
          title: i.title,
          storyPoints: i.story_points,
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
  async aiDiagnoseMetrics(@Args('input') input: DiagnoseMetricsInput): Promise<AiDiagnosisModel> {
    const res = await this.mcpClient.diagnoseMetrics({
      sprintId: input.sprintId,
      blockedIssuesCount: input.blockedIssuesCount,
    });

    return {
      sprintId: res.sprintId,
      healthStatus: res.healthStatus,
      summary: res.summary,
      rootCauses: res.rootCauses || [],
      recommendations: res.recommendations || [],
    };
  }
}
