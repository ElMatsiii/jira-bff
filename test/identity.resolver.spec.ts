import { IdentityResolver } from '../src/identity/identity.resolver';
import { IdentityService } from '../src/identity/identity.service';

describe('IdentityResolver', () => {
  const user = { id: 'user-1', name: 'Ana', email: 'ana@example.com' };
  const request = { headers: { authorization: 'Bearer t' } } as any;
  let identity: Record<string, jest.Mock>;
  let resolver: IdentityResolver;

  beforeEach(() => {
    identity = {
      register: jest.fn().mockResolvedValue({ token: 't', user }),
      login: jest.fn().mockResolvedValue({ token: 't', user }),
      authenticate: jest.fn().mockResolvedValue(user),
      workspaces: jest.fn().mockResolvedValue([]),
      projects: jest.fn().mockResolvedValue([]),
      createProject: jest.fn().mockResolvedValue({ id: 'p-1' }),
      addMember: jest.fn().mockResolvedValue(user),
      workLogSummary: jest.fn().mockResolvedValue({ totalHours: 0, entries: [] }),
      logWork: jest.fn().mockResolvedValue({ id: 'log-1' }),
    };
    resolver = new IdentityResolver(identity as unknown as IdentityService);
  });

  it('registers and logs in without a session', async () => {
    await resolver.register({ name: 'Ana', email: 'ana@example.com', password: 'contraseña-larga' });
    await resolver.login({ email: 'ana@example.com', password: 'contraseña-larga' });
    expect(identity.register).toHaveBeenCalledWith('Ana', 'ana@example.com', 'contraseña-larga');
    expect(identity.login).toHaveBeenCalledWith('ana@example.com', 'contraseña-larga');
    expect(identity.authenticate).not.toHaveBeenCalled();
  });

  it('runs every other operation as the authenticated user', async () => {
    await expect(resolver.me(request)).resolves.toBe(user);
    await resolver.myWorkspaces(request);
    await resolver.workspaceProjects('ws-1', request);
    await resolver.createProject({ workspaceId: 'ws-1', name: 'Portal', key: 'WEB' }, request);
    await resolver.addWorkspaceMember({ workspaceId: 'ws-1', email: 'b@example.com' }, request);
    await resolver.projectWorkLogs('p-1', request);
    await resolver.logWork({ projectId: 'p-1', issueId: 'i-1', hours: 1 }, request);

    expect(identity.authenticate).toHaveBeenCalledTimes(7);
    expect(identity.workspaces).toHaveBeenCalledWith('user-1');
    expect(identity.projects).toHaveBeenCalledWith('user-1', 'ws-1');
    expect(identity.createProject).toHaveBeenCalledWith('user-1', { workspaceId: 'ws-1', name: 'Portal', key: 'WEB' });
    expect(identity.addMember).toHaveBeenCalledWith('user-1', 'ws-1', 'b@example.com');
    expect(identity.workLogSummary).toHaveBeenCalledWith('user-1', 'p-1');
    expect(identity.logWork).toHaveBeenCalledWith('user-1', { projectId: 'p-1', issueId: 'i-1', hours: 1 });
  });
});
