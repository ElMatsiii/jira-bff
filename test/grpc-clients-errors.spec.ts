import { Logger } from '@nestjs/common';
import { IssueServiceClient, SprintServiceClient } from 'jira-contracts/gen/ts';
import { IssuesGrpcClient } from '../src/grpc/issues-grpc.client';
import { SprintsGrpcClient } from '../src/grpc/sprints-grpc.client';

/** A stub method that fails like grpc-js does: callback(err). */
const failing = (message: string) => jest.fn((_req: unknown, cb: (err: Error | null, res?: unknown) => void) => cb(new Error(message)));
const answering = (response: unknown) => jest.fn((_req: unknown, cb: (err: Error | null, res?: unknown) => void) => cb(null, response));

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('IssuesGrpcClient', () => {
  it('rejects every call when the client was never initialized', async () => {
    const client = new IssuesGrpcClient();
    const message = 'Issues gRPC client not initialized';

    await expect(client.getIssue('i1')).rejects.toThrow(message);
    await expect(client.listIssues('p1')).rejects.toThrow(message);
    await expect(client.createIssue({ projectId: 'p1', title: 'x' } as any)).rejects.toThrow(message);
    await expect(client.updateIssueStatus('i1', 2)).rejects.toThrow(message);
    await expect(client.assignIssuesToSprint(['i1'], 's1')).rejects.toThrow(message);
  });

  it('propagates gRPC errors from MS1', async () => {
    const stub = {
      getIssue: failing('NOT_FOUND: issue'),
      listIssues: failing('UNAVAILABLE'),
      createIssue: failing('INVALID_ARGUMENT: project_id must be a valid UUID'),
      updateIssueStatus: failing('ABORTED: changed while updating'),
      batchUpdateIssueSprint: failing('INTERNAL'),
    };
    const client = new IssuesGrpcClient(undefined, stub);

    await expect(client.getIssue('i1')).rejects.toThrow('NOT_FOUND: issue');
    await expect(client.listIssues('p1')).rejects.toThrow('UNAVAILABLE');
    await expect(client.createIssue({ projectId: 'bad', title: 'x' } as any)).rejects.toThrow('must be a valid UUID');
    await expect(client.updateIssueStatus('i1', 2)).rejects.toThrow('ABORTED');
    await expect(client.assignIssuesToSprint(['i1'], 's1')).rejects.toThrow('INTERNAL');
  });

  it('builds the ListIssues request and defaults to an empty list', async () => {
    const listIssues = answering({});
    const client = new IssuesGrpcClient(undefined, { listIssues });

    await expect(client.listIssues('p1')).resolves.toEqual([]);
    expect(listIssues.mock.calls[0][0]).toEqual({ projectId: 'p1', sprintId: '', status: 0, limit: 100, offset: 0 });

    await client.listIssues('p1', 's1');
    expect(listIssues.mock.calls[1][0]).toMatchObject({ projectId: 'p1', sprintId: 's1' });
  });

  it('sends UpdateIssueStatus and BatchUpdateIssueSprint requests with the expected fields', async () => {
    const updateIssueStatus = answering({ issue: { id: 'i1', status: 3 } });
    const batchUpdateIssueSprint = jest.fn()
      .mockImplementationOnce((_req, cb) => cb(null, { issues: [{ id: 'i1' }, { id: 'i2' }] }))
      .mockImplementationOnce((_req, cb) => cb(null, {}));
    const client = new IssuesGrpcClient(undefined, { updateIssueStatus, batchUpdateIssueSprint });

    await expect(client.updateIssueStatus('i1', 3)).resolves.toEqual({ id: 'i1', status: 3 });
    expect(updateIssueStatus.mock.calls[0][0]).toEqual({ id: 'i1', status: 3 });

    await expect(client.assignIssuesToSprint(['i1', 'i2'], 's1')).resolves.toHaveLength(2);
    expect(batchUpdateIssueSprint.mock.calls[0][0]).toEqual({ issueIds: ['i1', 'i2'], sprintId: 's1' });
    await expect(client.assignIssuesToSprint(['i3'], '')).resolves.toEqual([]);
  });

  it('creates a real grpc-js client on init with the configured URL and closes it', () => {
    const client = new IssuesGrpcClient({ issuesGrpcUrl: '127.0.0.1:59991' } as any);
    client.onModuleInit();

    const inner = (client as any).client;
    expect(inner).toBeInstanceOf(IssueServiceClient);
    expect(Logger.prototype.log).toHaveBeenCalledWith('Connecting to Issues gRPC Service on 127.0.0.1:59991');
    const close = jest.spyOn(inner, 'close');
    client.onModuleDestroy();
    expect(close).toHaveBeenCalled();
  });

  it('uses localhost:50051 by default and keeps an injected client on init', () => {
    const defaults = new IssuesGrpcClient();
    defaults.onModuleInit();
    expect(Logger.prototype.log).toHaveBeenCalledWith('Connecting to Issues gRPC Service on localhost:50051');
    defaults.onModuleDestroy();

    const stub = { getIssue: jest.fn() };
    const injected = new IssuesGrpcClient(undefined, stub);
    injected.onModuleInit();
    expect((injected as any).client).toBe(stub);
  });

  it('logs instead of throwing when closing fails, and ignores clients without close()', () => {
    const throwing = new IssuesGrpcClient(undefined, { close: () => { throw new Error('already closed'); } });
    expect(() => throwing.onModuleDestroy()).not.toThrow();
    expect(Logger.prototype.warn).toHaveBeenCalledWith('Error closing Issues gRPC client: already closed');

    expect(() => new IssuesGrpcClient(undefined, {}).onModuleDestroy()).not.toThrow();
    expect(() => new IssuesGrpcClient().onModuleDestroy()).not.toThrow();
  });
});

