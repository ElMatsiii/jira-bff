import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Request } from 'express';
import {
  AddWorkspaceMemberInput,
  AuthPayload,
  CreateProjectInput,
  LogWorkInput,
  LoginInput,
  ProjectModel,
  RegisterInput,
  UserModel,
  WorkspaceModel,
  WorkLogSummaryModel,
  WorkLogModel,
} from './identity.models';
import { IdentityService } from './identity.service';

type AuthenticatedRequest = Request & { user?: UserModel };

@Resolver()
export class IdentityResolver {
  constructor(private readonly identity: IdentityService) {}

  @Mutation(() => AuthPayload)
  register(@Args('input') input: RegisterInput): Promise<AuthPayload> {
    return this.identity.register(input.name, input.email, input.password);
  }

  @Mutation(() => AuthPayload)
  login(@Args('input') input: LoginInput): Promise<AuthPayload> {
    return this.identity.login(input.email, input.password);
  }

  @Query(() => UserModel)
  async me(@Context('req') request: AuthenticatedRequest): Promise<UserModel> {
    return this.identity.authenticate(request);
  }

  @Query(() => [WorkspaceModel])
  async myWorkspaces(@Context('req') request: AuthenticatedRequest): Promise<WorkspaceModel[]> {
    const user = await this.identity.authenticate(request);
    return this.identity.workspaces(user.id);
  }

  @Query(() => [ProjectModel])
  async workspaceProjects(
    @Args('workspaceId') workspaceId: string,
    @Context('req') request: AuthenticatedRequest,
  ): Promise<ProjectModel[]> {
    const user = await this.identity.authenticate(request);
    return this.identity.projects(user.id, workspaceId);
  }

  @Mutation(() => ProjectModel)
  async createProject(
    @Args('input') input: CreateProjectInput,
    @Context('req') request: AuthenticatedRequest,
  ): Promise<ProjectModel> {
    const user = await this.identity.authenticate(request);
    return this.identity.createProject(user.id, input);
  }

  @Mutation(() => UserModel)
  async addWorkspaceMember(
    @Args('input') input: AddWorkspaceMemberInput,
    @Context('req') request: AuthenticatedRequest,
  ): Promise<UserModel> {
    const user = await this.identity.authenticate(request);
    return this.identity.addMember(user.id, input.workspaceId, input.email);
  }

  @Query(() => WorkLogSummaryModel)
  async projectWorkLogs(
    @Args('projectId') projectId: string,
    @Context('req') request: AuthenticatedRequest,
  ): Promise<{ totalHours: number; entries: WorkLogModel[] }> {
    const user = await this.identity.authenticate(request);
    return this.identity.workLogSummary(user.id, projectId);
  }

  @Mutation(() => WorkLogModel)
  async logWork(
    @Args('input') input: LogWorkInput,
    @Context('req') request: AuthenticatedRequest,
  ): Promise<WorkLogModel> {
    const user = await this.identity.authenticate(request);
    return this.identity.logWork(user.id, input);
  }
}
