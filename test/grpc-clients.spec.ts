import { IssuesGrpcClient } from '../src/grpc/issues-grpc.client';
import { SprintsGrpcClient } from '../src/grpc/sprints-grpc.client';

describe('gRPC Clients Unit Tests', () => {
  describe('IssuesGrpcClient', () => {
    let mockStub: any;
    let client: IssuesGrpcClient;

    beforeEach(() => {
      mockStub = {
        getIssue: jest.fn((req, cb) => cb(null, { issue: { id: req.id, title: 'Sample' } })),
        listIssues: jest.fn((req, cb) => cb(null, { issues: [{ id: '1' }] })),
        createIssue: jest.fn((req, cb) => cb(null, { issue: { id: 'created-1', title: req.title } })),
        updateIssueStatus: jest.fn((req, cb) => cb(null, { issue: { id: req.id, status: req.status } })),
        close: jest.fn(),
      };
      client = new IssuesGrpcClient(undefined, mockStub);
    });

    it('should call getIssue and resolve issue', async () => {
      const res = await client.getIssue('123');
      expect(res.id).toBe('123');
      expect(mockStub.getIssue).toHaveBeenCalled();
    });

    it('should call listIssues and resolve list', async () => {
      const res = await client.listIssues('proj-1');
      expect(res.length).toBe(1);
    });

    it('should call createIssue and resolve created issue', async () => {
      const res = await client.createIssue({ project_id: 'p1', title: 'New' } as any);
      expect(res.id).toBe('created-1');
    });

    it('should call updateIssueStatus and resolve updated issue', async () => {
      const res = await client.updateIssueStatus('123', 2);
      expect(res.status).toBe(2);
    });

    it('should gracefully handle close in onModuleDestroy', () => {
      client.onModuleDestroy();
      expect(mockStub.close).toHaveBeenCalled();
    });
  });

  describe('SprintsGrpcClient', () => {
    let mockStub: any;
    let client: SprintsGrpcClient;

    beforeEach(() => {
      mockStub = {
        getSprint: jest.fn((req, cb) => cb(null, { sprint: { id: req.id, name: 'Sprint 1' } })),
        listSprints: jest.fn((req, cb) => cb(null, { sprints: [{ id: 's1' }] })),
        createSprint: jest.fn((req, cb) => cb(null, { sprint: { id: 's-new', name: req.name } })),
        startSprint: jest.fn((req, cb) => cb(null, { sprint: { id: req.id, status: 2 } })),
        completeSprint: jest.fn((req, cb) => cb(null, { sprint: { id: req.id, status: 3 } })),
        close: jest.fn(),
      };
      client = new SprintsGrpcClient(undefined, mockStub);
    });

    it('should call getSprint and resolve sprint', async () => {
      const res = await client.getSprint('s-1');
      expect(res.id).toBe('s-1');
    });

    it('should call listSprints and resolve sprints', async () => {
      const res = await client.listSprints('p-1');
      expect(res.length).toBe(1);
    });

    it('should call createSprint and resolve sprint', async () => {
      const res = await client.createSprint({ project_id: 'p1', name: 'Sprint X' } as any);
      expect(res.id).toBe('s-new');
    });

    it('should call startSprint and resolve sprint', async () => {
      const res = await client.startSprint('s-1');
      expect(res.status).toBe(2);
    });

    it('should call completeSprint and resolve sprint', async () => {
      const res = await client.completeSprint('s-1');
      expect(res.status).toBe(3);
    });

    it('should gracefully handle close in onModuleDestroy', () => {
      client.onModuleDestroy();
      expect(mockStub.close).toHaveBeenCalled();
    });
  });
});
