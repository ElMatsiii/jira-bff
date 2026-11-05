import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import * as grpc from '@grpc/grpc-js';
import { ConfigService } from '../config/config.service';
import {
  IssueServiceClient,
  Issue,
  CreateIssueRequest,
  CreateIssueResponse,
  GetIssueRequest,
  GetIssueResponse,
  ListIssuesRequest,
  ListIssuesResponse,
  UpdateIssueStatusRequest,
  UpdateIssueStatusResponse,
} from 'jira-contracts/gen/ts';

@Injectable()
export class IssuesGrpcClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IssuesGrpcClient.name);
  private client: IssueServiceClient | null = null;

  constructor(
    @Optional() private readonly configService?: ConfigService,
    @Optional() customClient?: any,
  ) {
    if (customClient) {
      this.client = customClient;
    }
  }

  onModuleInit() {
    if (this.client) return;

    const url = this.configService?.issuesGrpcUrl || 'localhost:50051';
    this.logger.log(`Connecting to Issues gRPC Service on ${url}`);

    try {
      this.client = new IssueServiceClient(
        url,
        grpc.credentials.createInsecure() as any,
        {
          'grpc.keepalive_time_ms': 30000,
          'grpc.keepalive_timeout_ms': 5000,
        },
      );
    } catch (err: any) {
      this.logger.warn(`Failed to initialize IssuesServiceClient: ${err.message}`);
    }
  }

  onModuleDestroy() {
    if (this.client && typeof this.client.close === 'function') {
      try {
        this.client.close();
      } catch (err: any) {
        this.logger.warn(`Error closing Issues gRPC client: ${err.message}`);
      }
    }
  }

  async getIssue(id: string): Promise<Issue> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        return reject(new Error('Issues gRPC client not initialized'));
      }
      const req: GetIssueRequest = { id };
      this.client.getIssue(req, (err: any, res: any) => {
        if (err) return reject(err);
        resolve(res.issue);
      });
    });
  }

  async listIssues(projectId: string, sprintId?: string): Promise<Issue[]> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        return reject(new Error('Issues gRPC client not initialized'));
      }
      const req: ListIssuesRequest = {
        projectId,
        sprintId: sprintId || '',
        status: 0,
        limit: 100,
        offset: 0,
      };
      this.client.listIssues(req, (err: any, res: any) => {
        if (err) return reject(err);
        resolve(res.issues || []);
      });
    });
  }

  async createIssue(req: CreateIssueRequest): Promise<Issue> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        return reject(new Error('Issues gRPC client not initialized'));
      }
      this.client.createIssue(req, (err: any, res: any) => {
        if (err) return reject(err);
        resolve(res.issue);
      });
    });
  }

  async updateIssueStatus(id: string, status: number): Promise<Issue> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        return reject(new Error('Issues gRPC client not initialized'));
      }
      const req: UpdateIssueStatusRequest = { id, status };
      this.client.updateIssueStatus(req, (err: any, res: any) => {
        if (err) return reject(err);
        resolve(res.issue);
      });
    });
  }
}
