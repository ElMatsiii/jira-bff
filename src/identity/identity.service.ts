import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { Project, ProjectMember, User, WorkLog, Workspace, WorkspaceRole } from 'jira-contracts/gen/ts';
import { IdentityGrpcClient } from '../grpc/identity-grpc.client';
import { LogWorkInput, ProjectMemberModel, ProjectModel, UserModel, WorkLogModel, WorkspaceModel } from './identity.models';
import { Ms1Operation, translateMs1Error } from './ms1-errors';

interface TokenClaims {
  sub: string;
  email: string;
  exp: number;
}

/** WorkspaceRole (MS1) → the role names GraphQL already exposed. */
export function roleName(role: WorkspaceRole | undefined): string {
  switch (role) {
    case WorkspaceRole.WORKSPACE_ROLE_OWNER:
      return 'OWNER';
    case WorkspaceRole.WORKSPACE_ROLE_ADMIN:
      return 'ADMIN';
    case WorkspaceRole.WORKSPACE_ROLE_MEMBER:
      return 'MEMBER';
    default:
      return 'NONE';
  }
}

export const toUserModel = (user: User): UserModel => ({ id: user.id, name: user.name, email: user.email });

export const toWorkspaceModel = (workspace: Workspace): WorkspaceModel => ({
  id: workspace.id,
  name: workspace.name,
  role: roleName(workspace.role),
});

export const toProjectModel = (project: Project): ProjectModel => ({
  id: project.id,
  workspaceId: project.workspaceId,
  name: project.name,
  key: project.key,
  description: project.description,
});

export const toProjectMemberModel = (member: ProjectMember): ProjectMemberModel => ({
  id: member.user?.id ?? '',
  name: member.user?.name ?? '',
  email: member.user?.email ?? '',
  role: roleName(member.role),
  invited: member.invited,
});

export const toWorkLogModel =(log: WorkLog): WorkLogModel => ({
  id: log.id,
  issueId: log.issueId,
  issueKey: log.issueKey,
  issueTitle: log.issueTitle,
  userName: log.userName,
  hours: log.hours,
  note: log.note,
  loggedAt: new Date(log.loggedAt).toISOString(),
});

/**
 * Users, workspaces, projects and hours live in MS1 (gRPC). The BFF only issues and verifies the
 * JWT, and translates MS1's errors into Spanish messages for the web.
 */
@Injectable()
export class IdentityService {
  private readonly secret =
    process.env.JWT_SECRET || 'local-development-secret-change-before-deploy';

  constructor(private readonly ms1: IdentityGrpcClient) {}

