export interface PageConfig {
  name: string;
  url: string;
  /**
   * Interactions to run after initial load, before data is collected.
   * Defaults to scroll-through if omitted.
   */
  interactions?: PageInteraction[];
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

export interface ChangeDetail {
  type: string;    // 'props' | 'state' | 'context'
  name: string;
  prevValue?: string;
  value?: string;
}

export interface ComponentData {
  count: number;
  unnecessaryCount: number;
  totalTime: number;    // cumulative render time in ms
  minFps: number | null;
  reasons: string[];
  changes: ChangeDetail[];
}

export interface PageInteraction {
  type: 'scroll' | 'click' | 'hover' | 'wait' | 'fill' | 'waitForSelector';
  /** CSS selector — required for click / hover / fill / waitForSelector */
  selector?: string;
  /** Scroll destination. 0–1 = fraction of page height; >1 = pixels from top. */
  scrollY?: number;
  /** Wait duration in ms (type: 'wait') or timeout ceiling for waitForSelector */
  waitMs?: number;
  /** Text to type into the element (type: 'fill') */
  value?: string;
  /** Human-readable label shown in logs */
  description?: string;
}

export interface IssueData {
  component: string;
  count: number;
  unnecessaryCount: number;
  avgTime: number | null;    // ms
  minFps: number | null;
  reasons: string[];
  changes: ChangeDetail[];
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
