import { Logger } from '@nestjs/common';

// Simulates grpc-js rejecting the channel configuration (e.g. an invalid target).
jest.mock('jira-contracts/gen/ts', () => {
  const actual = jest.requireActual('jira-contracts/gen/ts');
  const failingConstructor = jest.fn(() => {
    throw new Error('Invalid target URI');
  });
  return { ...actual, IssueServiceClient: failingConstructor, SprintServiceClient: failingConstructor };
});

import { IssuesGrpcClient } from '../src/grpc/issues-grpc.client';
import { SprintsGrpcClient } from '../src/grpc/sprints-grpc.client';

describe('gRPC clients when the channel cannot be created', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('IssuesGrpcClient logs the failure and later calls reject clearly', async () => {
    const client = new IssuesGrpcClient({ issuesGrpcUrl: '::bad::' } as any);

    expect(() => client.onModuleInit()).not.toThrow();
    expect(Logger.prototype.warn).toHaveBeenCalledWith('Failed to initialize IssuesServiceClient: Invalid target URI');
    await expect(client.getIssue('i1')).rejects.toThrow('Issues gRPC client not initialized');
  });

  it('SprintsGrpcClient logs the failure and later calls reject clearly', async () => {
    const client = new SprintsGrpcClient({ sprintsGrpcUrl: '::bad::' } as any);

    expect(() => client.onModuleInit()).not.toThrow();
    expect(Logger.prototype.warn).toHaveBeenCalledWith('Failed to initialize SprintServiceClient: Invalid target URI');
    await expect(client.getSprint('s1')).rejects.toThrow('Sprints gRPC client not initialized');
  });
});
