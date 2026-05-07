export interface PageConfig {
  name: string;
  url: string;
}

export type ReporterProvider = 'github' | 'gitlab';

export interface RunnerConfig {
  projectName: string;
  baseUrl: string;
  /**
   * Pages to scan. If omitted or empty, pages are auto-discovered by
   * crawling links from baseUrl (up to maxPages).
   */
  pages?: PageConfig[];
  /** Max pages to auto-discover when pages is not specified. Defaults to 20. */
  maxPages?: number;
  triggerCookie?: string;
  observeDuration?: number;
  threshold?: number;
  authSetup?: (page: import('playwright').Page) => Promise<void>;

  /** Which issue tracker to report to. Defaults to 'github'. */
  provider?: ReporterProvider;

  // GitHub
  githubToken?: string;
  /** "owner/repo" */
  issueRepo?: string;

  // GitLab
  gitlabToken?: string;
  /** "namespace/project" or numeric project ID */
  gitlabProject?: string;
  /** Base URL for self-hosted GitLab. Defaults to "https://gitlab.com". */
  gitlabBaseUrl?: string;
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
