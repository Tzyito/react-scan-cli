export type Assertion =
  | { type: 'url';     expected: string }
  | { type: 'visible'; selector: string }
  | { type: 'hidden';  selector: string }
  | { type: 'text';    selector: string; contains: string }
  | { type: 'count';   selector: string; expected: number }

export interface AssertionResult {
  assertion: Assertion
  passed: boolean
  actual?: string
}

export interface JsError {
  message: string
  stack: string
  /** React component names parsed from the stack trace (PascalCase entries) */
  components: string[]
}

export interface ApiError {
  url: string
  status: number
  method: string
}

export interface PageConfig {
  name: string;
  url: string;
  interactions?: PageInteraction[];
  assertions?: Assertion[];
}

export type ReporterProvider = 'github' | 'gitlab';

export interface RunnerConfig {
  projectName: string;
  baseUrl: string;
  pages?: PageConfig[];
  maxPages?: number;
  triggerCookie?: string;
  observeDuration?: number;
  threshold?: number;
  authSetup?: (page: import('playwright').Page) => Promise<void>;

  provider?: ReporterProvider;

  // GitHub
  githubToken?: string;
  issueRepo?: string;

  // GitLab
  gitlabToken?: string;
  gitlabProject?: string;
  gitlabBaseUrl?: string;
}

export interface ChangeDetail {
  type: string;
  name: string;
  prevValue?: string;
  value?: string;
}

export interface ComponentData {
  count: number;
  unnecessaryCount: number;
  totalTime: number;
  minFps: number | null;
  reasons: string[];
  changes: ChangeDetail[];
}

export interface PageInteraction {
  type: 'scroll' | 'click' | 'hover' | 'wait' | 'fill' | 'waitForSelector';
  selector?: string;
  scrollY?: number;
  waitMs?: number;
  value?: string;
  description?: string;
}

export interface IssueData {
  component: string;
  count: number;
  unnecessaryCount: number;
  avgTime: number | null;
  minFps: number | null;
  reasons: string[];
  changes: ChangeDetail[];
  severity: 'high' | 'medium' | 'low';
}

export interface PageReport {
  page: string;
  url: string;
  /** 重渲染问题 */
  issues: IssueData[];
  /** 代码报错 — uncaught JS exceptions */
  jsErrors: JsError[];
  /** 接口报错 — same-origin 4xx/5xx responses */
  apiErrors: ApiError[];
  /** 数据展示不全 — failed assertions */
  assertionFailures: AssertionResult[];
  /** 登录失败 — authSetup threw, or auth assertion failed */
  authFailure: string | null;
  screenshotBase64: string;
  observeDuration: number;
  timestamp: string;
}
