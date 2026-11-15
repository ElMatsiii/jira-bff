import { ConflictException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { WorkspaceRole } from 'jira-contracts/gen/ts';
import { IdentityGrpcClient } from '../src/grpc/identity-grpc.client';
import { IdentityService, roleName } from '../src/identity/identity.service';

const grpcError = (code: number, details: string) => Object.assign(new Error(`${code} ${details}`), { code, details });

const ana = { id: 'user-1', name: 'Ana', email: 'ana@example.com', createdAt: 1 };

/** IdentityGrpcClient with every MS1 call mocked. */
function fakeMs1() {
  return {
    registerUser: jest.fn().mockResolvedValue({ user: ana, workspace: { id: 'ws-1', name: "Ana's workspace", role: 1, createdAt: 1 } }),
    authenticateUser: jest.fn().mockResolvedValue(ana),
    getUser: jest.fn().mockResolvedValue(ana),
    listUserWorkspaces: jest.fn().mockResolvedValue([]),
    addWorkspaceMember: jest.fn(),
    createProject: jest.fn(),
    listProjects: jest.fn().mockResolvedValue([]),
    checkProjectAccess: jest.fn().mockResolvedValue({ allowed: true, role: 3, workspaceId: 'ws-1' }),
    addProjectMember: jest.fn(),
    listProjectMembers: jest.fn(),
    removeProjectMember: jest.fn().mockResolvedValue(undefined),
    logWork: jest.fn(),
    listWorkLogs: jest.fn(),
    sumSprintHours: jest.fn().mockResolvedValue(0),
  };
}

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as any;

describe('IdentityService (MS1 over gRPC)', () => {
  let ms1: ReturnType<typeof fakeMs1>;
  let service: IdentityService;

  beforeEach(() => {
    ms1 = fakeMs1();
    service = new IdentityService(ms1 as unknown as IdentityGrpcClient);
  });

  describe('accounts and session', () => {
    it('registers in MS1 and returns a token the BFF can verify', async () => {
      const result = await service.register('Ana', 'ana@example.com', 'contraseña-larga');

      expect(ms1.registerUser).toHaveBeenCalledWith('Ana', 'ana@example.com', 'contraseña-larga');
      expect(result.user).toEqual({ id: 'user-1', name: 'Ana', email: 'ana@example.com' });
      await expect(service.authenticate(bearer(result.token))).resolves.toEqual(result.user);
      expect(ms1.getUser).toHaveBeenCalledWith('user-1');
    });

    it('translates a duplicated email', async () => {
      ms1.registerUser.mockRejectedValue(grpcError(6, 'an account with that email already exists'));
      await expect(service.register('Ana', 'ana@example.com', 'contraseña-larga'))
        .rejects.toThrow(new ConflictException('Ya existe una cuenta con ese email.'));
    });

    it('logs in with MS1 credentials and translates a wrong password', async () => {
      const result = await service.login('ana@example.com', 'contraseña-larga');
      expect(result.user.id).toBe('user-1');
      expect(result.token.split('.')).toHaveLength(3);

      ms1.authenticateUser.mockRejectedValue(grpcError(16, 'invalid email or password'));
      await expect(service.login('ana@example.com', 'mala')).rejects.toThrow(new UnauthorizedException('Email o contraseña incorrectos.'));
    });

    it('rejects missing, malformed, tampered and expired tokens without calling MS1', async () => {
      const { token } = await service.login('ana@example.com', 'contraseña-larga');
      const [header, payload, signature] = token.split('.');
      const expiredPayload = Buffer.from(JSON.stringify({ sub: 'user-1', email: 'x', exp: 1 })).toString('base64url');
      const expired = `${header}.${expiredPayload}.${(service as any).signature(`${header}.${expiredPayload}`)}`;
      ms1.getUser.mockClear();

      await expect(service.authenticate({ headers: {} } as any)).rejects.toThrow('Inicia sesión para continuar.');
      await expect(service.authenticate(bearer(`${header}.${payload}`))).rejects.toThrow('La sesión no es válida.');
      await expect(service.authenticate(bearer(`${header}.${payload}.${signature}x`))).rejects.toThrow('La sesión no es válida.');
      await expect(service.authenticate(bearer(expired))).rejects.toThrow('La sesión expiró o no es válida.');
      expect(ms1.getUser).not.toHaveBeenCalled();
    });

    it('rejects a valid token whose account no longer exists in MS1', async () => {
      const { token } = await service.login('ana@example.com', 'contraseña-larga');
      ms1.getUser.mockRejectedValue(grpcError(5, 'user not found'));
      await expect(service.authenticate(bearer(token))).rejects.toThrow(new UnauthorizedException('La cuenta ya no está disponible.'));
    });

    it('reports MS1 being down as unavailable', async () => {
      ms1.authenticateUser.mockRejectedValue(grpcError(14, 'No connection established'));
      await expect(service.login('ana@example.com', 'x')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('workspaces, members and projects', () => {
    it('lists workspaces with their role names', async () => {
      ms1.listUserWorkspaces.mockResolvedValue([
        { id: 'ws-1', name: 'Mío', role: WorkspaceRole.WORKSPACE_ROLE_OWNER, createdAt: 1 },
        { id: 'ws-2', name: 'Equipo', role: WorkspaceRole.WORKSPACE_ROLE_MEMBER, createdAt: 2 },
      ]);
      await expect(service.workspaces('user-1')).resolves.toEqual([
        { id: 'ws-1', name: 'Mío', role: 'OWNER' },
        { id: 'ws-2', name: 'Equipo', role: 'MEMBER' },
      ]);
      expect(roleName(WorkspaceRole.WORKSPACE_ROLE_ADMIN)).toBe('ADMIN');
      expect(roleName(WorkspaceRole.WORKSPACE_ROLE_UNSPECIFIED)).toBe('NONE');
    });

    it('lists and creates projects through MS1, which checks the role', async () => {
      const project = { id: 'p-1', workspaceId: 'ws-1', key: 'WEB', name: 'Portal', description: '', createdAt: 1 };
      ms1.listProjects.mockResolvedValue([project]);
      ms1.createProject.mockResolvedValue(project);

      await expect(service.projects('user-1', 'ws-1')).resolves.toEqual([
        { id: 'p-1', workspaceId: 'ws-1', key: 'WEB', name: 'Portal', description: '' },
      ]);
      await service.createProject('user-1', { workspaceId: 'ws-1', name: 'Portal', key: 'web' });
      expect(ms1.createProject).toHaveBeenCalledWith('user-1', 'ws-1', 'web', 'Portal', '');

      ms1.createProject.mockRejectedValue(grpcError(7, 'not allowed in this workspace'));
      await expect(service.createProject('user-2', { workspaceId: 'ws-1', name: 'X', key: 'XX' }))
        .rejects.toThrow(new ForbiddenException('No tienes permisos suficientes en este espacio de trabajo.'));
      ms1.createProject.mockRejectedValue(grpcError(6, 'project key already in use'));
      await expect(service.createProject('user-1', { workspaceId: 'ws-1', name: 'X', key: 'WEB' }))
        .rejects.toThrow('Esa clave de proyecto ya está en uso.');
    });

    it('adds members and explains when the person has no account', async () => {
      ms1.addWorkspaceMember.mockResolvedValue({ member: { ...ana, id: 'user-2' }, role: 3 });
      await expect(service.addMember('user-1', 'ws-1', 'ana@example.com')).resolves.toEqual({ id: 'user-2', name: 'Ana', email: 'ana@example.com' });

      ms1.addWorkspaceMember.mockRejectedValue(grpcError(5, 'user not found'));
      await expect(service.addMember('user-1', 'ws-1', 'nadie@example.com'))
        .rejects.toThrow('El usuario debe crear una cuenta antes de que puedas agregarlo.');
    });

    it('invites to a project and translates who may not manage members', async () => {
      ms1.addProjectMember.mockResolvedValue({ user: { ...ana, id: 'user-2' }, role: WorkspaceRole.WORKSPACE_ROLE_MEMBER, invited: true });
      await expect(service.addProjectMember('user-1', 'p-1', 'ana@example.com')).resolves.toEqual({
        id: 'user-2', name: 'Ana', email: 'ana@example.com', role: 'MEMBER', invited: true,
      });
      expect(ms1.addProjectMember).toHaveBeenCalledWith('user-1', 'p-1', 'ana@example.com');

      ms1.addProjectMember.mockRejectedValue(grpcError(7, 'not allowed in this workspace'));
      await expect(service.addProjectMember('user-3', 'p-1', 'x@example.com'))
        .rejects.toThrow('Solo el OWNER o un ADMIN del espacio pueden gestionar los miembros del proyecto.');
      ms1.addProjectMember.mockRejectedValue(grpcError(5, 'user not found'));
      await expect(service.addProjectMember('user-1', 'p-1', 'nadie@example.com'))
        .rejects.toThrow('El usuario debe crear una cuenta antes de que puedas agregarlo.');
    });

    it('lists project members with their role names', async () => {
      ms1.listProjectMembers.mockResolvedValue([
        { user: ana, role: WorkspaceRole.WORKSPACE_ROLE_OWNER, invited: false },
        { role: WorkspaceRole.WORKSPACE_ROLE_MEMBER, invited: true },
      ]);
      await expect(service.projectMembers('user-1', 'p-1')).resolves.toEqual([
        { id: 'user-1', name: 'Ana', email: 'ana@example.com', role: 'OWNER', invited: false },
        { id: '', name: '', email: '', role: 'MEMBER', invited: true },
      ]);

      ms1.listProjectMembers.mockRejectedValue(grpcError(7, 'no access to this project'));
      await expect(service.projectMembers('user-9', 'p-1')).rejects.toThrow('No tienes acceso a este proyecto.');
    });

    it('removes a member and explains why the OWNER or an unknown member cannot be removed', async () => {
      await expect(service.removeProjectMember('user-1', 'p-1', 'user-2')).resolves.toBe(true);
      expect(ms1.removeProjectMember).toHaveBeenCalledWith('user-1', 'p-1', 'user-2');

      ms1.removeProjectMember.mockRejectedValue(grpcError(9, 'the OWNER and ADMINs reach every project'));
      await expect(service.removeProjectMember('user-1', 'p-1', 'user-1')).rejects.toThrow(
        new ConflictException('El OWNER y los ADMIN del espacio acceden a todos sus proyectos, así que no se pueden quitar de uno.'));
      ms1.removeProjectMember.mockRejectedValue(grpcError(5, 'user is not a member of this project'));
      await expect(service.removeProjectMember('user-1', 'p-1', 'user-7')).rejects.toThrow('Esa persona no es miembro de este proyecto.');
    });

    it('checks project access in MS1', async () => {
      await expect(service.assertProjectAccess('user-1', 'p-1')).resolves.toBeUndefined();
      expect(ms1.checkProjectAccess).toHaveBeenCalledWith('user-1', 'p-1');

      ms1.checkProjectAccess.mockResolvedValue({ allowed: false, role: 0, workspaceId: '' });
      await expect(service.assertProjectAccess('user-9', 'p-1')).rejects.toThrow(new ForbiddenException('No tienes acceso a este proyecto.'));
    });
  });

  describe('work logs', () => {
    const log = {
      id: 'log-1', projectId: 'p-1', issueId: 'i-1', issueKey: 'WEB-1', issueTitle: 'Login', userId: 'user-1',
      userName: 'Ana', sprintId: 's-1', hours: 2.5, note: 'Pruebas', loggedAt: Date.UTC(2026, 0, 15, 12),
    };
    const model = {
      id: 'log-1', issueId: 'i-1', issueKey: 'WEB-1', issueTitle: 'Login', userName: 'Ana', hours: 2.5,
      note: 'Pruebas', loggedAt: '2026-01-15T12:00:00.000Z',
    };

    it('logs hours in MS1 (which picks the sprint of the issue)', async () => {
      ms1.logWork.mockResolvedValue(log);
      await expect(service.logWork('user-1', { projectId: 'p-1', issueId: 'i-1', hours: 2.5 })).resolves.toEqual(model);
      expect(ms1.logWork).toHaveBeenCalledWith('user-1', 'p-1', 'i-1', 2.5, '');

      ms1.logWork.mockRejectedValue(grpcError(3, 'validation error: invalid work log: hours must be between 0.01 and 24 per entry'));
      await expect(service.logWork('user-1', { projectId: 'p-1', issueId: 'i-1', hours: 30 }))
        .rejects.toThrow('Registra entre 0,01 y 24 horas por entrada.');
      ms1.logWork.mockRejectedValue(grpcError(5, 'issue not found in this project'));
      await expect(service.logWork('user-1', { projectId: 'p-1', issueId: 'i-9', hours: 1 }))
        .rejects.toThrow('La historia seleccionada no pertenece a este proyecto.');
    });

    it('returns the latest entries and the total of the whole project', async () => {
      ms1.listWorkLogs.mockResolvedValue({ entries: [log], totalHours: 145 });
      await expect(service.workLogSummary('user-1', 'p-1')).resolves.toEqual({ totalHours: 145, entries: [model] });
      expect(ms1.listWorkLogs).toHaveBeenCalledWith('user-1', 'p-1');

      ms1.listWorkLogs.mockResolvedValue({});
      await expect(service.workLogSummary('user-1', 'p-1')).resolves.toEqual({ totalHours: 0, entries: [] });
    });

    it('returns the entries and total of one issue', async () => {
      ms1.listWorkLogs.mockResolvedValue({ entries: [log], totalHours: 2.5 });
      await expect(service.issueWorkLogs('user-1', 'p-1', 'i-1')).resolves.toEqual({ totalHours: 2.5, entries: [model] });
      expect(ms1.listWorkLogs).toHaveBeenCalledWith('user-1', 'p-1', 0, 'i-1');

      ms1.listWorkLogs.mockResolvedValue({});
      await expect(service.issueWorkLogs('user-1', 'p-1', 'i-1')).resolves.toEqual({ totalHours: 0, entries: [] });
      ms1.listWorkLogs.mockRejectedValue(grpcError(5, 'issue not found in this project'));
      await expect(service.issueWorkLogs('user-1', 'p-1', 'i-9')).rejects.toThrow('La historia seleccionada no pertenece a este proyecto.');
    });

    it('sums the hours of a sprint', async () => {
      ms1.sumSprintHours.mockResolvedValue(7.5);
      await expect(service.sprintLoggedHours('p-1', 's-1')).resolves.toBe(7.5);
      expect(ms1.sumSprintHours).toHaveBeenCalledWith('p-1', 's-1');
    });
  });
});
