import { IdentityDatabase } from '../src/identity/database.service';
import { IdentityService } from '../src/identity/identity.service';

describe('IdentityService work logs', () => {
  let query: jest.Mock;
  let service: IdentityService;

  beforeEach(() => {
    query = jest.fn();
    const database = { pool: { query } } as unknown as IdentityDatabase;
    service = new IdentityService(database);
    jest.spyOn(service, 'assertProjectAccess').mockResolvedValue();
  });

  it('associates a work log with the sprint assigned to its issue', async () => {
    const loggedAt = new Date('2026-01-15T12:00:00.000Z');
    query
      .mockResolvedValueOnce({ rows: [{ sprint_id: 'sprint-1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'log-1',
          issueId: 'issue-1',
          issueKey: 'DEMO-1',
          issueTitle: 'A story',
          userName: 'Ada',
          hours: 2.5,
          note: 'Implementation',
          loggedAt,
        }],
      });

    await service.logWork('user-1', {
      projectId: 'project-1',
      issueId: 'issue-1',
      hours: 2.5,
      note: 'Implementation',
    });

    expect(query.mock.calls[1][0]).toContain('INSERT INTO work_logs');
    expect(query.mock.calls[1][1]).toEqual(['project-1', 'issue-1', 'user-1', 2.5, 'Implementation', 'sprint-1']);
  });

  it('returns the full project total separately from the latest 100 work-log entries', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'log-1',
          issueId: 'issue-1',
          issueKey: 'DEMO-1',
          issueTitle: 'A story',
          userName: 'Ada',
          hours: 1,
          note: '',
          loggedAt: new Date('2026-01-15T12:00:00.000Z'),
        }],
      })
      .mockResolvedValueOnce({ rows: [{ total: 145 }] });

    const result = await service.workLogSummary('user-1', 'project-1');

    expect(result.entries).toHaveLength(1);
    expect(result.totalHours).toBe(145);
    expect(query.mock.calls[0][0]).toContain('LIMIT 100');
    expect(query.mock.calls[1][0]).toContain('SUM(hours)');
    expect(query.mock.calls[1][0]).not.toContain('LIMIT');
  });
});
