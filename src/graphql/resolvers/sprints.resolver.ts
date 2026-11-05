import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { SprintsGrpcClient } from '../../grpc/sprints-grpc.client';
import { SprintModel, SprintStatusEnum } from '../models/sprint.model';
import { CreateSprintInput } from '../dto/sprint.inputs';
import { CreateSprintRequest, Sprint } from 'jira-contracts/gen/ts';

@Resolver(() => SprintModel)
export class SprintsResolver {
  constructor(private readonly sprintsClient: SprintsGrpcClient) {}

  @Query(() => SprintModel, { name: 'getSprint' })
  async getSprint(@Args('id', { type: () => ID }) id: string): Promise<SprintModel> {
    const sprint = await this.sprintsClient.getSprint(id);
    return this.mapToModel(sprint);
  }

  @Query(() => [SprintModel], { name: 'listSprints' })
  async listSprints(@Args('projectId') projectId: string): Promise<SprintModel[]> {
    const sprints = await this.sprintsClient.listSprints(projectId);
    return (sprints || []).map((s) => this.mapToModel(s));
  }

  @Mutation(() => SprintModel, { name: 'createSprint' })
  async createSprint(@Args('input') input: CreateSprintInput): Promise<SprintModel> {
    const req: CreateSprintRequest = {
      projectId: input.projectId,
      name: input.name,
      goal: input.goal || '',
      startDate: input.startDate ? new Date(input.startDate).getTime() : Date.now(),
      endDate: input.endDate ? new Date(input.endDate).getTime() : Date.now() + 14 * 86400000,
    };
    const sprint = await this.sprintsClient.createSprint(req);
    return this.mapToModel(sprint);
  }

  @Mutation(() => SprintModel, { name: 'startSprint' })
  async startSprint(@Args('id', { type: () => ID }) id: string): Promise<SprintModel> {
    const sprint = await this.sprintsClient.startSprint(id);
    return this.mapToModel(sprint);
  }

  @Mutation(() => SprintModel, { name: 'completeSprint' })
  async completeSprint(@Args('id', { type: () => ID }) id: string): Promise<SprintModel> {
    const sprint = await this.sprintsClient.completeSprint(id);
    return this.mapToModel(sprint);
  }

  private mapToModel(sprint: Sprint): SprintModel {
    return {
      id: sprint.id,
      projectId: sprint.projectId || '',
      name: sprint.name || '',
      goal: sprint.goal || '',
      startDate: sprint.startDate ? new Date(Number(sprint.startDate)).toISOString() : new Date().toISOString(),
      endDate: sprint.endDate ? new Date(Number(sprint.endDate)).toISOString() : new Date().toISOString(),
      status: (sprint.status as unknown) as SprintStatusEnum,
      totalStoryPoints: sprint.totalStoryPoints || 0,
      completedStoryPoints: sprint.completedStoryPoints || 0,
    };
  }
}
