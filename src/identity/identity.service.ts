import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { IdentityDatabase } from './database.service';
import { LogWorkInput, ProjectModel, UserModel, WorkLogModel, WorkspaceModel } from './identity.models';

interface TokenClaims {
  sub: string;
  email: string;
  exp: number;
}

@Injectable()
export class IdentityService {
  private readonly secret =
    process.env.JWT_SECRET || 'local-development-secret-change-before-deploy';

  constructor(private readonly database: IdentityDatabase) {}

  async register(name: string, email: string, password: string): Promise<{ token: string; user: UserModel }> {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new ConflictException('Ingresa un nombre y un email válidos.');
    }
    if (password.length < 10 || password.length > 200) {
      throw new ConflictException('La contraseña debe tener entre 10 y 200 caracteres.');
    }

    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const passwordHash = this.hashPassword(password);
      const { rows } = await client.query<UserModel>(
        'INSERT INTO app_users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
        [normalizedName, normalizedEmail, passwordHash],
      );
      const user = rows[0];
      const workspace = await client.query<{ id: string }>(
        'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
        [`${normalizedName}'s workspace`],
      );
      await client.query(
        'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
        [workspace.rows[0].id, user.id, 'OWNER'],
      );
      await client.query('COMMIT');
      return { user, token: this.createToken(user) };
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Ya existe una cuenta con ese email.');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async login(email: string, password: string): Promise<{ token: string; user: UserModel }> {
    const { rows } = await this.database.pool.query<UserModel & { password_hash: string }>(
      'SELECT id, name, email, password_hash FROM app_users WHERE email = $1',
      [email.trim().toLowerCase()],
    );
    const user = rows[0];
    if (!user || !this.verifyPassword(password, user.password_hash)) {
      throw new UnauthorizedException('Email o contraseña incorrectos.');
    }
    return {
      user: { id: user.id, name: user.name, email: user.email },
      token: this.createToken(user),
    };
  }

  async authenticate(request: Request): Promise<UserModel> {
    const header = request.headers.authorization || '';
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
    if (!match) throw new UnauthorizedException('Inicia sesión para continuar.');
    const claims = this.verifyToken(match[1]);
    const { rows } = await this.database.pool.query<UserModel>(
      'SELECT id, name, email FROM app_users WHERE id = $1',
      [claims.sub],
    );
    if (!rows[0]) throw new UnauthorizedException('La cuenta ya no está disponible.');
    return rows[0];
  }

  async workspaces(userId: string): Promise<WorkspaceModel[]> {
    const { rows } = await this.database.pool.query<WorkspaceModel>(
      `SELECT w.id, w.name, wm.role FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = $1 ORDER BY w.created_at`,
      [userId],
    );
    return rows;
  }

  async projects(userId: string, workspaceId: string): Promise<ProjectModel[]> {
    await this.requireWorkspaceRole(userId, workspaceId, ['OWNER', 'ADMIN', 'MEMBER']);
    const { rows } = await this.database.pool.query<ProjectModel>(
      `SELECT p.id, ap.workspace_id AS "workspaceId", p.name, p.key, p.description
       FROM app_projects ap JOIN projects p ON p.id = ap.project_id
       WHERE ap.workspace_id = $1 ORDER BY p.created_at DESC`,
      [workspaceId],
    );
    return rows;
  }

  async createProject(
    userId: string,
    input: { workspaceId: string; name: string; key: string; description?: string },
  ): Promise<ProjectModel> {
    await this.requireWorkspaceRole(userId, input.workspaceId, ['OWNER', 'ADMIN']);
    const name = input.name.trim();
    const key = input.key.trim().toUpperCase();
    if (!name || name.length > 255 || !/^[A-Z][A-Z0-9]{1,9}$/.test(key)) {
      throw new ConflictException('El proyecto requiere nombre y una clave de 2 a 10 caracteres alfanuméricos.');
    }

    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const project = await client.query<ProjectModel>(
        `INSERT INTO projects (key, name, description)
         VALUES ($1, $2, $3)
         RETURNING id, name, key, description`,
        [key, name, input.description?.trim() || ''],
      );
      const created = project.rows[0];
      await client.query(
        'INSERT INTO app_projects (project_id, workspace_id) VALUES ($1, $2)',
        [created.id, input.workspaceId],
      );
      await client.query('COMMIT');
      return { ...created, workspaceId: input.workspaceId };
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Esa clave de proyecto ya está en uso.');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async addMember(userId: string, workspaceId: string, email: string): Promise<UserModel> {
    await this.requireWorkspaceRole(userId, workspaceId, ['OWNER', 'ADMIN']);
    const normalizedEmail = email.trim().toLowerCase();
    const { rows } = await this.database.pool.query<UserModel>(
      'SELECT id, name, email FROM app_users WHERE email = $1',
      [normalizedEmail],
    );
    const member = rows[0];
    if (!member) {
      throw new ConflictException('El usuario debe crear una cuenta antes de que puedas agregarlo.');
    }
    await this.database.pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'MEMBER') ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [workspaceId, member.id],
    );
    return member;
  }

  async assertProjectAccess(userId: string, projectId: string): Promise<void> {
    const { rowCount } = await this.database.pool.query(
      `SELECT 1 FROM app_projects ap
       JOIN workspace_members wm ON wm.workspace_id = ap.workspace_id
       WHERE ap.project_id = $1 AND wm.user_id = $2`,
      [projectId, userId],
    );
    if (!rowCount) throw new ForbiddenException('No tienes acceso a este proyecto.');
  }

  async assertWorkspaceAccess(userId: string, workspaceId: string): Promise<void> {
    await this.requireWorkspaceRole(userId, workspaceId, ['OWNER', 'ADMIN', 'MEMBER']);
  }

  async logWork(userId: string, input: LogWorkInput): Promise<WorkLogModel> {
    await this.assertProjectAccess(userId, input.projectId);
    if (!Number.isFinite(input.hours) || input.hours <= 0 || input.hours > 24) {
      throw new ConflictException('Registra entre 0,01 y 24 horas por entrada.');
    }
    const issue = await this.database.pool.query<{ sprint_id: string | null }>(
      'SELECT sprint_id FROM issues WHERE id = $1 AND project_id = $2',
      [input.issueId, input.projectId],
    );
    if (!issue.rows[0]) throw new ConflictException('La historia seleccionada no pertenece a este proyecto.');
    const { rows } = await this.database.pool.query<WorkLogModel>(
      `WITH inserted AS (
         INSERT INTO work_logs (project_id, issue_id, user_id, sprint_id, hours, note)
         VALUES ($1, $2, $3, $6, $4, $5)
         RETURNING *
       )
       SELECT wl.id, wl.issue_id AS "issueId", i.key AS "issueKey",
         i.title AS "issueTitle", u.name AS "userName", wl.hours::float AS hours,
         wl.note, wl.logged_at AS "loggedAt"
       FROM inserted wl
       JOIN issues i ON i.id = wl.issue_id
       JOIN app_users u ON u.id = wl.user_id`,
      [input.projectId, input.issueId, userId, input.hours, input.note?.trim() || '', issue.rows[0].sprint_id],
    );
    return { ...rows[0], loggedAt: new Date(rows[0].loggedAt).toISOString() };
  }

  async workLogSummary(userId: string, projectId: string): Promise<{ totalHours: number; entries: WorkLogModel[] }> {
    await this.assertProjectAccess(userId, projectId);
    const [entryResult, totalResult] = await Promise.all([
      this.database.pool.query<WorkLogModel>(
      `SELECT wl.id, wl.issue_id AS "issueId", i.key AS "issueKey",
        i.title AS "issueTitle", u.name AS "userName", wl.hours::float AS hours,
        wl.note, wl.logged_at AS "loggedAt"
       FROM work_logs wl
       JOIN issues i ON i.id = wl.issue_id
       JOIN app_users u ON u.id = wl.user_id
       WHERE wl.project_id = $1
       ORDER BY wl.logged_at DESC LIMIT 100`,
      [projectId],
      ),
      this.database.pool.query<{ total: number }>(
        'SELECT COALESCE(SUM(hours), 0)::float AS total FROM work_logs WHERE project_id = $1',
        [projectId],
      ),
    ]);
    const entries = entryResult.rows.map((row) => ({ ...row, loggedAt: new Date(row.loggedAt).toISOString() }));
    return { totalHours: Number(totalResult.rows[0].total), entries };
  }

  async sprintLoggedHours(projectId: string, sprintId: string): Promise<number> {
    const { rows } = await this.database.pool.query<{ hours: number }>(
      `SELECT COALESCE(SUM(wl.hours), 0)::float AS hours
       FROM work_logs wl JOIN issues i ON i.id = wl.issue_id
       WHERE wl.project_id = $1 AND wl.sprint_id = $2`,
      [projectId, sprintId],
    );
    return rows[0].hours;
  }

  private async requireWorkspaceRole(userId: string, workspaceId: string, roles: string[]): Promise<string> {
    const { rows } = await this.database.pool.query<{ role: string }>(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId],
    );
    const role = rows[0]?.role;
    if (!role || !roles.includes(role)) throw new ForbiddenException('No tienes acceso a este espacio de trabajo.');
    return role;
  }

  private hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
  }

  private verifyPassword(password: string, stored: string): boolean {
    const [algorithm, salt, hash] = stored.split('$');
    if (algorithm !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'hex');
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
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
