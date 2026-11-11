import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class IdentityDatabase implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdentityDatabase.name);
  readonly pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      'postgresql://jira_user:jira_password@localhost:5434/issues_db',
  });

  async onModuleInit(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(120) NOT NULL,
        email VARCHAR(320) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS workspaces (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(160) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS workspace_members (
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (workspace_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS app_projects (
        project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_members_user
        ON workspace_members(user_id, workspace_id);
      CREATE INDEX IF NOT EXISTS idx_app_projects_workspace
        ON app_projects(workspace_id);
      CREATE TABLE IF NOT EXISTS work_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        sprint_id VARCHAR(255),
        hours NUMERIC(6,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
        note VARCHAR(500) NOT NULL DEFAULT '',
        logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS sprint_id VARCHAR(255);
      CREATE INDEX IF NOT EXISTS idx_work_logs_project_logged_at
        ON work_logs(project_id, logged_at DESC);
      CREATE INDEX IF NOT EXISTS idx_work_logs_issue
        ON work_logs(issue_id, logged_at DESC);
    `);
    this.logger.log('Identity and workspace schema is ready');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