  /** Runs a call to MS1 and converts its errors (see translateMs1Error). */
  private async ms1Call<T>(operation: Ms1Operation, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      throw translateMs1Error(err, operation);
    }
  }

  async register(name: string, email: string, password: string): Promise<{ token: string; user: UserModel }> {
    const { user } = await this.ms1Call('register', () => this.ms1.registerUser(name, email, password));
    const model = toUserModel(user);
    return { user: model, token: this.createToken(model) };
  }

  async login(email: string, password: string): Promise<{ token: string; user: UserModel }> {
    const user = toUserModel(await this.ms1Call('login', () => this.ms1.authenticateUser(email, password)));
    return { user, token: this.createToken(user) };
  }

  async authenticate(request: Request): Promise<UserModel> {
    const header = request.headers.authorization || '';
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
    if (!match) throw new UnauthorizedException('Inicia sesión para continuar.');
    const claims = this.verifyToken(match[1]);
    return toUserModel(await this.ms1Call('session', () => this.ms1.getUser(claims.sub)));
  }

  async workspaces(userId: string): Promise<WorkspaceModel[]> {
    const workspaces = await this.ms1Call('workspace', () => this.ms1.listUserWorkspaces(userId));
    return workspaces.map(toWorkspaceModel);
  }

  /** MS1 checks that the user is a member of the workspace. */
  async projects(userId: string, workspaceId: string): Promise<ProjectModel[]> {
    const projects = await this.ms1Call('workspace', () => this.ms1.listProjects(userId, workspaceId));
    return projects.map(toProjectModel);
  }

  /** MS1 checks that the user is OWNER or ADMIN and validates name and key. */
  async createProject(
    userId: string,
    input: { workspaceId: string; name: string; key: string; description?: string },
  ): Promise<ProjectModel> {
    const project = await this.ms1Call('project', () =>
      this.ms1.createProject(userId, input.workspaceId, input.key, input.name, input.description || ''));
    return toProjectModel(project);
  }

  /** MS1 checks that the requester is OWNER or ADMIN; the member must already have an account. */
  async addMember(userId: string, workspaceId: string, email: string): Promise<UserModel> {
    const { member } = await this.ms1Call('addMember', () => this.ms1.addWorkspaceMember(userId, workspaceId, email));
    return toUserModel(member);
  }

  /** MS1 checks that the requester is OWNER or ADMIN; the person must already have an account. */
  async addProjectMember(userId: string, projectId: string, email: string): Promise<ProjectMemberModel> {
    return toProjectMemberModel(
      await this.ms1Call('projectMember', () => this.ms1.addProjectMember(userId, projectId, email)));
  }

  /** Everyone with access to the project: OWNER, ADMINs and invited members (MS1 checks access). */
  async projectMembers(userId: string, projectId: string): Promise<ProjectMemberModel[]> {
    const members = await this.ms1Call('projectMember', () => this.ms1.listProjectMembers(userId, projectId));
    return members.map(toProjectMemberModel);
  }

  /** MS1 checks that the requester is OWNER or ADMIN and refuses to remove the OWNER or an ADMIN. */
  async removeProjectMember(userId: string, projectId: string, memberUserId: string): Promise<boolean> {
    await this.ms1Call('projectMember', () => this.ms1.removeProjectMember(userId, projectId, memberUserId));
    return true;
  }

  async assertProjectAccess(userId: string, projectId: string): Promise<void> {
    const access = await this.ms1Call('project', () => this.ms1.checkProjectAccess(userId, projectId));
    if (!access.allowed) throw new ForbiddenException('No tienes acceso a este proyecto.');
  }

  async assertSprintManagementAccess(userId: string, projectId: string): Promise<void> {
    const access = await this.ms1Call('project', () => this.ms1.checkProjectAccess(userId, projectId));
    if (!access.allowed) throw new ForbiddenException('No tienes acceso a este proyecto.');
    const role = roleName(access.role);
    if (role !== 'OWNER' && role !== 'ADMIN') {
      throw new ForbiddenException('Solo el OWNER o un ADMIN del proyecto pueden gestionar los sprints.');
    }
  }

  /** MS1 checks project access and that the issue belongs to the project. */
  async logWork(userId: string, input: LogWorkInput): Promise<WorkLogModel> {
    const log = await this.ms1Call('workLog', () =>
      this.ms1.logWork(userId, input.projectId, input.issueId, input.hours, input.note || ''));
    return toWorkLogModel(log);
  }

  /** Latest 100 entries and the total of the whole project (MS1 checks access). */
  async workLogSummary(userId: string, projectId: string): Promise<{ totalHours: number; entries: WorkLogModel[] }> {
    const summary = await this.ms1Call('workLog', () => this.ms1.listWorkLogs(userId, projectId));
    return { totalHours: summary.totalHours || 0, entries: (summary.entries || []).map(toWorkLogModel) };
  }

  /** Latest 100 entries of one issue and its total (MS1 checks access and that the issue is in the project). */
  async issueWorkLogs(userId: string, projectId: string, issueId: string): Promise<{ totalHours: number; entries: WorkLogModel[] }> {
    const summary = await this.ms1Call('workLog', () => this.ms1.listWorkLogs(userId, projectId, 0, issueId));
    return { totalHours: summary.totalHours || 0, entries: (summary.entries || []).map(toWorkLogModel) };
  }

  /** Hours logged in a sprint. Callers must check project access first (MS1 does not ask for a requester). */
  sprintLoggedHours(projectId: string, sprintId: string): Promise<number> {
    return this.ms1Call('workLog', () => this.ms1.sumSprintHours(projectId, sprintId));
  }

  private createToken(user: UserModel): string {
    const now = Math.floor(Date.now() / 1000);
    const header = this.encode({ alg: 'HS256', typ: 'JWT' });
    const payload = this.encode({ sub: user.id, email: user.email, iat: now, exp: now + 12 * 60 * 60 });
    const content = `${header}.${payload}`;
    return `${content}.${this.signature(content)}`;
  }

  private verifyToken(token: string): TokenClaims {
    const [header, payload, signature, ...extra] = token.split('.');
    if (!header || !payload || !signature || extra.length || !this.safeEqual(signature, this.signature(`${header}.${payload}`))) {
      throw new UnauthorizedException('La sesión no es válida.');
    }
    try {
      const decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenClaims;
      if (decodedHeader.alg !== 'HS256' || typeof claims.sub !== 'string' || claims.exp <= Date.now() / 1000) {
        throw new Error('Invalid claims');
      }
      return claims;
    } catch {
      throw new UnauthorizedException('La sesión expiró o no es válida.');
    }
  }

  private encode(value: object): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  private signature(content: string): string {
    return createHmac('sha256', this.secret).update(content).digest('base64url');
  }

  private safeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
