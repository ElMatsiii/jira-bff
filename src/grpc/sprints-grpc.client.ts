import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import * as grpc from '@grpc/grpc-js';
import { ConfigService } from '../config/config.service';
import {
  SprintServiceClient,
  Sprint,
  CreateSprintRequest,
  CreateSprintResponse,
  GetSprintRequest,
  GetSprintResponse,
  ListSprintsRequest,
  ListSprintsResponse,
  StartSprintRequest,
  StartSprintResponse,
  CompleteSprintRequest,
  CompleteSprintResponse,
} from 'jira-contracts/gen/ts';

@Injectable()
export class SprintsGrpcClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SprintsGrpcClient.name);
  private client: SprintServiceClient | null = null;

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

    const url = this.configService?.sprintsGrpcUrl || 'localhost:50052';
    this.logger.log(`Connecting to Sprints gRPC Service on ${url}`);

    try {
      this.client = new SprintServiceClient(
        url,
        grpc.credentials.createInsecure() as any,
        {
          'grpc.keepalive_time_ms': 30000,
          'grpc.keepalive_timeout_ms': 5000,
        },
      );
    } catch (err: any) {
      this.logger.warn(`Failed to initialize SprintServiceClient: ${err.message}`);
    }
  }

  onModuleDestroy() {
    if (this.client && typeof this.client.close === 'function') {
      try {
        this.client.close();
      } catch (err: any) {
        this.logger.warn(`Error closing Sprints gRPC client: ${err.message}`);
      }
    }
  }

  async getSprint(id: string): Promise<Sprint> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        return reject(new Error('Sprints gRPC client not initialized'));
      }
      const req: GetSprintRequest = { id };
      this.client.getSprint(req, (err: any, res: any) => {
        if (err) return reject(err);
        resolve(res.sprint);
      });
    });
  }

  async listSprints(projectId: string): Promise<Sprint[]> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        return reject(new Error('Sprints gRPC client not initialized'));
      }
      const req: ListSprintsRequest = {
        projectId,
        status: 0,
      };
      this.client.listSprints(req, (err: any, res: any) => {
        if (err) return reject(err);
        resolve(res.sprints || []);
      });
    });
  }

  async createSprint(req: CreateSprintRequest): Promise<Sprint> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        return reject(new Error('Sprints gRPC client not initialized'));
      }
      this.client.createSprint(req, (err: any, res: any) => {
        if (err) return reject(err);
        resolve(res.sprint);
      });
    });
  }

  async startSprint(id: string): Promise<Sprint> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        return reject(new Error('Sprints gRPC client not initialized'));
      }
      const req: StartSprintRequest = { id };
      this.client.startSprint(req, (err: any, res: any) => {
        if (err) return reject(err);
        resolve(res.sprint);
      });
    });
  }

  async completeSprint(id: string): Promise<Sprint> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        return reject(new Error('Sprints gRPC client not initialized'));
      }
      const req: CompleteSprintRequest = { id };
      this.client.completeSprint(req, (err: any, res: any) => {
        if (err) return reject(err);
        resolve(res.sprint);
      });
    });
  }
}
