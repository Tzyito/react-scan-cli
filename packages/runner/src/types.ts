export interface PageConfig {
  name: string;
  url: string;
}

export interface RunnerConfig {
  projectName: string;
  baseUrl: string;
  issueRepo: string;
  githubToken: string;
  pages: PageConfig[];
  triggerCookie?: string;
  observeDuration?: number;
  threshold?: number;
  authSetup?: (page: import('playwright').Page) => Promise<void>;
}

export interface ComponentData {
  count: number;
  reasons: string[];
}

export interface IssueData {
  component: string;
  count: number;
  reasons: string[];
  severity: 'high' | 'medium' | 'low';
}

export interface PageReport {
  page: string;
  url: string;
  issues: IssueData[];
  screenshotBase64: string;
  observeDuration: number;
  timestamp: string;
}
