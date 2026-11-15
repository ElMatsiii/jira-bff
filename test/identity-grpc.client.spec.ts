import { Logger } from '@nestjs/common';
import { IdentityGrpcClient, Ms1IdentityStubs } from '../src/grpc/identity-grpc.client';

/** Fake stub method: answers with the given response, or fails with err. */
const unary = (response: unknown, err: unknown = null) => jest.fn((_req: unknown, cb: (e: unknown, r: unknown) => void) => cb(err, response));

function fakeStubs() {
  return {
    identity: {
      registerUser: unary({ user: { id: 'u1' }, workspace: { id: 'w1' } }),
      authenticateUser: unary({ user: { id: 'u1' } }),
      getUser: unary({ user: { id: 'u1' } }),
      listUserWorkspaces: unary({}),
      addWorkspaceMember: unary({ member: { id: 'u2' }, role: 3 }),
      close: jest.fn(),
    },
    projects: {
      createProject: unary({ project: { id: 'p1' } }),
      listProjects: unary({ projects: [{ id: 'p1' }] }),
      checkProjectAccess: unary({ allowed: true, role: 1, workspaceId: 'w1' }),
      close: jest.fn(),
    },
    workLogs: {
      logWork: unary({ workLog: { id: 'l1' } }),
      listWorkLogs: unary({ entries: [], totalHours: 3 }),
      sumSprintHours: unary({}),
      close: jest.fn(),
    },
  };
}

describe('IdentityGrpcClient', () => {
  let stubs: ReturnType<typeof fakeStubs>;
  let client: IdentityGrpcClient;

  beforeEach(() => {
    stubs = fakeStubs();
    client = new IdentityGrpcClient(undefined, stubs as unknown as Ms1IdentityStubs);
  });

  afterEach(() => jest.restoreAllMocks());

  it('maps every call to the MS1 request shape and unwraps the response', async () => {
    await expect(client.registerUser('Ana', 'a@x.com', 'pw')).resolves.toEqual({ user: { id: 'u1' }, workspace: { id: 'w1' } });
    expect(stubs.identity.registerUser.mock.calls[0][0]).toEqual({ name: 'Ana', email: 'a@x.com', password: 'pw' });

    await expect(client.authenticateUser('a@x.com', 'pw')).resolves.toEqual({ id: 'u1' });
    expect(stubs.identity.authenticateUser.mock.calls[0][0]).toEqual({ email: 'a@x.com', password: 'pw' });

    await expect(client.getUser('u1')).resolves.toEqual({ id: 'u1' });
    expect(stubs.identity.getUser.mock.calls[0][0]).toEqual({ id: 'u1' });

    await expect(client.listUserWorkspaces('u1')).resolves.toEqual([]);
    expect(stubs.identity.listUserWorkspaces.mock.calls[0][0]).toEqual({ userId: 'u1' });

    await expect(client.addWorkspaceMember('u1', 'w1', 'b@x.com')).resolves.toEqual({ member: { id: 'u2' }, role: 3 });
    expect(stubs.identity.addWorkspaceMember.mock.calls[0][0]).toEqual({ requesterId: 'u1', workspaceId: 'w1', memberEmail: 'b@x.com' });

    await expect(client.createProject('u1', 'w1', 'WEB', 'Portal', 'd')).resolves.toEqual({ id: 'p1' });
    expect(stubs.projects.createProject.mock.calls[0][0]).toEqual({ requesterId: 'u1', workspaceId: 'w1', key: 'WEB', name: 'Portal', description: 'd' });

    await expect(client.listProjects('u1', 'w1')).resolves.toEqual([{ id: 'p1' }]);
    expect(stubs.projects.listProjects.mock.calls[0][0]).toEqual({ requesterId: 'u1', workspaceId: 'w1' });

    await expect(client.checkProjectAccess('u1', 'p1')).resolves.toEqual({ allowed: true, role: 1, workspaceId: 'w1' });
    expect(stubs.projects.checkProjectAccess.mock.calls[0][0]).toEqual({ userId: 'u1', projectId: 'p1' });

    await expect(client.logWork('u1', 'p1', 'i1', 2, 'n')).resolves.toEqual({ id: 'l1' });
    expect(stubs.workLogs.logWork.mock.calls[0][0]).toEqual({ userId: 'u1', projectId: 'p1', issueId: 'i1', hours: 2, note: 'n' });

    await expect(client.listWorkLogs('u1', 'p1')).resolves.toEqual({ entries: [], totalHours: 3 });
    expect(stubs.workLogs.listWorkLogs.mock.calls[0][0]).toEqual({ requesterId: 'u1', projectId: 'p1', limit: 0, issueId: '' });

    await expect(client.sumSprintHours('p1', 's1')).resolves.toBe(0);
    expect(stubs.workLogs.sumSprintHours.mock.calls[0][0]).toEqual({ projectId: 'p1', sprintId: 's1' });
  });

  it('defaults empty repeated fields and rejects with the gRPC error', async () => {
    stubs.projects.listProjects = unary({});
    await expect(client.listProjects('u1', 'w1')).resolves.toEqual([]);

    const err = Object.assign(new Error('7 PERMISSION_DENIED'), { code: 7 });
    stubs.identity.getUser = unary(undefined, err);
    await expect(client.getUser('u1')).rejects.toBe(err);
  });

  it('rejects when it was never initialized', async () => {
    const empty = new IdentityGrpcClient();
    await expect(empty.getUser('u1')).rejects.toThrow('MS1 identity gRPC client not initialized');
    expect(() => empty.onModuleDestroy()).not.toThrow();
  });

  it('keeps injected stubs on init and closes all of them on shutdown, even if one fails', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    stubs.projects.close.mockImplementation(() => { throw new Error('already closed'); });

    client.onModuleInit();
    client.onModuleDestroy();

    expect(stubs.identity.close).toHaveBeenCalled();
    expect(stubs.workLogs.close).toHaveBeenCalled();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('already closed'));
  });

  it('creates the three real MS1 clients on the configured URL', () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const real = new IdentityGrpcClient({ issuesGrpcUrl: 'localhost:59999' } as any);

    real.onModuleInit();

    const created = (real as any).stubs as Ms1IdentityStubs;
    expect(Object.keys(created)).toEqual(['identity', 'projects', 'workLogs']);
    expect(Logger.prototype.log).toHaveBeenCalledWith(expect.stringContaining('localhost:59999'));
    real.onModuleDestroy();
  });
});