describe('SprintsGrpcClient', () => {
  it('rejects every call when the client was never initialized', async () => {
    const client = new SprintsGrpcClient();
    const message = 'Sprints gRPC client not initialized';

    await expect(client.getSprint('s1')).rejects.toThrow(message);
    await expect(client.listSprints('p1')).rejects.toThrow(message);
    await expect(client.createSprint({ projectId: 'p1', name: 'S' } as any)).rejects.toThrow(message);
    await expect(client.startSprint('s1')).rejects.toThrow(message);
    await expect(client.completeSprint('s1')).rejects.toThrow(message);
  });

  it('propagates gRPC errors from MS2', async () => {
    const stub = {
      getSprint: failing('NOT_FOUND: sprint'),
      listSprints: failing('UNAVAILABLE'),
      createSprint: failing('INVALID_ARGUMENT: dates'),
      startSprint: failing('FAILED_PRECONDITION: another sprint is active'),
      completeSprint: failing('FAILED_PRECONDITION: not active'),
    };
    const client = new SprintsGrpcClient(undefined, stub);

    await expect(client.getSprint('s1')).rejects.toThrow('NOT_FOUND: sprint');
    await expect(client.listSprints('p1')).rejects.toThrow('UNAVAILABLE');
    await expect(client.createSprint({ projectId: 'p1', name: 'S' } as any)).rejects.toThrow('dates');
    await expect(client.startSprint('s1')).rejects.toThrow('another sprint is active');
    await expect(client.completeSprint('s1')).rejects.toThrow('not active');
  });

  it('sends the expected requests and defaults ListSprints to an empty list', async () => {
    const listSprints = answering({});
    const startSprint = answering({ sprint: { id: 's1', status: 2 } });
    const completeSprint = answering({ sprint: { id: 's1', status: 3 } });
    const client = new SprintsGrpcClient(undefined, { listSprints, startSprint, completeSprint });

    await expect(client.listSprints('p1')).resolves.toEqual([]);
    expect(listSprints.mock.calls[0][0]).toMatchObject({ projectId: 'p1' });
    await client.startSprint('s1');
    expect(startSprint.mock.calls[0][0]).toEqual({ id: 's1' });
    await expect(client.completeSprint('s1')).resolves.toEqual({ id: 's1', status: 3 });
    expect(completeSprint.mock.calls[0][0]).toEqual({ id: 's1' });
  });

  it('creates a real grpc-js client on init with the configured URL and closes it', () => {
    const client = new SprintsGrpcClient({ sprintsGrpcUrl: '127.0.0.1:59992' } as any);
    client.onModuleInit();

    const inner = (client as any).client;
    expect(inner).toBeInstanceOf(SprintServiceClient);
    expect(Logger.prototype.log).toHaveBeenCalledWith('Connecting to Sprints gRPC Service on 127.0.0.1:59992');
    const close = jest.spyOn(inner, 'close');
    client.onModuleDestroy();
    expect(close).toHaveBeenCalled();
  });

  it('uses localhost:50052 by default and keeps an injected client on init', () => {
    const defaults = new SprintsGrpcClient();
    defaults.onModuleInit();
    expect(Logger.prototype.log).toHaveBeenCalledWith('Connecting to Sprints gRPC Service on localhost:50052');
    defaults.onModuleDestroy();

    const stub = { getSprint: jest.fn() };
    const injected = new SprintsGrpcClient(undefined, stub);
    injected.onModuleInit();
    expect((injected as any).client).toBe(stub);
  });

  it('logs instead of throwing when closing fails', () => {
    const throwing = new SprintsGrpcClient(undefined, { close: () => { throw new Error('already closed'); } });
    expect(() => throwing.onModuleDestroy()).not.toThrow();
    expect(Logger.prototype.warn).toHaveBeenCalledWith('Error closing Sprints gRPC client: already closed');
    expect(() => new SprintsGrpcClient(undefined, {}).onModuleDestroy()).not.toThrow();
  });
});
