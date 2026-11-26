import { Resolver, Query, Mutation, Args, ID, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { SprintsGrpcClient } from '../../grpc/sprints-grpc.client';
import { SprintModel, SprintStatusEnum } from '../models/sprint.model';
import { CreateSprintInput } from '../dto/sprint.inputs';
import { CreateSprintRequest, Sprint } from 'jira-contracts/gen/ts';
import { GqlAuthGuard } from '../../identity/gql-auth.guard';
import { IdentityService } from '../../identity/identity.service';
import { UserModel } from '../../identity/identity.models';

@Resolver(() => SprintModel)
@UseGuards(GqlAuthGuard)
export class SprintsResolver {
  constructor(
    private readonly sprintsClient: SprintsGrpcClient,
    private readonly identity: IdentityService,
  ) {}

  @Query(() => SprintModel, { name: 'getSprint' })
  async getSprint(
    @Args('id', { type: () => ID }) id: string,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<SprintModel> {
    const sprint = await this.sprintsClient.getSprint(id);
    await this.identity.assertProjectAccess(request.user.id, sprint.projectId);
    return this.mapToModel(sprint);
  }

  @Query(() => [SprintModel], { name: 'listSprints' })
  async listSprints(
    @Args('projectId') projectId: string,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<SprintModel[]> {
    await this.identity.assertProjectAccess(request.user.id, projectId);
    const sprints = await this.sprintsClient.listSprints(projectId);
    return (sprints || []).map((s) => this.mapToModel(s));
  }

  @Mutation(() => SprintModel, { name: 'createSprint' })
  async createSprint(
    @Args('input') input: CreateSprintInput,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<SprintModel> {
    await this.identity.assertSprintManagementAccess(request.user.id, input.projectId);
    const req: CreateSprintRequest = {
      projectId: input.projectId,
      name: input.name,
      goal: input.goal || '',
      startDate: input.startDate ? new Date(input.startDate).getTime() : Date.now(),
      endDate: input.endDate ? new Date(input.endDate).getTime() : Date.now() + 14 * 86400000,
      capacityStoryPoints: input.capacityStoryPoints || 0,
    };
    const sprint = await this.sprintsClient.createSprint(req);
    return this.mapToModel(sprint);
  }

  @Mutation(() => SprintModel, { name: 'startSprint' })
  async startSprint(
    @Args('id', { type: () => ID }) id: string,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<SprintModel> {
    const current = await this.sprintsClient.getSprint(id);
    await this.identity.assertSprintManagementAccess(request.user.id, current.projectId);
    const sprint = await this.sprintsClient.startSprint(id);
    return this.mapToModel(sprint);
  }

  @Mutation(() => SprintModel, { name: 'completeSprint' })
  async completeSprint(
    @Args('id', { type: () => ID }) id: string,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<SprintModel> {
    const current = await this.sprintsClient.getSprint(id);
    await this.identity.assertSprintManagementAccess(request.user.id, current.projectId);
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
      capacityStoryPoints: sprint.capacityStoryPoints || 0,
    };
  }
}
