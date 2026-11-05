import { Injectable, Logger, Optional } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '../config/config.service';

export interface AiStory {
  title: string;
  description: string;
  type: string;
  estimatedStoryPoints: number;
  acceptanceCriteriaGherkin: string;
}

export interface AiDecompositionResult {
  epicTitle: string;
  stories: AiStory[];
}

export interface AiSprintPlanResult {
  sprintGoal: string;
  allocatedStoryPoints: number;
  recommendedIssueIds: string[];
  riskAssessment: string;
}

export interface AiDiagnosisResult {
  sprintId: string;
  healthStatus: string;
  summary: string;
  rootCauses: string[];
  recommendations: string[];
}

@Injectable()
export class McpAgentClient {
  private readonly logger = new Logger(McpAgentClient.name);

  constructor(@Optional() private readonly configService?: ConfigService) {}

  private get baseUrl(): string {
    return this.configService?.mcpAgentUrl || 'http://localhost:3000';
  }

  async decomposeEpic(input: {
    epicTitle: string;
    epicDescription?: string;
    projectKey?: string;
  }): Promise<AiDecompositionResult> {
    try {
      const res = await axios.post(`${this.baseUrl}/agent/decompose-epic`, input, { timeout: 5000 });
      return res.data;
    } catch (err: any) {
      this.logger.warn(`Failed calling MCP agent decompose-epic (${err.message}), using fallback`);
      return {
        epicTitle: input.epicTitle,
        stories: [
          {
            title: `Implement ${input.epicTitle} - Core API`,
            description: `Backend services for ${input.epicTitle}`,
            type: 'STORY',
            estimatedStoryPoints: 5,
            acceptanceCriteriaGherkin: 'Scenario: Core API functionality\nGiven service is running\nWhen request is received\nThen return valid response',
          },
          {
            title: `Build ${input.epicTitle} - UI Components`,
            description: `Frontend interface for ${input.epicTitle}`,
            type: 'STORY',
            estimatedStoryPoints: 3,
            acceptanceCriteriaGherkin: 'Scenario: UI interaction\nGiven user is on screen\nWhen user clicks button\nThen display data',
          },
          {
            title: `Write Automated Tests for ${input.epicTitle}`,
            description: `Unit and integration coverage for ${input.epicTitle}`,
            type: 'TASK',
            estimatedStoryPoints: 2,
            acceptanceCriteriaGherkin: 'Scenario: Test verification\nGiven test suite runs\nWhen executed\nThen coverage exceeds 60%',
          },
        ],
      };
    }
  }

  async planSprint(input: {
    sprintGoal: string;
    teamCapacityStoryPoints: number;
    candidateIssues?: any[];
  }): Promise<AiSprintPlanResult> {
    try {
      const res = await axios.post(`${this.baseUrl}/agent/plan-sprint`, input, { timeout: 5000 });
      return res.data;
    } catch (err: any) {
      this.logger.warn(`Failed calling MCP agent plan-sprint (${err.message}), using fallback`);
      const issues = input.candidateIssues || [];
      const allocated: string[] = [];
      let currentPoints = 0;

      for (const issue of issues) {
        const pts = issue.storyPoints || 3;
        if (currentPoints + pts <= input.teamCapacityStoryPoints) {
          allocated.push(issue.id);
          currentPoints += pts;
        }
      }

      return {
        sprintGoal: input.sprintGoal,
        allocatedStoryPoints: currentPoints,
        recommendedIssueIds: allocated,
        riskAssessment: currentPoints >= input.teamCapacityStoryPoints * 0.9 ? 'MEDIUM_CAPACITY_RISK' : 'LOW_RISK',
      };
    }
  }

  async diagnoseMetrics(input: {
    sprintId: string;
    burndownData?: any[];
    blockedIssuesCount?: number;
  }): Promise<AiDiagnosisResult> {
    try {
      const res = await axios.post(`${this.baseUrl}/agent/diagnose-metrics`, input, { timeout: 5000 });
      return res.data;
    } catch (err: any) {
      this.logger.warn(`Failed calling MCP agent diagnose-metrics (${err.message}), using fallback`);
      const blocked = input.blockedIssuesCount || 0;
      return {
        sprintId: input.sprintId,
        healthStatus: blocked > 1 ? 'AT_RISK' : 'HEALTHY',
        summary: blocked > 1 ? 'Sprint contains blocked issues impacting velocity' : 'Sprint is progressing on track',
        rootCauses: blocked > 1 ? ['Blocked dependency on external API', 'High estimation variance'] : ['Balanced velocity'],
        recommendations: blocked > 1 ? ['Swarm on blocked tickets', 'Split oversized user stories'] : ['Maintain current momentum'],
      };
    }
  }
}
