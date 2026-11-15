import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { createInsecureGrpcCredentials } from 'jira-contracts';
import {
  CheckProjectAccessResponse,
  IdentityServiceClient,
  ListWorkLogsResponse,
  Project,
  ProjectMember,
  ProjectServiceClient,
  User,
  WorkLog,
  WorkLogServiceClient,
  Workspace,
  WorkspaceRole,
} from 'jira-contracts/gen/ts';

/** The three MS1 stubs this client talks to. Tests inject fakes with the same callback API. */
export interface Ms1IdentityStubs {
  identity: Pick<IdentityServiceClient, 'registerUser' | 'authenticateUser' | 'getUser' | 'listUserWorkspaces' | 'addWorkspaceMember'> & { close?: () => void };
  projects: Pick<
    ProjectServiceClient,
    'createProject' | 'listProjects' | 'checkProjectAccess' | 'addProjectMember' | 'listProjectMembers' | 'removeProjectMember'
  > & { close?: () => void };
  workLogs: Pick<WorkLogServiceClient, 'logWork' | 'listWorkLogs' | 'sumSprintHours'> & { close?: () => void };
}

type Callback<Res> = (err: any, res: Res) => void;

/**
 * gRPC client for MS1's IdentityService, ProjectService and WorkLogService (users, workspaces,
 * projects and hours live in MS1; the BFF has no database). Errors are returned as gRPC errors;
 * IdentityService translates them for GraphQL.
 */
@Injectable()
export class IdentityGrpcClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdentityGrpcClient.name);
  private stubs: Ms1IdentityStubs | null = null;

  constructor(
    @Optional() private readonly configService?: ConfigService,
    @Optional() customStubs?: Ms1IdentityStubs,
  ) {
    if (customStubs) this.stubs = customStubs;
  }

  onModuleInit() {
    if (this.stubs) return;
    const url = this.configService?.issuesGrpcUrl || 'localhost:50051';
    this.logger.log(`Connecting to MS1 identity, project and work-log services on ${url}`);
    const options = { 'grpc.keepalive_time_ms': 30000, 'grpc.keepalive_timeout_ms': 5000 };
    try {
      this.stubs = {
        identity: new IdentityServiceClient(url, createInsecureGrpcCredentials(), options),
        projects: new ProjectServiceClient(url, createInsecureGrpcCredentials(), options),
        workLogs: new WorkLogServiceClient(url, createInsecureGrpcCredentials(), options),
      };
    } catch (err: any) {
      this.logger.warn(`Failed to initialize MS1 identity clients: ${err.message}`);
    }
  }

  onModuleDestroy() {
    for (const stub of Object.values(this.stubs || {})) {
      try {
        stub?.close?.();
      } catch (err: any) {
        this.logger.warn(`Error closing MS1 identity client: ${err.message}`);
      }
    }
  }

  /** Promisifies one unary call on the selected stub. */
  private call<Res>(invoke: (stubs: Ms1IdentityStubs, done: Callback<Res>) => void): Promise<Res> {
    return new Promise((resolve, reject) => {
      if (!this.stubs) return reject(new Error('MS1 identity gRPC client not initialized'));
      invoke(this.stubs, (err, res) => (err ? reject(err) : resolve(res)));
    });
  }

  async registerUser(name: string, email: string, password: string): Promise<{ user: User; workspace: Workspace }> {
    const res = await this.call<any>((s, done) => s.identity.registerUser({ name, email, password }, done));
    return { user: res.user, workspace: res.workspace };
  }

  async authenticateUser(email: string, password: string): Promise<User> {
    const res = await this.call<any>((s, done) => s.identity.authenticateUser({ email, password }, done));
    return res.user;
  }

  async getUser(id: string): Promise<User> {
    const res = await this.call<any>((s, done) => s.identity.getUser({ id }, done));
    return res.user;
  }

  async listUserWorkspaces(userId: string): Promise<Workspace[]> {
    const res = await this.call<any>((s, done) => s.identity.listUserWorkspaces({ userId }, done));
    return res.workspaces || [];
  }

  async addWorkspaceMember(requesterId: string, workspaceId: string, memberEmail: string): Promise<{ member: User; role: WorkspaceRole }> {
    const res = await this.call<any>((s, done) => s.identity.addWorkspaceMember({ requesterId, workspaceId, memberEmail }, done));
    return { member: res.member, role: res.role };
  }

  async createProject(requesterId: string, workspaceId: string, key: string, name: string, description: string): Promise<Project> {
    const res = await this.call<any>((s, done) =>
      s.projects.createProject({ requesterId, workspaceId, key, name, description }, done));
    return res.project;
  }

  async listProjects(requesterId: string, workspaceId: string): Promise<Project[]> {
    const res = await this.call<any>((s, done) => s.projects.listProjects({ requesterId, workspaceId }, done));
    return res.projects || [];
  }

  checkProjectAccess(userId: string, projectId: string): Promise<CheckProjectAccessResponse> {
    return this.call<CheckProjectAccessResponse>((s, done) => s.projects.checkProjectAccess({ userId, projectId }, done));
  }

  async logWork(userId: string, projectId: string, issueId: string, hours: number, note: string): Promise<WorkLog> {
    const res = await this.call<any>((s, done) => s.workLogs.logWork({ userId, projectId, issueId, hours, note }, done));
    return res.workLog;
  }

  async addProjectMember(requesterId: string, projectId: string, memberEmail: string): Promise<ProjectMember> {
    const res = await this.call<any>((s, done) => s.projects.addProjectMember({ requesterId, projectId, memberEmail }, done));
    return res.member;
  }

  async listProjectMembers(requesterId: string, projectId: string): Promise<ProjectMember[]> {
    const res = await this.call<any>((s, done) => s.projects.listProjectMembers({ requesterId, projectId }, done));
    return res.members || [];
  }

  async removeProjectMember(requesterId: string, projectId: string, userId: string): Promise<void> {
    await this.call<any>((s, done) => s.projects.removeProjectMember({ requesterId, projectId, userId }, done));
  }

  /**
   * limit 0 = MS1's default (100 newest entries). Without issueId, entries and totalHours cover the
   * whole project; with it, only that issue.
   */
  listWorkLogs(requesterId: string, projectId: string, limit = 0, issueId = ''): Promise<ListWorkLogsResponse> {
    return this.call<ListWorkLogsResponse>((s, done) =>
      s.workLogs.listWorkLogs({ requesterId, projectId, limit, issueId }, done));
  }

  async sumSprintHours(projectId: string, sprintId: string): Promise<number> {
    const res = await this.call<any>((s, done) => s.workLogs.sumSprintHours({ projectId, sprintId }, done));
    return res.totalHours || 0;
  }
}
