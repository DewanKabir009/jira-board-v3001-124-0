import {
  type ColumnDef,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable
} from "@tanstack/react-table";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";

type PullChange = string | {
  key?: string;
  issueKey?: string;
  issue?: { key?: string };
  url?: string;
  summary?: string;
  status?: string;
  updatedDisplay?: string;
  parent?: {
    key?: string;
    url?: string;
    summary?: string;
    description?: string;
    type?: string;
    status?: string;
    priority?: string;
  } | string | null;
  before?: string;
  after?: string;
  changes?: Array<{ field?: string; before?: string; after?: string; from?: string; to?: string }>;
};

type PullDiffEntry = {
  previousPulledAt?: string;
  currentPulledAt?: string;
  currentPulledAtDisplay?: string;
  previousPulledAtDisplay?: string;
  isBaseline?: boolean;
  added?: PullChange[];
  removed?: PullChange[];
  updated?: PullChange[];
  statusChanges?: PullChange[];
};

type Issue = {
  key?: string;
  url?: string;
  summary?: string;
  type?: string;
  isSubtask?: boolean;
  status?: string;
  priority?: string;
  assignee?: string;
  assigneeAvatarUrl?: string;
  assigneeAccountId?: string;
  assignedDeveloper?: string;
  assignedDeveloperAvatarUrl?: string;
  assignedDeveloperAccountId?: string;
  updated?: string;
  updatedDisplay?: string;
  components?: string[];
  parent?: { key?: string; summary?: string } | string | null;
  description?: string;
  descriptionHtml?: string;
  descriptionImageCount?: number;
  descriptionVideoCount?: number;
  descriptionMediaCount?: number;
  commentCount?: number;
  comments?: JiraComment[];
  lastCommentUrl?: string;
  lastCommentDisplay?: string;
  lastCommentAuthor?: string;
  testChecklist?: {
    files?: Array<{ filename?: string; id?: string }>;
    total?: number;
    testCases?: TestCase[];
  } | null;
};

type JiraComment = {
  id?: string;
  author?: string;
  authorAvatarUrl?: string;
  createdDisplay?: string;
  updatedDisplay?: string;
  url?: string;
  hasMedia?: boolean;
  mediaCount?: number;
  body?: string;
  bodyHtml?: string;
};

type TestCase = {
  id?: string;
  title?: string;
  category?: string;
  blocking?: boolean;
  description?: string;
  checks?: string[];
  sourceFile?: string;
};

type DashboardData = {
  version?: string;
  dashboardVersion?: string;
  repositorySlug?: string;
  dashboardUrl?: string;
  siteUrl?: string;
  jiraFilterUrl?: string;
  assigneeDispatchEndpoint?: string;
  assigneeOptions?: string[];
  testChecklistCommentEndpoint?: string;
  schemaVersion?: string;
  dataArtifact?: { fileName?: string };
  total?: number;
  pulledAt?: string;
  pulledAtDisplay?: string;
  pullDiff?: PullDiffEntry;
  pullHistory?: PullDiffEntry[];
  issues?: Issue[];
};

type BoardRegistryEntry = {
  release: string;
  fixVersion?: string;
  url: string;
  modernUrl?: string;
  repositorySlug?: string;
  status: "active" | "current" | "planned" | "archived" | string;
  owner: string;
  notes: string;
};

type BoardRegistryAutomation = {
  source?: string;
  hook?: string;
  provisioner?: string;
};

type BoardRegistry = {
  schemaVersion?: string;
  updatedAt?: string;
  owner?: string;
  boards?: BoardRegistryEntry[];
  automation?: BoardRegistryAutomation;
};

type ChangeSets = {
  added: Set<string>;
  updated: Set<string>;
  status: Set<string>;
  any: Set<string>;
};

type Filters = {
  search: string;
  status: string;
  assignee: string;
  priority: string;
  component: string;
  parent: string;
  changed: string;
};

type SelectOption = {
  value: string;
  label: string;
  avatarUrl?: string;
};

type FilterOptionSet = {
  statuses: SelectOption[];
  assignees: SelectOption[];
  priorities: SelectOption[];
  components: SelectOption[];
};

type PresetKey = "all" | "qa" | "review" | "moves" | "unassigned";

type ExplorerView = "cards" | "table";

type TicketGroup = {
  issue: Issue;
  subtasks: Issue[];
  visibleSubtasks: Issue[];
  matchedBySubtask: boolean;
};

type TicketSection = {
  status: string;
  groups: TicketGroup[];
};
type StatusSectionTheme = {
  bg: string;
  border: string;
  accent: string;
  text: string;
  chip: string;
};

type TicketColumn = {
  id: number;
  weight: number;
  sections: TicketSection[];
};

type JiraAdfMark = {
  type: string;
  attrs?: Record<string, string>;
};

type JiraAdfNode = {
  type: string;
  attrs?: Record<string, string | number | boolean>;
  content?: JiraAdfNode[];
  text?: string;
  marks?: JiraAdfMark[];
};

type JiraAdfDocument = JiraAdfNode & {
  type: "doc";
  version: 1;
  content: JiraAdfNode[];
};

type CommentEditorTool =
  | "heading2"
  | "heading3"
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "inlineCode"
  | "link"
  | "bulletList"
  | "orderedList"
  | "quote"
  | "codeBlock"
  | "rule";

type CommentEditorToolConfig = {
  id: CommentEditorTool;
  label: string;
  title: string;
};

type WorkspaceStatus = "draft" | "ready" | "submitting" | "submitted" | "failed";
type AssignmentStatus = "idle" | "submitting" | "submitted" | "failed";

type AssignmentRequestState = {
  status: AssignmentStatus;
  assignee: string;
  message: string;
  requestedAt?: string;
};

type ChecklistItem = {
  id: string;
  sourceId: string;
  sourceFile: string;
  manual: boolean;
  title: string;
  done: boolean;
  notes: string;
  description: string;
  checks: string[];
};

type ChecklistWorkspaceState = {
  items: ChecklistItem[];
  evidence: string;
  concerns: string;
  status: WorkspaceStatus;
  message: string;
  submittedAt: string;
};

type AnalyticsTone = "blue" | "green" | "amber" | "rose";

type DistributionRow = {
  label: string;
  value: number;
  share: number;
  tone: AnalyticsTone;
};

type ReleaseAnalytics = {
  issueTotal: number;
  mainTotal: number;
  subtaskTotal: number;
  changedTotal: number;
  assignees: DistributionRow[];
  priorities: DistributionRow[];
  components: DistributionRow[];
  insights: string[];
};

type HealthTone = "good" | "attention" | "warning" | "danger" | "neutral";

type HealthLink = {
  label: string;
  href: string;
};

type OperationsHealthItem = {
  title: string;
  status: string;
  detail: string;
  tone: HealthTone;
  links: HealthLink[];
};

type OperationsHealth = {
  summary: string;
  summaryTone: HealthTone;
  items: OperationsHealthItem[];
};

type BridgeButtonStatus = {
  label: string;
  tone: HealthTone;
};

type RefreshRequestState = {
  status: "idle" | "submitting" | "submitted" | "failed";
  message: string;
  requestedAt?: string;
  actionsUrl?: string;
};

type PlaywrightJobRequestState = {
  status: "idle" | "submitting" | "queued" | "running" | "completed" | "failed";
  message: string;
  requestedAt?: string;
  jobId?: string;
  actionsUrl?: string;
  statusUrl?: string;
  jobUrl?: string;
  currentStep?: string;
  artifacts?: Array<{ label?: string; type?: string; href?: string }>;
  failureReason?: string;
  failureLog?: string;
};

type PlaywrightArtifact = {
  label?: string;
  type?: string;
  href?: string;
};

type TicketSearchStatus = {
  message: string;
  tone: HealthTone;
  href?: string;
};

type JiraBridgeProject = {
  key?: string;
  name?: string;
};

const PAGE_SIZE_OPTIONS = [15, 25, 50];
const CARD_COLUMN_COUNT = 3;
const DEFAULT_ASSIGNABLE_ASSIGNEES = [
  "Dewan Kabir",
  "Nicole Greer",
  "Alex McNay",
  "Anton Yurkevich"
];
const COMMENT_EDITOR_TOOLS: CommentEditorToolConfig[] = [
  { id: "heading2", label: "H2", title: "Heading" },
  { id: "heading3", label: "H3", title: "Subheading" },
  { id: "bold", label: "B", title: "Bold" },
  { id: "italic", label: "I", title: "Italic" },
  { id: "underline", label: "U", title: "Underline" },
  { id: "strike", label: "S", title: "Strikethrough" },
  { id: "inlineCode", label: "</>", title: "Inline code" },
  { id: "link", label: "Link", title: "Link" },
  { id: "bulletList", label: "Bullets", title: "Bulleted list" },
  { id: "orderedList", label: "1.", title: "Numbered list" },
  { id: "quote", label: "Quote", title: "Quote" },
  { id: "codeBlock", label: "Code", title: "Code block" },
  { id: "rule", label: "Line", title: "Divider" }
];
const PLAYWRIGHT_SPEC_ITEMS = [
  {
    id: "pw-01",
    title: "Define the runner contract",
    status: "Complete",
    href: "../playwright-specs/runner-contract.html",
    detail: "Document the job payload, allowed script names, required parameters, and artifact fields before any execution endpoint is wired."
  },
  {
    id: "pw-02",
    title: "Stand up a protected Playwright runner",
    status: "Complete",
    href: "../playwright-specs/protected-runner.html",
    detail: "Host a Node runner behind Cloudflare Access with a locked script registry, no arbitrary code execution, and per-job audit records."
  },
  {
    id: "pw-03",
    title: "Queue jobs from the dashboard",
    status: "Complete",
    href: "../playwright-specs/dashboard-queue.html",
    detail: "Add a 123-only Run automation control that calls the bridge, starts a job, and returns a durable job id."
  },
  {
    id: "pw-04",
    title: "Stream observable progress",
    status: "Complete",
    href: "../playwright-specs/live-progress.html",
    detail: "Expose status, current step, logs, latest screenshot, and failure reason so users can watch the run without opening a terminal."
  },
  {
    id: "pw-05",
    title: "Publish final evidence",
    status: "Complete",
    href: "../playwright-specs/evidence-publishing.html",
    detail: "Attach final screenshot, video, trace zip, timing, and result summary back into the dashboard job record."
  },
  {
    id: "pw-06",
    title: "Gate production usage",
    status: "Complete",
    href: "../playwright-specs/production-gates.html",
    detail: "Require named users, fixed environments, rate limits, and rollback instructions before enabling more scripts."
  }
];
const PLAYWRIGHT_RESOURCE_LINKS = [
  { label: "Spec home", href: "../playwright-specs/" },
  { label: "Runner contract", href: "../playwright-specs/runner-contract.html" },
  { label: "Runner workflow", href: "https://github.com/DewanKabir009/jira-board-v3001-123-0/actions/workflows/run-playwright-job.yml" },
  { label: "Job schema", href: "../playwright-specs/job-contract.schema.json" },
  { label: "Script registry", href: "../playwright-specs/script-registry.json" }
];
const PLAYWRIGHT_SCRIPT_OPTIONS: SelectOption[] = [
  { value: "open-ticket-and-capture", label: "Open Jira ticket and capture evidence" },
  { value: "dashboard-regression-smoke", label: "Dashboard regression smoke" },
  { value: "golfnow-central-smoke", label: "GolfNow Central smoke check" }
];
const PLAYWRIGHT_ENVIRONMENT_OPTIONS: SelectOption[] = [
  { value: "dev", label: "DEV" },
  { value: "stg", label: "STG" },
  { value: "prod-readonly", label: "Prod read-only" }
];
const PLAYWRIGHT_PLAYBOOK_STEPS = [
  "Select an approved automation script from the registry.",
  "Review the ticket, target environment, and required credentials before starting the job.",
  "Start the job from the 123 dashboard and keep the job id visible.",
  "Watch live logs and screenshots; stop the run if it leaves the expected environment.",
  "Review video, trace, and final result before using the evidence in Jira.",
  "If the runner fails, keep the dashboard usable and link to the failed job artifacts."
];
const STATUS_ORDER = [
  "Blocked",
  "Pre Planning",
  "Analysis",
  "PO Review",
  "Code Review",
  "QA Testing (DEV)",
  "Pending Deployment (DEV)",
  "Closed"
];
const STATUS_SECTION_THEME_KEYS = ["neutral", "analysis", "dev", "regression", "qa", "staging", "prod", "blocked", "review", "other"] as const;
const STATUS_SECTION_THEMES: Record<typeof STATUS_SECTION_THEME_KEYS[number], StatusSectionTheme> = {
  neutral: { bg: "var(--status-neutral-bg)", border: "var(--status-neutral-border)", accent: "var(--status-neutral-accent)", text: "var(--status-neutral-text)", chip: "var(--status-neutral-chip)" },
  analysis: { bg: "var(--status-analysis-bg)", border: "var(--status-analysis-border)", accent: "var(--status-analysis-accent)", text: "var(--status-analysis-text)", chip: "var(--status-analysis-chip)" },
  dev: { bg: "var(--status-dev-bg)", border: "var(--status-dev-border)", accent: "var(--status-dev-accent)", text: "var(--status-dev-text)", chip: "var(--status-dev-chip)" },
  regression: { bg: "var(--status-regression-bg)", border: "var(--status-regression-border)", accent: "var(--status-regression-accent)", text: "var(--status-regression-text)", chip: "var(--status-regression-chip)" },
  qa: { bg: "var(--status-qa-bg)", border: "var(--status-qa-border)", accent: "var(--status-qa-accent)", text: "var(--status-qa-text)", chip: "var(--status-qa-chip)" },
  staging: { bg: "var(--status-staging-bg)", border: "var(--status-staging-border)", accent: "var(--status-staging-accent)", text: "var(--status-staging-text)", chip: "var(--status-staging-chip)" },
  prod: { bg: "var(--status-prod-bg)", border: "var(--status-prod-border)", accent: "var(--status-prod-accent)", text: "var(--status-prod-text)", chip: "var(--status-prod-chip)" },
  blocked: { bg: "var(--status-blocked-bg)", border: "var(--status-blocked-border)", accent: "var(--status-blocked-accent)", text: "var(--status-blocked-text)", chip: "var(--status-blocked-chip)" },
  review: { bg: "var(--status-review-bg)", border: "var(--status-review-border)", accent: "var(--status-review-accent)", text: "var(--status-review-text)", chip: "var(--status-review-chip)" },
  other: { bg: "var(--status-other-bg)", border: "var(--status-other-border)", accent: "var(--status-other-accent)", text: "var(--status-other-text)", chip: "var(--status-other-chip)" }
};

const EMPTY_FILTERS: Filters = {
  search: "",
  status: "",
  assignee: "",
  priority: "",
  component: "",
  parent: "",
  changed: ""
};

export default function TicketExplorerIsland({ dataUrl, boardRegistryUrl }: { dataUrl: string; boardRegistryUrl: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [boardRegistry, setBoardRegistry] = useState<BoardRegistry | null>(null);
  const [loadError, setLoadError] = useState("");
  const [registryError, setRegistryError] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [activePreset, setActivePreset] = useState<PresetKey>("all");
  const [explorerView, setExplorerView] = useState<ExplorerView>("cards");
  const [openSubtaskParents, setOpenSubtaskParents] = useState<Set<string>>(new Set());
  const [collapsedCardStatuses, setCollapsedCardStatuses] = useState<Set<string>>(new Set());
  const [componentListCopied, setComponentListCopied] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [dialogIssueKey, setDialogIssueKey] = useState("");
  const [lookupDialogIssue, setLookupDialogIssue] = useState<Issue | null>(null);
  const [ticketSearchProject, setTicketSearchProject] = useState("");
  const [ticketSearchNumber, setTicketSearchNumber] = useState("");
  const [ticketSearchStatus, setTicketSearchStatus] = useState<TicketSearchStatus>({ message: "", tone: "neutral" });
  const [ticketSearchBusy, setTicketSearchBusy] = useState(false);
  const [refreshRequest, setRefreshRequest] = useState<RefreshRequestState>({ status: "idle", message: "" });
  const [jiraBridgeProjects, setJiraBridgeProjects] = useState<SelectOption[]>([]);
  const [assignmentStateByKey, setAssignmentStateByKey] = useState<Record<string, AssignmentRequestState>>({});
  const [sorting, setSorting] = useState<SortingState>([{ id: "updatedDisplay", desc: true }]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    let cancelled = false;

    fetchDashboardData(dataUrl)
      .then((payload) => {
        if (!cancelled) {
          setData(payload);
          setLoadError("");
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setLoadError(error.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dataUrl]);

  useEffect(() => {
    let cancelled = false;

    fetchBoardRegistry(boardRegistryUrl)
      .then((payload) => {
        if (!cancelled) {
          setBoardRegistry(payload);
          setRegistryError("");
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setBoardRegistry(null);
          setRegistryError(error.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [boardRegistryUrl]);

  const issues = useMemo(() => data?.issues ?? [], [data]);
  const changeSets = useMemo(() => createChangeSets(data), [data]);
  const options = useMemo(() => createFilterOptions(issues), [issues]);
  const operationsHealth = useMemo(() => buildOperationsHealth(data, loadError), [data, loadError]);
  const cutoverValidation = useMemo(() => buildCutoverValidation(data, boardRegistry, loadError), [data, boardRegistry, loadError]);
  const analytics = useMemo(() => buildReleaseAnalytics(data, issues, changeSets), [data, issues, changeSets]);
  const componentCounts = useMemo(() => buildComponentCounts(issues), [issues]);
  const assignableAssigneeOptions = useMemo(() => createAssignableAssigneeOptions(data, issues), [data, issues]);
  const bridgeButton = useMemo(() => bridgeButtonStatus(data), [data]);
  const jiraProjectOptions = useMemo(() => createJiraProjectOptions(issues, jiraBridgeProjects), [issues, jiraBridgeProjects]);

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => matchesFilters(issue, filters, changeSets, activePreset));
  }, [issues, filters, changeSets, activePreset]);
  const ticketGroups = useMemo(() => {
    return groupIssuesForCards(issues, filters, changeSets, activePreset);
  }, [issues, filters, changeSets, activePreset]);
  const visibleSubtaskCount = useMemo(() => {
    return ticketGroups.reduce((total, group) => total + group.visibleSubtasks.length, 0);
  }, [ticketGroups]);

  function setAssignmentState(issueKey: string, next: AssignmentRequestState) {
    setAssignmentStateByKey((current) => ({
      ...current,
      [issueKey]: next
    }));
  }

  function updateIssueAssignee(issueKey: string, assignee: string) {
    const option = assignableAssigneeOptions.find((item) => item.value === assignee);
    setData((current) => {
      if (!current?.issues) {
        return current;
      }

      return {
        ...current,
        issues: current.issues.map((issue) => issue.key === issueKey ? {
          ...issue,
          assignee,
          assigneeAvatarUrl: option?.avatarUrl || issue.assigneeAvatarUrl
        } : issue)
      };
    });
  }

  async function submitAssigneeChange(issue: Issue, assignee: string) {
    const issueKey = issue.key || "";
    const endpoint = data?.assigneeDispatchEndpoint || "";

    if (!issueKey) {
      return;
    }

    if (!endpoint) {
      setAssignmentState(issueKey, {
        status: "failed",
        assignee,
        message: "No Cloudflare assignee bridge is configured for this board."
      });
      return;
    }

    setAssignmentState(issueKey, {
      status: "submitting",
      assignee,
      message: "Starting secure assignee workflow..."
    });

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        credentials: "include",
        body: JSON.stringify({
          issueKey,
          assigneeDisplayName: assignee,
          releaseVersion: data?.version || "",
          repositorySlug: data?.repositorySlug || "",
          dashboardUrl: data?.dashboardUrl || (typeof window === "undefined" ? "" : window.location.href),
          requestedAt: new Date().toISOString()
        })
      });
      const payload = await response.json().catch(() => ({
        ok: false,
        message: "The dispatch bridge returned an unreadable response."
      }));

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.message || payload?.error || "The dispatch bridge rejected the request.");
      }

      updateIssueAssignee(issueKey, assignee);
      setAssignmentState(issueKey, {
        status: "submitted",
        assignee,
        requestedAt: new Date().toISOString(),
        message: "Workflow started. Jira and this board will refresh shortly."
      });
    } catch (error) {
      setAssignmentState(issueKey, {
        status: "failed",
        assignee,
        message: isHostedBridgeEndpoint(endpoint)
          ? "Cloudflare login is required. Open the bridge link, then retry."
          : error instanceof Error ? error.message : "Assignee workflow could not be started."
      });
      console.error(error);
    }
  }

  const columns = useMemo<ColumnDef<Issue>[]>(() => [
    {
      id: "key",
      header: "Ticket",
      accessorFn: (issue) => issue.key || "",
      cell: ({ row }) => (
        <div className="ticket-cell">
          <a className="table-ticket-key" href={row.original.url || "#"} target="_blank" rel="noreferrer">
            {row.original.key || "Ticket"}
          </a>
          <IssueTypePill issue={row.original} />
        </div>
      )
    },
    {
      id: "summary",
      header: "Summary",
      accessorFn: (issue) => issue.summary || "",
      cell: ({ row }) => (
        <button
          className="summary-button"
          type="button"
          onClick={() => setSelectedKey(row.original.key || "")}
          aria-label={`Open details for ${row.original.key || "ticket"}: ${row.original.summary || "Untitled ticket"}`}
        >
          {row.original.summary || "Untitled ticket"}
        </button>
      )
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (issue) => issue.status || "",
      cell: ({ getValue }) => <span className="status-pill">{String(getValue() || "None")}</span>
    },
    {
      id: "people",
      header: "People",
      accessorFn: (issue) => `${issue.assignee || "Unassigned"} ${issue.assignedDeveloper || "Unassigned"}`,
      cell: ({ row }) => <PeopleStack issue={row.original} />
    },
    {
      id: "priority",
      header: "Priority",
      accessorFn: (issue) => issue.priority || "None",
      cell: ({ getValue }) => <span className="priority-pill">{String(getValue() || "None")}</span>
    },
    {
      id: "components",
      header: "Components",
      accessorFn: (issue) => formatComponents(issue.components),
      cell: ({ row }) => <span className="component-text">{formatComponents(row.original.components)}</span>
    },
    {
      id: "parent",
      header: "Parent",
      accessorFn: (issue) => parentLabel(issue),
      cell: ({ row }) => <span className="muted-cell">{parentLabel(row.original) || (row.original.isSubtask ? "Subtask" : "Main")}</span>
    },
    {
      id: "updatedDisplay",
      header: "Updated",
      accessorFn: (issue) => issue.updatedDisplay || "",
      cell: ({ getValue }) => <span className="muted-cell">{String(getValue() || "Unknown")}</span>
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="row-actions">
          <AssigneeAssignmentControl
            issue={row.original}
            options={assignableAssigneeOptions}
            request={assignmentStateByKey[row.original.key || ""]}
            onAssign={submitAssigneeChange}
            compact
          />
          <a href={row.original.url || "#"} target="_blank" rel="noreferrer">Jira</a>
          <button type="button" onClick={() => openTicketDialog(row.original.key || "")} aria-label={`Show details for ${row.original.key || "ticket"}`}>Details</button>
        </div>
      )
    }
  ], [assignableAssigneeOptions, assignmentStateByKey, data]);

  const table = useReactTable({
    data: filteredIssues,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel()
  });

  useEffect(() => {
    let cancelled = false;
    const endpoint = bridgeProjectsEndpoint(data);

    if (!endpoint) {
      setJiraBridgeProjects([]);
      return () => {
        cancelled = true;
      };
    }

    fetch(endpoint, {
      credentials: "include",
      headers: { Accept: "application/json" }
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.message || "Jira projects are not available from the bridge.");
        }
        return Array.isArray(payload.projects) ? payload.projects : [];
      })
      .then((projects: JiraBridgeProject[]) => {
        if (!cancelled) {
          setJiraBridgeProjects(projectsToSelectOptions(projects));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setJiraBridgeProjects([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [data?.assigneeDispatchEndpoint]);

  const orderedTicketGroups = useMemo(() => (
    explorerView === "table" ? [...ticketGroups].sort(compareTicketGroups) : ticketGroups
  ), [explorerView, ticketGroups]);
  const tablePageCount = Math.max(1, Math.ceil(orderedTicketGroups.length / pageSize));
  const cardPageCount = Math.max(1, Math.ceil(orderedTicketGroups.length / pageSize));
  const pageCount = explorerView === "cards" ? cardPageCount : tablePageCount;
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const visibleTicketGroups = orderedTicketGroups.slice(safePageIndex * pageSize, safePageIndex * pageSize + pageSize);
  const selectedLookupIssue = lookupDialogIssue?.key === selectedKey ? lookupDialogIssue : undefined;
  const selectedIssue = issues.find((issue) => issue.key === selectedKey)
    || selectedLookupIssue
    || orderedTicketGroups[0]?.issue
    || filteredIssues[0]
    || issues[0];
  const dialogIssue = dialogIssueKey
    ? issues.find((issue) => issue.key === dialogIssueKey)
      || (lookupDialogIssue?.key === dialogIssueKey ? lookupDialogIssue : undefined)
    : undefined;

  useEffect(() => {
    setPageIndex(0);
  }, [filters, pageSize, explorerView]);

  useEffect(() => {
    if (!ticketSearchProject && jiraProjectOptions.length) {
      setTicketSearchProject(jiraProjectOptions[0].value);
    }
  }, [jiraProjectOptions, ticketSearchProject]);

  useEffect(() => {
    if (selectedIssue?.key && selectedIssue.key !== selectedKey) {
      setSelectedKey(selectedIssue.key);
    }
  }, [selectedIssue, selectedKey]);

  function updateFilter(name: keyof Filters, value: string) {
    setFilters((current) => ({ ...current, [name]: value }));
    setActivePreset("all");
  }

  function applyPreset(preset: PresetKey) {
    setActivePreset(preset);
    setFilters(presetFilters(preset));
  }

  function toggleSubtasks(parentKey: string) {
    setOpenSubtaskParents((current) => {
      const next = new Set(current);
      if (next.has(parentKey)) {
        next.delete(parentKey);
      } else {
        next.add(parentKey);
      }
      return next;
    });
  }

  function toggleCardStatus(status: string) {
    setCollapsedCardStatuses((current) => {
      const next = new Set(current);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  }

  function openTicketDialog(key: string) {
    if (!key) {
      return;
    }

    setLookupDialogIssue(null);
    setSelectedKey(key);
    setDialogIssueKey(key);
  }

  const closeTicketDialog = useCallback(() => {
    setDialogIssueKey("");
  }, []);

  function copyComponentList() {
    const value = componentCounts.map((entry) => `- ${entry[0]}`).join("\n");
    copyTextToClipboard(value).then(() => {
      setComponentListCopied(true);
      window.setTimeout(() => setComponentListCopied(false), 1400);
    });
  }

  async function searchJiraTicket() {
    const ticketKey = normalizeTicketSearchKey(ticketSearchProject || jiraProjectOptions[0]?.value || "CORE", ticketSearchNumber);

    if (!ticketKey) {
      setTicketSearchStatus({
        message: "Enter a ticket number or a full ticket key.",
        tone: "warning"
      });
      return;
    }

    const jiraHref = jiraTicketUrl(data, issues, ticketKey);
    setTicketSearchBusy(true);
    setTicketSearchStatus({
      message: `Searching Jira for ${ticketKey}...`,
      tone: "neutral"
    });

    try {
      const bridgeIssue = await fetchJiraIssueFromBridge(data, ticketKey);
      if (bridgeIssue) {
        setLookupDialogIssue(bridgeIssue);
        setSelectedKey(bridgeIssue.key || ticketKey);
        setDialogIssueKey(bridgeIssue.key || ticketKey);
        setTicketSearchStatus({
          message: `${bridgeIssue.key || ticketKey} opened from Jira.`,
          tone: "good",
          href: bridgeIssue.url || jiraHref
        });
        return;
      }
    } catch (error) {
      const foundIssue = findTicketInSnapshot(issues, ticketKey);
      if (foundIssue) {
        setLookupDialogIssue(foundIssue);
        setSelectedKey(foundIssue.key || ticketKey);
        setDialogIssueKey(foundIssue.key || ticketKey);
        setTicketSearchStatus({
          message: `${foundIssue.key || ticketKey} opened from the board snapshot. Jira bridge lookup is not available yet: ${error instanceof Error ? error.message : "unknown bridge error"}`,
          tone: "attention",
          href: foundIssue.url || jiraHref
        });
        return;
      }

      setTicketSearchStatus({
        message: `${ticketKey} could not be loaded from Jira yet. ${error instanceof Error ? error.message : "The Jira bridge lookup failed."}`,
        tone: "warning",
        href: isHostedBridgeEndpoint(data?.assigneeDispatchEndpoint || "") ? bridgeEntryUrl(data) : jiraHref
      });
      return;
    } finally {
      setTicketSearchBusy(false);
    }

    const foundIssue = findTicketInSnapshot(issues, ticketKey);

    if (!foundIssue) {
      setTicketSearchStatus({
        message: `${ticketKey} is not in this board snapshot yet. Open it directly in Jira or refresh the board data after it is added to this release.`,
        tone: "attention",
        href: jiraHref
      });
      return;
    }

    setLookupDialogIssue(foundIssue);
    setSelectedKey(foundIssue.key || ticketKey);
    setDialogIssueKey(foundIssue.key || ticketKey);
    setTicketSearchStatus({
      message: `${foundIssue.key || ticketKey} opened from the loaded Jira snapshot.`,
      tone: "good",
      href: foundIssue.url || jiraHref
    });
  }

  async function requestTicketRefresh() {
    const endpoint = bridgeRefreshEndpoint(data);
    const requestedAt = new Date().toISOString();

    if (!endpoint) {
      setRefreshRequest({
        status: "failed",
        message: "No Cloudflare refresh bridge is configured for this board.",
        requestedAt
      });
      return;
    }

    setRefreshRequest({
      status: "submitting",
      message: "Starting the Jira ticket refresh workflow...",
      requestedAt
    });

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        credentials: "include",
        body: JSON.stringify({
          releaseVersion: data?.version || "",
          repositorySlug: data?.repositorySlug || "",
          dashboardUrl: data?.dashboardUrl || (typeof window === "undefined" ? "" : window.location.href),
          requestedAt
        })
      });
      const payload = await response.json().catch(() => ({
        ok: false,
        message: "The refresh bridge returned an unreadable response."
      }));

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.message || payload?.error || "The refresh bridge rejected the request.");
      }

      setRefreshRequest({
        status: "submitted",
        message: payload.message || "Refresh workflow started. The board will update after GitHub Pages republishes.",
        requestedAt,
        actionsUrl: payload.actionsUrl || (data?.repositorySlug ? workflowUrl(data.repositorySlug, "refresh-jira-board.yml") : "")
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Refresh workflow could not be started.";
      setRefreshRequest({
        status: "failed",
        message: isHostedBridgeEndpoint(data?.assigneeDispatchEndpoint || "") && /failed to fetch|unreadable|load failed|network/i.test(errorMessage)
          ? "Cloudflare login is required. Open the bridge link, then retry."
          : errorMessage,
        requestedAt,
        actionsUrl: data?.repositorySlug ? workflowUrl(data.repositorySlug, "refresh-jira-board.yml") : ""
      });
      console.error(error);
    }
  }

  return (
    <main className={`dashboard-shell modern-explorer-shell ${explorerView === "table" ? "table-shell" : ""}`}>
      <section className="board-hero" aria-labelledby="board-title">
        <div className="board-identity">
          <p className="eyebrow">Release dashboard</p>
          <h1 id="board-title">{data?.version || "Loading board"}</h1>
          <p className="board-summary">
            {data
              ? `${data.repositorySlug || "Jira release board"} rendered from ${data.dataArtifact?.fileName || "dashboard-data.json"}.`
              : "Reading the published dashboard data artifact."}
          </p>
          <div className="hero-actions" aria-label="Board links">
            <a className="button-link primary" href={data?.dashboardUrl || "../"}>Current board</a>
            <a className="button-link icon-link" href={data?.jiraFilterUrl || "#"} target="_blank" rel="noreferrer">
              <JiraLogoIcon />
              <span>Jira filter</span>
            </a>
            <a className={`button-link icon-link bridge-link ${bridgeButton.tone}`} href={bridgeEntryUrl(data)} target="_blank" rel="noreferrer">
              <CloudflareLogoIcon />
              <span>Cloudflare bridge</span>
              <span className="bridge-status-indicator" aria-label={`Bridge status: ${bridgeButton.label}`}>
                <span className="bridge-status-dot" aria-hidden="true" />
                <span>{bridgeButton.label}</span>
              </span>
            </a>
          </div>
        </div>

        <dl className="metric-grid" aria-label="Board metadata">
          <Metric label="Total tickets" value={String(data?.total ?? issues.length)} />
          <Metric label="Last pull" value={data?.pullDiff?.currentPulledAtDisplay || data?.pulledAtDisplay || "Pending"} />
          <Metric label="Shown now" value={`${filteredIssues.length}`} />
          <Metric label="Changed" value={`${changeSets.any.size}`} />
        </dl>
      </section>

      <BoardRegistryDirectory registry={boardRegistry} registryError={registryError} currentVersion={data?.version} />

      <ComponentInventory
        components={componentCounts}
        total={issues.length}
        activeComponent={filters.component}
        copied={componentListCopied}
        onSelectComponent={(component) => updateFilter("component", component)}
        onCopy={copyComponentList}
      />

      <ReleaseAnalyticsBand analytics={analytics} />

      <section className="explorer-panel" aria-labelledby="explorer-heading">
        <div className="explorer-toolbar">
          <div>
            <p className="eyebrow">Ticket explorer island</p>
            <h2 id="explorer-heading">Ticket board</h2>
          </div>
          <div className="explorer-toolbar-actions">
            <ViewToggle
              value={explorerView}
              onChange={setExplorerView}
              refresh={refreshRequest}
              refreshDisabled={!data || refreshRequest.status === "submitting"}
              onRefresh={requestTicketRefresh}
            />
            <div className="preset-group" aria-label="Saved views">
              <PresetButton label="All" active={activePreset === "all"} onClick={() => applyPreset("all")} />
              <PresetButton label="QA testing" active={activePreset === "qa"} onClick={() => applyPreset("qa")} />
              <PresetButton label="Code review" active={activePreset === "review"} onClick={() => applyPreset("review")} />
              <PresetButton label="Status moves" active={activePreset === "moves"} onClick={() => applyPreset("moves")} />
              <PresetButton label="Unassigned" active={activePreset === "unassigned"} onClick={() => applyPreset("unassigned")} />
            </div>
          </div>
        </div>

        <JiraTicketSearch
          projectOptions={jiraProjectOptions}
          project={ticketSearchProject}
          ticketNumber={ticketSearchNumber}
          status={ticketSearchStatus}
          busy={ticketSearchBusy}
          onProjectChange={setTicketSearchProject}
          onTicketNumberChange={setTicketSearchNumber}
          onSubmit={searchJiraTicket}
        />

        <div className="explorer-filters" aria-label="Ticket filters">
          <label>
            <span>Search</span>
            <input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Ticket, summary, assignee, developer, component" />
          </label>
          <SelectFilter label="Status" value={filters.status} options={options.statuses} onChange={(value) => updateFilter("status", value)} />
          <SelectFilter label="Assignee" value={filters.assignee} options={options.assignees} onChange={(value) => updateFilter("assignee", value)} showAvatars />
          <SelectFilter label="Priority" value={filters.priority} options={options.priorities} onChange={(value) => updateFilter("priority", value)} />
          <SelectFilter label="Component" value={filters.component} options={options.components} onChange={(value) => updateFilter("component", value)} />
          <SelectFilter
            label="Parent"
            value={filters.parent}
            options={[
              { value: "main", label: "Main tickets" },
              { value: "subtasks", label: "Subtasks" },
              { value: "has-parent", label: "Has parent" }
            ]}
            allLabel="All work"
            onChange={(value) => updateFilter("parent", value)}
          />
          <SelectFilter
            label="Changed"
            value={filters.changed}
            options={[
              { value: "any", label: "Any change" },
              { value: "added", label: "Added" },
              { value: "updated", label: "Updated" },
              { value: "status", label: "Status moved" }
            ]}
            allLabel="Any snapshot state"
            onChange={(value) => updateFilter("changed", value)}
          />
        </div>

        {loadError ? <p className="load-error">{loadError}</p> : null}

        <div className={explorerView === "cards" ? "explorer-body cards-mode" : "explorer-body table-mode"}>
          <div className={explorerView === "cards" ? "table-card ticket-board-card" : "table-card"}>
            <div className="table-summary">
              <span>
                {explorerView === "cards"
                  ? `${ticketGroups.length} main tickets / ${visibleSubtaskCount} subtasks`
                  : `${ticketGroups.length} main tickets / ${visibleSubtaskCount} subtasks`}
              </span>
              <SelectFilter
                label="Rows"
                value={String(pageSize)}
                options={PAGE_SIZE_OPTIONS.map((value) => ({ value: String(value), label: String(value) }))}
                includeAll={false}
                onChange={(value) => setPageSize(Number(value))}
              />
            </div>
            {explorerView === "cards" ? (
              <TicketCardView
                groups={visibleTicketGroups}
                selectedKey={selectedIssue?.key || ""}
                changeSets={changeSets}
                openSubtaskParents={openSubtaskParents}
                collapsedStatuses={collapsedCardStatuses}
                assignmentOptions={assignableAssigneeOptions}
                assignmentStates={assignmentStateByKey}
                onSelectTicket={openTicketDialog}
                onAssign={submitAssigneeChange}
                onToggleSubtasks={toggleSubtasks}
                onToggleStatus={toggleCardStatus}
              />
            ) : (
              <TicketTableView
                groups={visibleTicketGroups}
                selectedKey={selectedIssue?.key || ""}
                changeSets={changeSets}
                openSubtaskParents={openSubtaskParents}
                assignmentOptions={assignableAssigneeOptions}
                assignmentStates={assignmentStateByKey}
                onSelectTicket={(key) => setSelectedKey(key)}
                onOpenTicket={openTicketDialog}
                onAssign={submitAssigneeChange}
                onToggleSubtasks={toggleSubtasks}
              />
            )}
            <div className="pagination-bar">
              <button type="button" disabled={safePageIndex === 0} onClick={() => setPageIndex((value) => Math.max(0, value - 1))}>Previous</button>
              <span>Page {safePageIndex + 1} of {pageCount}</span>
              <button type="button" disabled={safePageIndex >= pageCount - 1} onClick={() => setPageIndex((value) => Math.min(pageCount - 1, value + 1))}>Next</button>
            </div>
          </div>

          <TicketDetail
            issue={selectedIssue}
            data={data}
            changeSets={changeSets}
            assignmentOptions={assignableAssigneeOptions}
            assignmentRequest={assignmentStateByKey[selectedIssue?.key || ""]}
            onAssign={submitAssigneeChange}
          />
        </div>
      </section>

      {isPlaywrightPilotBoard(data) ? <PlaywrightAutomationPlaybook data={data} /> : null}

      <DataPullSection data={data} loadError={loadError} />

      <OperationsHealthCenter health={operationsHealth} />

      <CutoverValidationPanel validation={cutoverValidation} />

      <details className="migration-rollout-details">
        <summary>
          <span>Rollout readiness and fallback notes</span>
          <span>Migration reference</span>
        </summary>
        <RolloutReadiness data={data} registry={boardRegistry} />
      </details>

      <TicketDetailDialog
        issue={dialogIssue}
        data={data}
        changeSets={changeSets}
        assignmentOptions={assignableAssigneeOptions}
        assignmentRequest={assignmentStateByKey[dialogIssue?.key || ""]}
        onAssign={submitAssigneeChange}
        onClose={closeTicketDialog}
      />
    </main>
  );
}

function ViewToggle({
  value,
  onChange,
  refresh,
  refreshDisabled,
  onRefresh
}: {
  value: ExplorerView;
  onChange: (value: ExplorerView) => void;
  refresh: RefreshRequestState;
  refreshDisabled: boolean;
  onRefresh: () => void;
}) {
  const refreshLabel = refresh.status === "submitting" ? "Refreshing" : "Refresh tickets";

  return (
    <div className="view-toggle" aria-label="View">
      <span>View</span>
      <div className="view-toggle-buttons">
        <button
          type="button"
          className={value === "cards" ? "view-toggle-button active" : "view-toggle-button"}
          aria-pressed={value === "cards"}
          onClick={() => onChange("cards")}
        >
          Cards
        </button>
        <button
          type="button"
          className={value === "table" ? "view-toggle-button active" : "view-toggle-button"}
          aria-pressed={value === "table"}
          onClick={() => onChange("table")}
        >
          Table
        </button>
      </div>
      <button
        type="button"
        className={`view-refresh-button ${refresh.status}`}
        onClick={onRefresh}
        disabled={refreshDisabled}
        aria-live="polite"
      >
        <RefreshIcon spinning={refresh.status === "submitting"} />
        <span>{refreshLabel}</span>
      </button>
      {refresh.message ? (
        <span className={`view-refresh-status ${refresh.status}`}>
          {refresh.message}
          {refresh.actionsUrl ? (
            <a href={refresh.actionsUrl} target="_blank" rel="noreferrer">Actions</a>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg className={spinning ? "refresh-icon spinning" : "refresh-icon"} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20 11.2a8.2 8.2 0 0 0-14.1-5.1L4.2 7.8V3H3v7h7V8.8H5.1l1.7-1.7a7 7 0 0 1 12 4.2h1.2Zm-16 1.6A8.2 8.2 0 0 0 18.1 18l1.7-1.7V21H21v-7h-7v1.2h4.9l-1.7 1.7a7 7 0 0 1-12-4.2H4Z" fill="currentColor" />
    </svg>
  );
}

function JiraLogoIcon() {
  return (
    <svg className="button-icon jira-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2.8 21.2 12 12 21.2 2.8 12 12 2.8Z" fill="url(#jira-icon-gradient)" />
      <path d="M12 7.1 16.9 12 12 16.9 7.1 12 12 7.1Z" fill="#ffffff" opacity="0.92" />
      <path d="M12 4.8 19.2 12 15.8 15.4 8.6 8.2 12 4.8Z" fill="#2684ff" opacity="0.92" />
      <path d="M8.2 8.6 15.4 15.8 12 19.2 4.8 12 8.2 8.6Z" fill="#0052cc" opacity="0.9" />
      <defs>
        <linearGradient id="jira-icon-gradient" x1="3" x2="21" y1="3" y2="21" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2684ff" />
          <stop offset="1" stopColor="#0052cc" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function CloudflareLogoIcon() {
  return (
    <svg className="button-icon cloudflare-icon" viewBox="0 0 28 20" aria-hidden="true" focusable="false">
      <path d="M9.9 17.5h11.8c2.5 0 4.6-2 4.6-4.5s-2-4.5-4.5-4.5h-.8C20.2 4.8 17 2 13.2 2 9 2 5.5 5.3 5.2 9.4 3.1 9.8 1.6 11.5 1.6 13.5c0 2.2 1.8 4 4.1 4h4.2Z" fill="url(#cloudflare-icon-gradient)" />
      <path d="M10.1 17.5h11.5c2.5 0 4.7-1.9 4.7-4.5 0-1.1-.4-2.1-1.1-2.9-2.1 5.4-8.4 6-15.1 7.4Z" fill="#faae40" opacity="0.75" />
      <defs>
        <linearGradient id="cloudflare-icon-gradient" x1="2" x2="27" y1="2" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#faae40" />
          <stop offset="0.52" stopColor="#f58220" />
          <stop offset="1" stopColor="#d85c00" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function JiraTicketSearch({
  projectOptions,
  project,
  ticketNumber,
  status,
  busy,
  onProjectChange,
  onTicketNumberChange,
  onSubmit
}: {
  projectOptions: SelectOption[];
  project: string;
  ticketNumber: string;
  status: TicketSearchStatus;
  busy: boolean;
  onProjectChange: (value: string) => void;
  onTicketNumberChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
}) {
  return (
    <form
      className="jira-ticket-search"
      aria-label="Jira ticket search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="jira-ticket-search-title">
        <JiraLogoIcon />
        <div>
          <p className="eyebrow">Jira ticket search</p>
          <h3>Open ticket details</h3>
        </div>
      </div>
      <div className="jira-ticket-search-controls">
        <SelectFilter
          label="Project"
          value={project}
          options={projectOptions}
          includeAll={false}
          allLabel="Project"
          onChange={onProjectChange}
        />
        <label>
          <span>Ticket number</span>
          <input
            value={ticketNumber}
            inputMode="numeric"
            placeholder="14474 or CORE-14474"
            onChange={(event) => onTicketNumberChange(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>{busy ? "Searching" : "Search Jira"}</button>
      </div>
      {status.message ? (
        <p className={`jira-ticket-search-status ${status.tone}`} role="status">
          <span>{status.message}</span>
          {status.href ? <a href={status.href} target="_blank" rel="noreferrer">Open Jira</a> : null}
        </p>
      ) : null}
    </form>
  );
}

function ComponentInventory({
  components,
  total,
  activeComponent,
  copied,
  onSelectComponent,
  onCopy
}: {
  components: Array<[string, number]>;
  total: number;
  activeComponent: string;
  copied: boolean;
  onSelectComponent: (component: string) => void;
  onCopy: () => void;
}) {
  return (
    <section className="components-panel" aria-labelledby="components-heading">
      <div className="components-heading">
        <div>
          <p className="eyebrow">Fix version components</p>
          <h2 id="components-heading">Component inventory</h2>
        </div>
        <button
          type="button"
          className={copied ? "copy-list-button copied" : "copy-list-button"}
          onClick={onCopy}
          disabled={!components.length}
        >
          {copied ? "Copied" : "Copy list"}
        </button>
      </div>
      <div className="component-chip-row" aria-label="Components in this fix version">
        <button
          type="button"
          className={!activeComponent ? "component-chip active" : "component-chip"}
          onClick={() => onSelectComponent("")}
        >
          <span>All components</span>
          <strong>{total}</strong>
        </button>
        {components.map(([component, count]) => (
          <button
            type="button"
            className={activeComponent === component ? "component-chip active" : "component-chip"}
            key={component}
            onClick={() => onSelectComponent(component)}
          >
            <span>{component}</span>
            <strong>{count}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

function PlaywrightAutomationPlaybook({ data }: { data: DashboardData | null }) {
  const storageKey = `playwright-automation-playbook:${data?.repositorySlug || data?.version || "v3001.123.0"}`;
  const defaultCompletedIds = PLAYWRIGHT_SPEC_ITEMS
    .filter((item) => item.status.toLowerCase() === "complete")
    .map((item) => item.id);
  const [loaded, setLoaded] = useState(false);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [scriptId, setScriptId] = useState(PLAYWRIGHT_SCRIPT_OPTIONS[0].value);
  const [environment, setEnvironment] = useState("dev");
  const [ticketKey, setTicketKey] = useState("");
  const [job, setJob] = useState<PlaywrightJobRequestState>({
    status: "idle",
    message: "Ready to queue an approved Playwright job."
  });
  const [completionNotice, setCompletionNotice] = useState("");
  const [failureNotice, setFailureNotice] = useState("");
  const [artifactPreview, setArtifactPreview] = useState<PlaywrightArtifact | null>(null);
  const notifiedPlaywrightJobId = useRef("");
  const notifiedPlaywrightFailureId = useRef("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      const parsed = stored ? JSON.parse(stored) : defaultCompletedIds;
      const completedIds = new Set(defaultCompletedIds);
      if (Array.isArray(parsed)) {
        parsed.map(String).forEach((itemId) => completedIds.add(itemId));
      }
      setCompleted(completedIds);
    } catch {
      setCompleted(new Set(defaultCompletedIds));
    }
    setLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    if (!ticketKey && data?.issues?.length) {
      const firstMain = data.issues.find((issue) => !issue.isSubtask && issue.key) || data.issues.find((issue) => issue.key);
      setTicketKey(firstMain?.key || "");
    }
  }, [data?.issues, ticketKey]);

  useEffect(() => {
    if (!job.statusUrl || job.status === "completed" || job.status === "failed") {
      return undefined;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(job.statusUrl || "", {
          cache: "no-store",
          credentials: "include",
          headers: { Accept: "application/json" }
        });
        if (!response.ok) {
          return;
        }
        const summary = await response.json();
        if (!cancelled) {
          setJob((current) => mergePlaywrightJobSummary(current, summary));
        }
      } catch {
        // The job summary is published asynchronously by GitHub Pages.
      }
    };

    poll();
    const interval = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [job.status, job.statusUrl]);

  useEffect(() => {
    if (job.status !== "completed" || !job.jobId || notifiedPlaywrightJobId.current === job.jobId) {
      return;
    }

    notifiedPlaywrightJobId.current = job.jobId;
    const message = `Results are ready for ${job.jobId}. Open View Results, Screenshot, or Video.`;
    setCompletionNotice(message);

    if (typeof window !== "undefined" && "Notification" in window && window.Notification.permission === "granted") {
      new window.Notification("Playwright automation complete", { body: message });
    }
  }, [job.jobId, job.status]);

  useEffect(() => {
    if (job.status !== "failed") {
      return;
    }

    const failureKey = job.jobId || `${job.requestedAt || ""}:${job.message}`;
    if (!failureKey || notifiedPlaywrightFailureId.current === failureKey) {
      return;
    }

    notifiedPlaywrightFailureId.current = failureKey;
    const detail = job.failureReason || job.message || "Open the Actions run for the runner error.";
    const message = `Playwright automation failed: ${detail}`;
    setFailureNotice(message);
    setCompletionNotice("");

    if (typeof window !== "undefined" && "Notification" in window && window.Notification.permission === "granted") {
      new window.Notification("Playwright automation failed", { body: detail.slice(0, 180) });
    }
  }, [job.failureReason, job.jobId, job.message, job.requestedAt, job.status]);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(completed)));
    } catch {
      // Checklist persistence is a convenience only; the playbook remains readable without it.
    }
  }, [completed, loaded, storageKey]);

  function toggleItem(itemId: string) {
    const item = PLAYWRIGHT_SPEC_ITEMS.find((spec) => spec.id === itemId);
    if (item?.status.toLowerCase() === "complete") {
      return;
    }

    setCompleted((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  async function submitPlaywrightJob() {
    const endpoint = playwrightJobsEndpoint(data);
    const normalizedTicketKey = ticketKey.trim().toUpperCase();
    const requestedAt = new Date().toISOString();
    const selectedIssue = data?.issues?.find((issue) => issue.key === normalizedTicketKey);
    const requestedJobId = clientPlaywrightJobId(normalizedTicketKey);

    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(normalizedTicketKey)) {
      setJob({
        status: "failed",
        message: "Enter a Jira ticket key before starting automation.",
        requestedAt
      });
      return;
    }

    if (!endpoint) {
      setJob({
        status: "failed",
        message: "No Cloudflare Playwright bridge is configured for this board.",
        requestedAt
      });
      return;
    }

    setJob({
      status: "submitting",
      message: "Submitting the approved Playwright job to the protected runner...",
      requestedAt,
      currentStep: "Validating request"
    });
    setCompletionNotice("");
    setFailureNotice("");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        credentials: "include",
        body: JSON.stringify({
          schemaVersion: "playwright-job/v1",
          jobId: requestedJobId,
          scriptId,
          ticketKey: normalizedTicketKey,
          release: data?.version || "v3001.123.0",
          environment,
          requestedBy: {
            displayName: "Dashboard user"
          },
          repositorySlug: data?.repositorySlug || "DewanKabir009/jira-board-v3001-123-0",
          dashboardUrl: data?.dashboardUrl || (typeof window === "undefined" ? "" : window.location.href),
          parameters: {
            ticketUrl: selectedIssue?.url || jiraTicketUrl(data, data?.issues || [], normalizedTicketKey),
            dashboardUrl: data?.dashboardUrl ? `${data.dashboardUrl.replace(/\/$/, "")}/modern/` : (typeof window === "undefined" ? "" : window.location.href),
            startUrl: "https://golfnowcentral.dev.golfnow.io/"
          },
          artifactPlan: {
            screenshots: true,
            video: true,
            trace: true,
            logs: true
          },
          jiraCommentMode: "draft"
        })
      });
      const payload = await response.json().catch(() => ({
        ok: false,
        message: "The Playwright bridge returned an unreadable response."
      }));

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.message || payload?.error || "The Playwright bridge rejected the job.");
      }

      setJob({
        status: "queued",
        message: payload.message || "Playwright job queued. Evidence will appear when the runner publishes the job record.",
        requestedAt,
        jobId: payload.jobId || requestedJobId,
        actionsUrl: payload.actionsUrl,
        statusUrl: payload.statusUrl || playwrightJobArtifactUrl(requestedJobId, "summary.json"),
        jobUrl: payload.jobUrl || playwrightJobArtifactUrl(requestedJobId, ""),
        currentStep: "Queued in GitHub Actions",
        artifacts: []
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Playwright job could not be started.";
      setJob({
        status: "failed",
        message: isHostedBridgeEndpoint(data?.assigneeDispatchEndpoint || "") && /failed to fetch|unreadable|network|load failed/i.test(errorMessage)
          ? "Cloudflare login is required. Open the bridge link, then retry."
          : errorMessage,
        requestedAt,
        actionsUrl: data?.repositorySlug ? workflowUrl(data.repositorySlug, "run-playwright-job.yml") : ""
      });
      console.error(error);
    }
  }

  const completeCount = PLAYWRIGHT_SPEC_ITEMS.filter((item) => item.status.toLowerCase() === "complete" || completed.has(item.id)).length;
  const progress = Math.round((completeCount / PLAYWRIGHT_SPEC_ITEMS.length) * 100);
  const jobTone = job.status === "failed" ? "danger" : job.status === "completed" ? "good" : job.status === "idle" ? "neutral" : "attention";
  const resultsReady = job.status === "completed" && Boolean(job.jobUrl || job.artifacts?.length);
  const failedJob = job.status === "failed";
  const failureDetail = job.failureReason || job.message || "Open the Actions run for the runner error.";

  return (
    <section className="automation-playbook" aria-labelledby="automation-playbook-heading">
      <div className="automation-playbook-hero">
        <div>
          <p className="eyebrow">123 pilot spec</p>
          <h2 id="automation-playbook-heading">Playwright automation playbook</h2>
          <p>
            Spec-driven checklist for dashboard-triggered Playwright jobs. The static board will stay a command center; execution belongs in a protected hosted runner.
          </p>
          <div className="automation-resource-links" aria-label="Playwright spec resources">
            {PLAYWRIGHT_RESOURCE_LINKS.map((link) => (
              <a href={link.href} target="_blank" rel="noreferrer" key={link.href}>{link.label}</a>
            ))}
          </div>
        </div>
        <dl className="automation-playbook-progress" aria-label="Playbook progress">
          <div>
            <dt>Spec progress</dt>
            <dd>{completeCount}/{PLAYWRIGHT_SPEC_ITEMS.length}</dd>
          </div>
          <div>
            <dt>Readiness</dt>
            <dd>{progress}%</dd>
          </div>
          <div>
            <dt>Pilot board</dt>
            <dd>{data?.version || "v3001.123.0"}</dd>
          </div>
        </dl>
      </div>

      <div className="automation-architecture">
        <article>
          <span>1</span>
          <h3>Dashboard command</h3>
          <p>123 board collects the job request and shows job status, logs, screenshots, video, and trace links.</p>
        </article>
        <article>
          <span>2</span>
          <h3>Secure bridge</h3>
          <p>Cloudflare Access validates the user and forwards only approved job payloads to the runner.</p>
        </article>
        <article>
          <span>3</span>
          <h3>Playwright runner</h3>
          <p>A hosted Node process runs approved scripts and writes progress plus artifacts to a job record.</p>
        </article>
      </div>

      <div className="automation-playbook-grid">
        <div className="automation-checklist">
          <div className="automation-section-heading">
            <h3>Implementation checklist</h3>
            <span>{completeCount} complete</span>
          </div>
          <div className="automation-checklist-items">
            {PLAYWRIGHT_SPEC_ITEMS.map((item) => {
              const checked = item.status.toLowerCase() === "complete" || completed.has(item.id);
              return (
                <label className={checked ? "automation-check-item complete" : "automation-check-item"} key={item.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={item.status.toLowerCase() === "complete"}
                    onChange={() => toggleItem(item.id)}
                  />
                  <span>
                    <span className="automation-check-item-title">
                      <strong>{item.title}</strong>
                      <em>{item.status}</em>
                    </span>
                    <small>{item.detail}</small>
                    <a href={item.href} target="_blank" rel="noreferrer">Open spec</a>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="automation-runbook">
          <div className="automation-section-heading">
            <h3>Execution playbook</h3>
            <span>Ready</span>
          </div>
          <ol>
            {PLAYWRIGHT_PLAYBOOK_STEPS.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <div className="automation-acceptance">
            <h3>Acceptance target</h3>
            <p>
              A user can start an approved Playwright job from this board, watch live evidence, and open final artifacts without terminal access.
            </p>
          </div>
        </div>
      </div>
      <div className="automation-job-console">
        <div className="automation-section-heading">
          <h3>Run approved automation</h3>
          <span>{resultsReady ? "results ready" : job.status}</span>
        </div>
        <div className="automation-job-form">
          <SelectFilter
            label="Script"
            value={scriptId}
            options={PLAYWRIGHT_SCRIPT_OPTIONS}
            onChange={setScriptId}
            includeAll={false}
            preferredDirection="up"
          />
          <SelectFilter
            label="Environment"
            value={environment}
            options={PLAYWRIGHT_ENVIRONMENT_OPTIONS}
            onChange={setEnvironment}
            includeAll={false}
            preferredDirection="up"
          />
          <label className="automation-ticket-input">
            <span>Ticket</span>
            <input value={ticketKey} onChange={(event) => setTicketKey(event.target.value.toUpperCase())} placeholder="CORE-14474" />
          </label>
          <button type="button" onClick={submitPlaywrightJob} disabled={!data || job.status === "submitting"}>
            {job.status === "submitting" ? "Starting..." : "Run Playwright"}
          </button>
        </div>
        {resultsReady ? (
          <div className="automation-results-ready" role="status" aria-live="polite">
            <strong>Results ready</strong>
            <span>{completionNotice || "Playwright automation completed. Open View Results, Screenshot, or Video."}</span>
          </div>
        ) : null}
        {failedJob ? (
          <div className="automation-results-failed" role="alert" aria-live="assertive">
            <strong>Automation failed</strong>
            <span>{failureNotice || failureDetail}</span>
            {job.failureLog ? <pre>{job.failureLog}</pre> : null}
          </div>
        ) : null}
        <div className={`automation-job-status ${jobTone}`} role="status" aria-live="polite">
          <div>
            <strong>{job.jobId ? `Job ${job.jobId}` : "No active job"}</strong>
            <p>{job.message}</p>
            {job.currentStep ? <small>Current step: {job.currentStep}</small> : null}
            {job.failureReason ? <small>Failure: {job.failureReason}</small> : null}
          </div>
          <div className="automation-job-links">
            {job.actionsUrl ? <a href={job.actionsUrl} target="_blank" rel="noreferrer">Actions run</a> : null}
            {job.statusUrl ? <a href={job.statusUrl} target="_blank" rel="noreferrer">Summary JSON</a> : null}
            {job.jobUrl ? <a className={resultsReady ? "view-results ready" : "view-results"} href={job.jobUrl} target="_blank" rel="noreferrer">View Results</a> : null}
            {(job.artifacts || []).map((artifact) => {
              const primaryArtifactReady = resultsReady && /screenshot|video/i.test(`${artifact.type || ""} ${artifact.label || ""}`);
              const failureArtifact = failedJob && /log|event/i.test(`${artifact.type || ""} ${artifact.label || ""}`);
              const previewableArtifact = isPreviewablePlaywrightArtifact(artifact);
              return artifact.href ? (
              <a
                className={primaryArtifactReady ? "result-artifact ready" : failureArtifact ? "result-artifact failed" : "result-artifact"}
                href={artifact.href}
                target="_blank"
                rel="noreferrer"
                key={`${artifact.type}-${artifact.href}`}
                onClick={(event) => {
                  if (!previewableArtifact) {
                    return;
                  }
                  event.preventDefault();
                  setArtifactPreview(artifact);
                }}
              >
                {artifact.label || artifact.type || "Artifact"}
              </a>
            ) : null;
            })}
          </div>
        </div>
      </div>
      {artifactPreview ? <PlaywrightArtifactPreviewModal artifact={artifactPreview} onClose={() => setArtifactPreview(null)} /> : null}
    </section>
  );
}

function PlaywrightArtifactPreviewModal({ artifact, onClose }: { artifact: PlaywrightArtifact; onClose: () => void }) {
  const titleId = useId();
  const href = artifact.href || "";
  const title = artifact.label || artifact.type || "Result";
  const kind = playwrightArtifactKind(artifact);

  useEffect(() => {
    document.body.classList.add("modal-open");
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="ticket-detail-modal result-preview-modal" role="presentation">
      <button className="ticket-detail-backdrop" type="button" aria-label="Close result viewer" onClick={onClose}></button>
      <section className="result-preview-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="result-preview-modal-header">
          <strong id={titleId}>{title}</strong>
          <div className="result-preview-modal-actions">
            <a className="button-link" href={href} target="_blank" rel="noreferrer">Open full page</a>
            <button className="ticket-detail-close" type="button" onClick={onClose} aria-label="Close result viewer">X</button>
          </div>
        </header>
        <div className="result-preview-modal-body">
          {kind === "image" ? <img src={href} alt={title} /> : null}
          {kind === "video" ? <video src={href} controls playsInline /> : null}
        </div>
      </section>
    </div>
  );
}

function isPlaywrightPilotBoard(data: DashboardData | null) {
  const version = String(data?.version || "").toLowerCase();
  const repository = String(data?.repositorySlug || "").toLowerCase();
  return version === "v3001.123.0" || repository.endsWith("jira-board-v3001-123-0");
}

function DataPullSection({ data, loadError }: { data: DashboardData | null; loadError: string }) {
  const history = normalizedPullHistory(data);
  const diff = data?.pullDiff || history[0] || null;
  const current = diff?.currentPulledAtDisplay || data?.pulledAtDisplay || data?.pulledAt || "";

  return (
    <details className="data-pull-section" id="data-pull">
      <summary>
        <span>Data Pull</span>
        <span className="pull-meta">Latest pull: {pullDisplay(current)}</span>
      </summary>
      <div className="pull-body">
        {loadError ? <p className="load-error">{loadError}</p> : null}
        {diff ? <PullComparison diff={diff} data={data} /> : <p className="pull-empty">Waiting for the first Jira data pull.</p>}
        <PullHistory history={history} latestDiff={diff} />
      </div>
    </details>
  );
}

function PullComparison({ diff, data }: { diff: PullDiffEntry; data: DashboardData | null }) {
  const lists = getDiffLists(diff);
  const hasChanges = pullHasChanges(diff);

  return (
    <section className="pull-snapshot" aria-labelledby="latest-pull-comparison">
      <h3 id="latest-pull-comparison" className="pull-section-title">Latest comparison</h3>
      <div className="pull-timing">
        <div><b>Previous pull:</b> {pullDisplay(diff.previousPulledAtDisplay || "No previous pull")}</div>
        <div><b>Most recent pull:</b> {pullDisplay(diff.currentPulledAtDisplay || data?.pulledAtDisplay || data?.pulledAt || "Pending")}</div>
      </div>
      <div className="pull-stats" aria-label="Latest pull totals">
        <PullStat label="Added" value={lists.added.length} />
        <PullStat label="Updated" value={lists.updated.length} />
        <PullStat label="Status moves" value={lists.statusChanges.length} />
        <PullStat label="Removed" value={lists.removed.length} />
      </div>
      {diff.isBaseline ? (
        <p className="pull-note">Baseline snapshot captured for comparison history.</p>
      ) : !hasChanges ? (
        <p className="pull-note">No ticket-level changes were detected between these two pulls.</p>
      ) : (
        <div className="pull-change-grid">
          <PullGroup title="Added" items={lists.added} renderer={(item, index) => <PullIssue change={item} index={index} />} />
          <PullGroup title="Updated" items={lists.updated} renderer={(item, index) => <PullIssue change={item} index={index} showDetails />} />
          <PullGroup title="Status moves" items={lists.statusChanges} renderer={(item, index) => <PullStatusChange change={item} index={index} />} />
          <PullGroup title="Removed" items={lists.removed} renderer={(item, index) => <PullIssue change={item} index={index} />} />
        </div>
      )}
    </section>
  );
}

function PullHistory({ history, latestDiff }: { history: PullDiffEntry[]; latestDiff: PullDiffEntry | null }) {
  const latestId = latestDiff?.currentPulledAt || "";
  const changedHistory = history
    .filter((entry) => pullHasChanges(entry) && (!latestId || entry.currentPulledAt !== latestId))
    .slice(0, 8);

  return (
    <section className="pull-history" aria-labelledby="pull-history-heading">
      <h3 id="pull-history-heading" className="pull-section-title">Recent changed pulls</h3>
      {changedHistory.length ? (
        <div className="pull-history-list">
          {changedHistory.map((entry, index) => {
            const lists = getDiffLists(entry);
            return (
              <article className="pull-history-entry" key={entry.currentPulledAt || entry.currentPulledAtDisplay || index}>
                <div className="pull-history-title">
                  <span>{pullDisplay(entry.currentPulledAtDisplay || entry.currentPulledAt || `Pull ${index + 1}`)}</span>
                  <strong>{lists.added.length + lists.updated.length + lists.statusChanges.length + lists.removed.length} changes</strong>
                </div>
                <div className="pull-history-stats">
                  <span>{lists.added.length} added</span>
                  <span>{lists.updated.length} updated</span>
                  <span>{lists.statusChanges.length} moved</span>
                  <span>{lists.removed.length} removed</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="pull-note">No older changed pulls are present in the retained history.</p>
      )}
    </section>
  );
}

function PullStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="pull-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function PullGroup({
  title,
  items,
  renderer
}: {
  title: string;
  items: PullChange[];
  renderer: (item: PullChange, index: number) => ReactNode;
}) {
  if (!items.length) {
    return null;
  }

  return (
    <section className="pull-group">
      <h4>{title}</h4>
      <div className="pull-list">
        {items.slice(0, 12).map((item, index) => renderer(item, index))}
      </div>
      {items.length > 12 ? <p className="pull-note">{items.length - 12} more not shown.</p> : null}
    </section>
  );
}

function PullIssue({ change, index, showDetails = false }: { change: PullChange; index: number; showDetails?: boolean }) {
  const key = extractChangeKey(change);
  const href = changeHref(change);
  const summary = changeSummary(change);
  const parent = changeParentLabel(change);
  const details = showDetails ? changeDetailLabels(change) : [];

  return (
    <article className="pull-item" key={`${key || summary}-${index}`}>
      <div className="pull-item-title">
        {href ? <a href={href} target="_blank" rel="noreferrer">{key || "Ticket"}</a> : <span>{key || "Ticket"}</span>}
        <span>{summary || "Ticket changed"}</span>
      </div>
      {parent ? <p>{parent}</p> : null}
      {details.length ? <p>{details.slice(0, 2).join("; ")}</p> : null}
    </article>
  );
}

function PullStatusChange({ change, index }: { change: PullChange; index: number }) {
  const details = statusChangeLabel(change);
  return (
    <PullIssue change={{ ...(typeof change === "string" ? { key: change } : change), summary: changeSummary(change) || details }} index={index} showDetails />
  );
}

function TicketTableView({
  groups,
  selectedKey,
  changeSets,
  openSubtaskParents,
  assignmentOptions,
  assignmentStates,
  onSelectTicket,
  onOpenTicket,
  onAssign,
  onToggleSubtasks
}: {
  groups: TicketGroup[];
  selectedKey: string;
  changeSets: ChangeSets;
  openSubtaskParents: Set<string>;
  assignmentOptions: SelectOption[];
  assignmentStates: Record<string, AssignmentRequestState>;
  onSelectTicket: (key: string) => void;
  onOpenTicket: (key: string) => void;
  onAssign: (issue: Issue, assignee: string) => void | Promise<void>;
  onToggleSubtasks: (key: string) => void;
}) {
  if (!groups.length) {
    return (
      <div className="ticket-table-empty">
        <p>No matching parent tickets.</p>
      </div>
    );
  }

  return (
    <div className="grouped-ticket-table" role="table" aria-label="Grouped ticket table">
      <div className="grouped-table-header" role="row">
        <span role="columnheader">Ticket</span>
        <span role="columnheader">Summary</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">People</span>
        <span role="columnheader">Priority</span>
        <span role="columnheader">Components</span>
        <span role="columnheader">Updated</span>
        <span role="columnheader">Actions</span>
      </div>
      {groups.map((group, index) => (
        <TicketTableGroup
          group={group}
          index={index}
          selectedKey={selectedKey}
          changeSets={changeSets}
          openSubtaskParents={openSubtaskParents}
          assignmentOptions={assignmentOptions}
          assignmentStates={assignmentStates}
          onSelectTicket={onSelectTicket}
          onOpenTicket={onOpenTicket}
          onAssign={onAssign}
          onToggleSubtasks={onToggleSubtasks}
          key={group.issue.key || `table-group-${index}`}
        />
      ))}
    </div>
  );
}

function TicketTableGroup({
  group,
  index,
  selectedKey,
  changeSets,
  openSubtaskParents,
  assignmentOptions,
  assignmentStates,
  onSelectTicket,
  onOpenTicket,
  onAssign,
  onToggleSubtasks
}: {
  group: TicketGroup;
  index: number;
  selectedKey: string;
  changeSets: ChangeSets;
  openSubtaskParents: Set<string>;
  assignmentOptions: SelectOption[];
  assignmentStates: Record<string, AssignmentRequestState>;
  onSelectTicket: (key: string) => void;
  onOpenTicket: (key: string) => void;
  onAssign: (issue: Issue, assignee: string) => void | Promise<void>;
  onToggleSubtasks: (key: string) => void;
}) {
  const issue = group.issue;
  const parentId = issue.key || `table-ticket-${index}`;
  const isOpen = openSubtaskParents.has(parentId);
  const subtaskCount = group.visibleSubtasks.length;
  const changes = changeLabels(issue.key || "", changeSets);
  const isParentSelected = selectedKey === issue.key;
  const hasSelectedSubtask = group.visibleSubtasks.some((subtask) => subtask.key === selectedKey);
  const groupClassName = [
    "table-ticket-group",
    isOpen ? "expanded" : "",
    isParentSelected ? "selected selected-parent" : "",
    hasSelectedSubtask ? "has-selected-subtask" : ""
  ].filter(Boolean).join(" ");

  return (
    <section className={groupClassName} role="rowgroup">
      <div
        className="grouped-table-row parent-ticket-row"
        role="row"
        aria-selected={isParentSelected}
        tabIndex={0}
        onClick={(event) => selectTableRow(event, issue.key || "", onSelectTicket)}
        onKeyDown={(event) => activateTableRow(event, issue.key || "", onSelectTicket)}
      >
        <div className="grouped-table-cell ticket-cell" role="cell" data-label="Ticket">
          <a className="table-ticket-key" href={issue.url || "#"} target="_blank" rel="noreferrer">
            {issue.key || "Ticket"}
          </a>
          <IssueTypePill issue={issue} />
        </div>
        <div className="grouped-table-cell summary-cell" role="cell" data-label="Summary">
          <button
            className="summary-button"
            type="button"
            onClick={() => onSelectTicket(issue.key || "")}
            aria-label={`Open details for ${issue.key || "ticket"}: ${issue.summary || "Untitled ticket"}`}
          >
            {issue.summary || "Untitled ticket"}
          </button>
          {changes.length ? (
            <div className="change-tags table-change-tags" aria-label="Ticket changes">
              {changes.map((label) => <span key={label}>{label}</span>)}
            </div>
          ) : null}
        </div>
        <div className="grouped-table-cell" role="cell" data-label="Status"><span className="status-pill">{issue.status || "None"}</span></div>
        <div className="grouped-table-cell" role="cell" data-label="People"><PeopleStack issue={issue} /></div>
        <div className="grouped-table-cell" role="cell" data-label="Priority"><span className="priority-pill">{issue.priority || "None"}</span></div>
        <div className="grouped-table-cell component-text" role="cell" data-label="Components">{formatComponents(issue.components)}</div>
        <div className="grouped-table-cell muted-cell" role="cell" data-label="Updated">{issue.updatedDisplay || "Unknown"}</div>
        <div className="grouped-table-cell grouped-table-actions" role="cell" data-label="Actions">
          <div className="table-action-buttons">
            <a href={issue.url || "#"} target="_blank" rel="noreferrer">Jira</a>
            <button type="button" onClick={() => onOpenTicket(issue.key || "")}>Details</button>
          </div>
          <button
            type="button"
            className="table-subtask-toggle"
            disabled={!subtaskCount}
            aria-expanded={isOpen}
            onClick={() => onToggleSubtasks(parentId)}
          >
            {isOpen ? "Hide" : "Show"} {formatSubtaskCount(subtaskCount, group.subtasks.length)}
          </button>
        </div>
      </div>
      <div className="grouped-table-assign-row">
        <AssigneeAssignmentControl
          issue={issue}
          options={assignmentOptions}
          request={assignmentStates[issue.key || ""]}
          onAssign={onAssign}
          compact
        />
      </div>
      {isOpen && subtaskCount ? (
        <div className="grouped-table-subtasks" aria-label={`Subtasks for ${issue.key || "ticket"}`}>
          {group.visibleSubtasks.map((subtask) => (
            <div
              className={selectedKey === subtask.key ? "grouped-table-subtask-item selected-subtask-item" : "grouped-table-subtask-item"}
              key={subtask.key || `${parentId}-${subtask.summary}`}
            >
              <div
                className={selectedKey === subtask.key ? "grouped-table-row subtask-table-row selected" : "grouped-table-row subtask-table-row"}
                role="row"
                aria-selected={selectedKey === subtask.key}
                tabIndex={0}
                onClick={(event) => selectTableRow(event, subtask.key || "", onSelectTicket)}
                onKeyDown={(event) => activateTableRow(event, subtask.key || "", onSelectTicket)}
              >
                <div className="grouped-table-cell ticket-cell" role="cell" data-label="Ticket">
                  <a className="table-ticket-key" href={subtask.url || "#"} target="_blank" rel="noreferrer">
                    {subtask.key || "Subtask"}
                  </a>
                  <IssueTypePill issue={subtask} />
                </div>
                <div className="grouped-table-cell summary-cell" role="cell" data-label="Summary">
                  <button
                    className="summary-button"
                    type="button"
                    onClick={() => onSelectTicket(subtask.key || "")}
                    aria-label={`Open details for ${subtask.key || "subtask"}: ${subtask.summary || "Untitled subtask"}`}
                  >
                    {subtask.summary || "Untitled subtask"}
                  </button>
                </div>
                <div className="grouped-table-cell" role="cell" data-label="Status"><span className="status-pill">{subtask.status || "None"}</span></div>
                <div className="grouped-table-cell" role="cell" data-label="People"><PeopleStack issue={subtask} /></div>
                <div className="grouped-table-cell" role="cell" data-label="Priority"><span className="priority-pill">{subtask.priority || "None"}</span></div>
                <div className="grouped-table-cell component-text" role="cell" data-label="Components">{formatComponents(subtask.components)}</div>
                <div className="grouped-table-cell muted-cell" role="cell" data-label="Updated">{subtask.updatedDisplay || "Unknown"}</div>
                <div className="grouped-table-cell grouped-table-actions" role="cell" data-label="Actions">
                  <div className="table-action-buttons">
                    <a href={subtask.url || "#"} target="_blank" rel="noreferrer">Jira</a>
                    <button type="button" onClick={() => onOpenTicket(subtask.key || "")}>Details</button>
                  </div>
                </div>
              </div>
              <div className="grouped-table-assign-row subtask-assign-row">
                <AssigneeAssignmentControl
                  issue={subtask}
                  options={assignmentOptions}
                  request={assignmentStates[subtask.key || ""]}
                  onAssign={onAssign}
                  compact
                />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function TicketCardView({
  groups,
  selectedKey,
  changeSets,
  openSubtaskParents,
  collapsedStatuses,
  assignmentOptions,
  assignmentStates,
  onSelectTicket,
  onAssign,
  onToggleSubtasks,
  onToggleStatus
}: {
  groups: TicketGroup[];
  selectedKey: string;
  changeSets: ChangeSets;
  openSubtaskParents: Set<string>;
  collapsedStatuses: Set<string>;
  assignmentOptions: SelectOption[];
  assignmentStates: Record<string, AssignmentRequestState>;
  onSelectTicket: (key: string) => void;
  onAssign: (issue: Issue, assignee: string) => void | Promise<void>;
  onToggleSubtasks: (key: string) => void;
  onToggleStatus: (status: string) => void;
}) {
  if (!groups.length) {
    return (
      <div className="ticket-card-board empty">
        <p>No matching parent tickets.</p>
      </div>
    );
  }

  const columns = distributeTicketSections(groupTicketSections(groups), openSubtaskParents, collapsedStatuses);

  return (
    <div className="ticket-card-board legacy-board-grid" aria-label="Legacy grouped ticket cards">
      {columns.map((column) => (
        <div className="ticket-board-column" key={column.id}>
          {column.sections.map((section) => {
            const collapsed = collapsedStatuses.has(section.status);
            const issueCount = section.groups.reduce((total, group) => total + 1 + group.visibleSubtasks.length, 0);
            return (
              <section
                className={collapsed ? "ticket-status-section collapsed" : "ticket-status-section"}
                data-status={section.status}
                key={section.status}
                style={statusSectionStyle(section.status)}
              >
                <button
                  type="button"
                  className="status-section-toggle"
                  aria-expanded={!collapsed}
                  onClick={() => onToggleStatus(section.status)}
                >
                  <span>{section.status}</span>
                  <strong>{issueCount}</strong>
                  <span>{collapsed ? ">" : "v"}</span>
                </button>
                {collapsed ? null : (
                  <div className="status-section-cards">
                    {section.groups.map((group, index) => (
                      <GroupedTicketCard
                        group={group}
                        index={index}
                        selectedKey={selectedKey}
                        changeSets={changeSets}
                        openSubtaskParents={openSubtaskParents}
                        assignmentOptions={assignmentOptions}
                        assignmentStates={assignmentStates}
                        onSelectTicket={onSelectTicket}
                        onAssign={onAssign}
                        onToggleSubtasks={onToggleSubtasks}
                        key={group.issue.key || `${section.status}-${index}`}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function statusSectionStyle(status: string): CSSProperties {
  const theme = statusSectionTheme(status);
  return {
    "--section-bg": theme.bg,
    "--section-border": theme.border,
    "--section-accent": theme.accent,
    "--section-text": theme.text,
    "--section-chip-bg": theme.chip
  } as CSSProperties;
}

function statusSectionTheme(status: string) {
  const normalized = String(status || "").trim().toLowerCase();

  if (normalized.includes("blocked")) {
    return STATUS_SECTION_THEMES.blocked;
  }
  if (normalized.includes("analysis")) {
    return STATUS_SECTION_THEMES.analysis;
  }
  if (normalized.includes("pre planning")) {
    return STATUS_SECTION_THEMES.neutral;
  }
  if (normalized.includes("code review") || normalized.includes("po review")) {
    return STATUS_SECTION_THEMES.review;
  }
  if (normalized.includes("pending deployment") && normalized.includes("dev")) {
    return STATUS_SECTION_THEMES.dev;
  }
  if (normalized.includes("pending deployment") && normalized.includes("stg")) {
    return STATUS_SECTION_THEMES.staging;
  }
  if (normalized.includes("pending deployment") && normalized.includes("prod")) {
    return STATUS_SECTION_THEMES.prod;
  }
  if (normalized.includes("qa testing")) {
    return STATUS_SECTION_THEMES.qa;
  }
  if (normalized.includes("regression")) {
    return STATUS_SECTION_THEMES.regression;
  }
  if (normalized.includes("closed") || normalized.includes("done")) {
    return STATUS_SECTION_THEMES.prod;
  }

  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(index);
    hash |= 0;
  }
  const themeKey = STATUS_SECTION_THEME_KEYS[Math.abs(hash) % STATUS_SECTION_THEME_KEYS.length];
  return STATUS_SECTION_THEMES[themeKey];
}

function selectTableRow(event: ReactMouseEvent<HTMLElement>, key: string, onSelectTicket: (key: string) => void) {
  if (!key || isInteractiveTicketTarget(event.target)) {
    return;
  }

  onSelectTicket(key);
}

function activateTableRow(event: ReactKeyboardEvent<HTMLElement>, key: string, onSelectTicket: (key: string) => void) {
  if (!key || isInteractiveTicketTarget(event.target)) {
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onSelectTicket(key);
  }
}

function isInteractiveTicketTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("a, button, input, select, textarea, [role='button'], [role='option']"));
}

function GroupedTicketCard({
  group,
  index,
  selectedKey,
  changeSets,
  openSubtaskParents,
  assignmentOptions,
  assignmentStates,
  onSelectTicket,
  onAssign,
  onToggleSubtasks
}: {
  group: TicketGroup;
  index: number;
  selectedKey: string;
  changeSets: ChangeSets;
  openSubtaskParents: Set<string>;
  assignmentOptions: SelectOption[];
  assignmentStates: Record<string, AssignmentRequestState>;
  onSelectTicket: (key: string) => void;
  onAssign: (issue: Issue, assignee: string) => void | Promise<void>;
  onToggleSubtasks: (key: string) => void;
}) {
  const issue = group.issue;
  const parentId = issue.key || `ticket-${index}`;
  const isOpen = openSubtaskParents.has(parentId);
  const subtaskCount = group.visibleSubtasks.length;
  const changes = changeLabels(issue.key || "", changeSets);

  return (
    <article className={selectedKey === issue.key ? "grouped-ticket-card selected" : "grouped-ticket-card"}>
      <div className="grouped-ticket-topline">
        <div className="grouped-ticket-keyline">
          <TicketKeyCluster issue={issue} />
          <IssueTypePill issue={issue} />
        </div>
        <span className="priority-pill">{issue.priority || "None"}</span>
      </div>

      <button
        className="summary-button ticket-card-summary"
        type="button"
        onClick={() => onSelectTicket(issue.key || "")}
        aria-label={`Open details for ${issue.key || "ticket"}: ${issue.summary || "Untitled ticket"}`}
      >
        {issue.summary || "Untitled ticket"}
      </button>

      <dl className="ticket-card-meta">
        <div>
          <dt>Assignee</dt>
          <dd><AssigneeBadge issue={issue} /></dd>
        </div>
        <div>
          <dt>Assigned Developer</dt>
          <dd><AssignedDeveloperBadge issue={issue} /></dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{issue.updatedDisplay || "Unknown"}</dd>
        </div>
        <div>
          <dt>Components</dt>
          <dd>{formatComponents(issue.components)}</dd>
        </div>
      </dl>

      {changes.length ? (
        <div className="change-tags card-change-tags" aria-label="Ticket changes">
          {changes.map((label) => <span key={label}>{label}</span>)}
        </div>
      ) : null}

      <div className="grouped-ticket-actions">
        <div className="row-actions">
          <AssigneeAssignmentControl
            issue={issue}
            options={assignmentOptions}
            request={assignmentStates[issue.key || ""]}
            onAssign={onAssign}
            compact
          />
          <a href={issue.url || "#"} target="_blank" rel="noreferrer">Jira</a>
          <button type="button" onClick={() => onSelectTicket(issue.key || "")}>Details</button>
        </div>
        <button
          type="button"
          className="subtask-toggle"
          disabled={!subtaskCount}
          aria-expanded={isOpen}
          onClick={() => onToggleSubtasks(parentId)}
        >
          {isOpen ? "Hide" : "Show"} {formatSubtaskCount(subtaskCount, group.subtasks.length)}
        </button>
      </div>

      {group.matchedBySubtask ? <span className="subtask-match-note">Matched by subtask</span> : null}

      {isOpen && subtaskCount ? (
        <div className="subtask-list" aria-label={`Subtasks for ${issue.key || "ticket"}`}>
          {group.visibleSubtasks.map((subtask) => (
            <div
              className={selectedKey === subtask.key ? "subtask-row selected" : "subtask-row"}
              key={subtask.key || `${parentId}-${subtask.summary}`}
            >
              <div className="subtask-main">
                <div className="grouped-ticket-keyline subtask-keyline">
                  <TicketKeyCluster issue={subtask} />
                  <IssueTypePill issue={subtask} />
                </div>
                <button
                  className="summary-button subtask-summary"
                  type="button"
                  onClick={() => onSelectTicket(subtask.key || "")}
                  aria-label={`Open details for ${subtask.key || "subtask"}: ${subtask.summary || "Untitled subtask"}`}
                >
                  {subtask.summary || "Untitled subtask"}
                </button>
              </div>
              <div className="subtask-meta">
                <span className="status-pill">{subtask.status || "None"}</span>
                <AssigneeBadge issue={subtask} />
                <AssignedDeveloperBadge issue={subtask} compact />
                <span>{subtask.priority || "None"}</span>
                <span>{formatComponents(subtask.components)}</span>
              </div>
              <div className="row-actions subtask-actions">
                <AssigneeAssignmentControl
                  issue={subtask}
                  options={assignmentOptions}
                  request={assignmentStates[subtask.key || ""]}
                  onAssign={onAssign}
                  compact
                />
                <a href={subtask.url || "#"} target="_blank" rel="noreferrer">Jira</a>
                <button type="button" onClick={() => onSelectTicket(subtask.key || "")}>Details</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function BoardRegistryDirectory({ registry, registryError, currentVersion }: { registry: BoardRegistry | null; registryError: string; currentVersion?: string }) {
  const boards = registry?.boards || [];

  return (
    <section className="board-registry" aria-labelledby="board-registry-heading">
      <div className="board-registry-heading">
        <div>
          <p className="eyebrow">Board registry</p>
          <h2 id="board-registry-heading">Release board directory</h2>
        </div>
        <span>{registry?.updatedAt ? `Updated ${registry.updatedAt}` : "Registry loading"}</span>
      </div>

      {registryError ? <p className="registry-error">{registryError}</p> : null}

      <div className="board-registry-grid">
        {boards.length ? boards.map((board) => {
          const isCurrent = board.release === currentVersion || board.fixVersion === currentVersion;
          return (
            <article
              className={isCurrent ? "board-registry-card current" : "board-registry-card"}
              key={`${board.release}-${board.url}`}
              aria-label={isCurrent ? `${board.release}, current board` : board.release}
            >
              <div className="board-card-heading">
                <h3>{board.release}</h3>
                <div className="board-status-group">
                  {isCurrent ? <span className="current-board-pill">Current</span> : null}
                  <span className={`board-status ${boardStatusTone(board.status)}`}>{board.status || "listed"}</span>
                </div>
              </div>
              <p>{board.notes}</p>
              <dl>
                <div><dt>Owner</dt><dd>{board.owner || registry?.owner || "Unassigned"}</dd></div>
                <div><dt>Repo</dt><dd>{board.repositorySlug || "Not configured"}</dd></div>
              </dl>
              <div className="board-card-links">
                <a href={board.url} target="_blank" rel="noreferrer">Live board</a>
                {board.modernUrl ? <a href={board.modernUrl} target="_blank" rel="noreferrer">Modern preview</a> : null}
                {board.repositorySlug ? <a href={`https://github.com/${board.repositorySlug}`} target="_blank" rel="noreferrer">Repo</a> : null}
              </div>
            </article>
          );
        }) : (
          <article className="board-registry-card placeholder">
            <h3>No registry entries loaded</h3>
            <p>Publish boards.json with the release, URL, status, owner, and notes for each board.</p>
          </article>
        )}
      </div>

      <div className="registry-automation">
        <div>
          <h3>Spin-up hook</h3>
          <p>{registry?.automation?.hook || "New board creation should append to boards.json before the first Pages publish."}</p>
        </div>
        <div className="board-card-links">
          {registry?.automation?.source ? <a href={registry.automation.source} target="_blank" rel="noreferrer">Registry source</a> : null}
          {registry?.automation?.provisioner ? <a href={registry.automation.provisioner} target="_blank" rel="noreferrer">Provisioner</a> : null}
        </div>
      </div>
    </section>
  );
}

function RolloutReadiness({ data, registry }: { data: DashboardData | null; registry: BoardRegistry | null }) {
  const board = currentBoardEntry(registry, data?.version);
  const boardUrl = data?.dashboardUrl || board?.url || "../";
  const modernUrl = board?.modernUrl || "./";
  const repoSlug = data?.repositorySlug || board?.repositorySlug || "";
  const repoUrl = repoSlug ? `https://github.com/${repoSlug}` : "";
  const specUrl = "https://dewankabir009.github.io/jira-board-v3001-122-0/modern-dashboard-specs/specs/rollout-fallback-plan.md";

  return (
    <section className="rollout-readiness" aria-labelledby="rollout-heading">
      <div className="rollout-heading">
        <div>
          <p className="eyebrow">Rollout readiness</p>
          <h2 id="rollout-heading">Parallel preview with fallback</h2>
        </div>
        <span>Legacy board stays primary</span>
      </div>

      <div className="rollout-grid">
        <article className="rollout-card good">
          <h3>Current board remains live</h3>
          <p>The generated static board is still the working QA surface while the modern preview proves parity.</p>
          <div className="rollout-links">
            <a href={boardUrl} target="_blank" rel="noreferrer">Current board</a>
            {repoUrl ? <a href={repoUrl} target="_blank" rel="noreferrer">Repo</a> : null}
          </div>
        </article>

        <article className="rollout-card attention">
          <h3>Modern preview runs beside it</h3>
          <p>This preview reads the same dashboard-data.json snapshot and stays isolated under the modern path.</p>
          <div className="rollout-links">
            <a href={modernUrl} target="_blank" rel="noreferrer">Modern preview</a>
          </div>
        </article>

        <article className="rollout-card">
          <h3>Cutover gates</h3>
          <ul className="rollout-checklist">
            <li>Read parity checked on 122 and 123.</li>
            <li>Cloudflare Jira write paths verified.</li>
            <li>Checklist comments and Slack notifications verified.</li>
          </ul>
        </article>

        <article className="rollout-card">
          <h3>Fallback path</h3>
          <p>Keep the root static board published. If parity breaks, stop promoting the modern path and republish the generator output.</p>
          <div className="rollout-links">
            <a href={specUrl} target="_blank" rel="noreferrer">Runbook</a>
          </div>
        </article>
      </div>
    </section>
  );
}

function CutoverValidationPanel({ validation }: { validation: OperationsHealth }) {
  return (
    <section className="cutover-validation" aria-labelledby="cutover-heading">
      <div className="cutover-heading">
        <div>
          <p className="eyebrow">Cutover validation</p>
          <h2 id="cutover-heading">Evidence gates before promotion</h2>
        </div>
        <span className={`cutover-summary ${validation.summaryTone}`}>{validation.summary}</span>
      </div>

      <div className="cutover-grid">
        {validation.items.map((item) => (
          <article className={`cutover-card ${item.tone}`} key={item.title}>
            <div className="cutover-card-head">
              <span className={`health-dot ${item.tone}`} aria-hidden="true" />
              <span>{item.status}</span>
            </div>
            <h3>{item.title}</h3>
            <p>{item.detail}</p>
            {item.links.length ? (
              <div className="cutover-links">
                {item.links.map((link) => (
                  <a href={link.href} target="_blank" rel="noreferrer" key={`${item.title}-${link.label}`}>{link.label}</a>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <p className="cutover-footnote">
        Write-path gates stay evidence-required until a named test ticket proves Jira readback, checklist comment posting, and Slack delivery.
      </p>
    </section>
  );
}

function OperationsHealthCenter({ health }: { health: OperationsHealth }) {
  return (
    <section className="operations-health" aria-labelledby="operations-heading">
      <div className="operations-heading">
        <div>
          <p className="eyebrow">Operations health</p>
          <h2 id="operations-heading">Separate system status</h2>
        </div>
        <span className={`ops-summary ${health.summaryTone}`}>{health.summary}</span>
      </div>

      <div className="ops-grid">
        {health.items.map((item) => (
          <article className={`ops-card ${item.tone}`} key={item.title}>
            <div className="ops-card-head">
              <span className={`health-dot ${item.tone}`} aria-hidden="true" />
              <span>{item.status}</span>
            </div>
            <h3>{item.title}</h3>
            <p>{item.detail}</p>
            {item.links.length ? (
              <div className="ops-links">
                {item.links.map((link) => (
                  <a href={link.href} target="_blank" rel="noreferrer" key={`${item.title}-${link.label}`}>{link.label}</a>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <p className="ops-footnote">
        Failed GitHub Action emails can be historical. Compare the latest pull, Pages preview, and workflow history before treating Jira writes or data refresh as one outage.
      </p>
    </section>
  );
}

function ReleaseAnalyticsBand({ analytics }: { analytics: ReleaseAnalytics }) {
  return (
    <section className="analytics-band" aria-labelledby="analytics-heading">
      <div className="analytics-heading">
        <div>
          <p className="eyebrow">Release analytics</p>
          <h2 id="analytics-heading">Triage signals</h2>
        </div>
        <dl className="analytics-totals" aria-label="Release analytics totals">
          <div><dt>Main</dt><dd>{analytics.mainTotal}</dd></div>
          <div><dt>Subtasks</dt><dd>{analytics.subtaskTotal}</dd></div>
          <div><dt>Changed</dt><dd>{analytics.changedTotal}</dd></div>
        </dl>
      </div>

      <div className="analytics-insights" aria-label="Release analytics summary">
        {analytics.insights.map((insight) => <p key={insight}>{insight}</p>)}
      </div>

      <div className="analytics-grid">
        <DistributionChart
          title="Assignee load"
          description="Current ticket ownership by assignee."
          rows={analytics.assignees}
        />
        <PriorityPieChart
          title="Priority mix"
          description="Current release risk split by Jira priority."
          rows={analytics.priorities}
        />
        <DistributionChart
          title="Component concentration"
          description="Components with the most current release tickets."
          rows={analytics.components}
        />
      </div>
    </section>
  );
}

function DistributionChart({ title, description, rows }: { title: string; description: string; rows: DistributionRow[] }) {
  return (
    <article className="analytics-chart">
      <div className="chart-heading">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="bar-list" aria-hidden="true">
        {rows.length ? rows.map((row) => (
          <div className="bar-row" key={row.label}>
            <span>{row.label}</span>
            <div className="bar-track">
              <span className={`bar-fill ${row.tone}`} style={{ "--bar-width": `${row.value ? Math.max(4, row.share) : 0}%` } as CSSProperties} />
            </div>
            <strong>{row.value}</strong>
          </div>
        )) : <p className="analytics-empty">No data available.</p>}
      </div>
      <DistributionTable title={title} rows={rows} />
    </article>
  );
}

function PriorityPieChart({ title, description, rows }: { title: string; description: string; rows: DistributionRow[] }) {
  const topPriority = rows[0];
  const gradient = priorityPieGradient(rows);

  return (
    <article className="analytics-chart priority-pie-card">
      <div className="chart-heading">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {rows.length ? (
        <div className="priority-pie-layout" aria-hidden="true">
          <div className="priority-pie" style={{ "--priority-pie-gradient": gradient } as CSSProperties}>
            <div className="priority-pie-center">
              <strong>{topPriority?.label || "None"}</strong>
              <span>{topPriority ? Math.round(topPriority.share) : 0}%</span>
            </div>
          </div>
          <div className="priority-pie-legend">
            {rows.map((row, index) => (
              <div className="priority-pie-legend-row" key={row.label}>
                <span className="priority-dot" style={{ "--priority-color": priorityColor(row.label, index) } as CSSProperties} />
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : <p className="analytics-empty">No data available.</p>}
      <DistributionTable title={title} rows={rows} />
    </article>
  );
}

function DistributionTable({ title, rows }: { title: string; rows: DistributionRow[] }) {
  return (
      <table className="analytics-table">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Label</th>
            <th scope="col">Tickets</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.value}</td>
              <td>{Math.round(row.share)}%</td>
            </tr>
          )) : (
            <tr>
              <td colSpan={3}>No data available.</td>
            </tr>
          )}
        </tbody>
      </table>
  );
}

function priorityPieGradient(rows: DistributionRow[]) {
  if (!rows.length) {
    return "var(--surface-muted) 0% 100%";
  }

  let cursor = 0;
  return rows.map((row, index) => {
    const start = cursor;
    const end = index === rows.length - 1 ? 100 : Math.min(100, cursor + row.share);
    cursor = end;
    return `${priorityColor(row.label, index)} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  }).join(", ");
}

function priorityColor(label: string, index: number) {
  const normalized = label.trim().toUpperCase();
  const priorityColors: Record<string, string> = {
    BLOCKER: "var(--rose)",
    CRITICAL: "var(--rose)",
    HIGHEST: "var(--rose)",
    HIGH: "var(--amber)",
    MEDIUM: "var(--blue)",
    LOW: "var(--green)",
    LOWEST: "var(--sky)",
    NONE: "var(--muted)",
    P0: "var(--rose)",
    P1: "var(--amber)",
    P2: "var(--blue)",
    P3: "var(--green)",
    P4: "var(--sky)"
  };
  const palette = ["var(--rose)", "var(--amber)", "var(--blue)", "var(--green)", "var(--sky)", "var(--muted)"];

  return priorityColors[normalized] || palette[index % palette.length];
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PresetButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={active ? "preset-button active" : "preset-button"} type="button" onClick={onClick} aria-pressed={active}>
      {label}
    </button>
  );
}

function AssigneeAssignmentControl({
  issue,
  options,
  request,
  onAssign,
  compact = false
}: {
  issue: Issue;
  options: SelectOption[];
  request?: AssignmentRequestState;
  onAssign: (issue: Issue, assignee: string) => void | Promise<void>;
  compact?: boolean;
}) {
  const issueKey = issue.key || "";
  const currentAssignee = issue.assignee || "Unassigned";
  const initialValue = options.some((option) => option.value === currentAssignee) ? currentAssignee : "";
  const [selectedAssignee, setSelectedAssignee] = useState(initialValue);
  const isSubmitting = request?.status === "submitting";
  const selectedIsCurrent = selectedAssignee === currentAssignee;
  const canSubmit = Boolean(issueKey && selectedAssignee && !isSubmitting && !selectedIsCurrent);

  useEffect(() => {
    setSelectedAssignee(options.some((option) => option.value === currentAssignee) ? currentAssignee : "");
  }, [issueKey, currentAssignee, options]);

  return (
    <div className={compact ? "assign-control compact" : "assign-control"}>
      <div className="assign-control-row">
        <SelectFilter
          label={compact ? "Assign" : "Assign ticket"}
          value={selectedAssignee}
          options={options}
          onChange={setSelectedAssignee}
          allLabel="Choose assignee"
          showAvatars
          preferredDirection={compact ? "up" : "auto"}
        />
        <button
          type="button"
          className="assign-submit-button"
          disabled={!canSubmit}
          onClick={() => onAssign(issue, selectedAssignee)}
        >
          {isSubmitting ? "Starting" : selectedIsCurrent ? "Assigned" : "Assign"}
        </button>
      </div>
      {request?.message ? (
        <p className={`assign-message ${request.status}`}>
          {request.message}
        </p>
      ) : null}
    </div>
  );
}

function IssueTypePill({ issue }: { issue: Issue }) {
  const isSubtask = Boolean(issue.isSubtask);
  const label = isSubtask ? "Subtask" : issue.type || "Main";

  return (
    <span className={isSubtask ? "issue-type-pill subtask" : "issue-type-pill main"}>
      {label}
    </span>
  );
}

function TicketKeyCluster({ issue }: { issue: Issue }) {
  return (
    <span className="ticket-key-cluster">
      <a className="table-ticket-key" href={issue.url || "#"} target="_blank" rel="noreferrer">
        {issue.key || "Ticket"}
      </a>
      <CopyTicketButton issue={issue} />
    </span>
  );
}

function CopyTicketButton({ issue }: { issue: Issue }) {
  const [copied, setCopied] = useState(false);
  const label = issue.key || "Ticket";

  function copyTicket() {
    copyTextToClipboard(ticketCopyText(issue)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  }

  return (
    <button
      type="button"
      className={copied ? "ticket-copy-button copied" : "ticket-copy-button"}
      onClick={copyTicket}
      aria-label={`Copy ${label} link and name`}
      title={copied ? "Copied" : "Copy ticket link and name"}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <rect x="7" y="5" width="9" height="11" rx="2"></rect>
        <path d="M5 13H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"></path>
      </svg>
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function AssigneeBadge({ issue }: { issue: Issue }) {
  const label = issue.assignee || "Unassigned";
  return (
    <span className="assignee-badge">
      <Avatar option={{ value: label, label, avatarUrl: issue.assigneeAvatarUrl }} />
      <span>{label}</span>
    </span>
  );
}

function AssignedDeveloperBadge({ issue, compact = false }: { issue: Issue; compact?: boolean }) {
  const label = issue.assignedDeveloper || "Unassigned";
  return (
    <span className={compact ? "developer-badge compact" : "developer-badge"}>
      <Avatar option={{ value: `developer-${label}`, label, avatarUrl: issue.assignedDeveloperAvatarUrl }} />
      <span>{compact ? `Dev: ${label}` : label}</span>
    </span>
  );
}

function PeopleStack({ issue }: { issue: Issue }) {
  return (
    <div className="people-stack">
      <div>
        <span className="people-label">Assignee</span>
        <AssigneeBadge issue={issue} />
      </div>
      <div>
        <span className="people-label">Assigned Developer</span>
        <AssignedDeveloperBadge issue={issue} />
      </div>
    </div>
  );
}

function SelectFilter({
  label,
  value,
  options,
  onChange,
  allLabel,
  includeAll = true,
  showAvatars = false,
  preferredDirection = "auto"
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  allLabel?: string;
  includeAll?: boolean;
  showAvatars?: boolean;
  preferredDirection?: "auto" | "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(preferredDirection === "up");
  const listboxId = useId();
  const controlRef = useRef<HTMLDivElement | null>(null);
  const normalizedOptions = allLabel === undefined || !includeAll ? options : [{ value: "", label: allLabel }, ...options];
  const selected = normalizedOptions.find((option) => option.value === value) || options.find((option) => option.value === value);
  const display = selected || { value: "", label: allLabel || `All ${label.toLowerCase()}` };
  const hasInlineAll = includeAll && allLabel === undefined;

  function setMenuDirection() {
    if (preferredDirection === "up") {
      setDropUp(true);
      return;
    }
    if (preferredDirection === "down") {
      setDropUp(false);
      return;
    }

    const rect = controlRef.current?.getBoundingClientRect();
    if (!rect || typeof window === "undefined") {
      setDropUp(false);
      return;
    }

    const optionCount = normalizedOptions.length + (hasInlineAll ? 1 : 0);
    const menuHeight = Math.min(280, Math.max(136, optionCount * 42 + 16));
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setDropUp(spaceBelow < menuHeight + 16 && spaceAbove > spaceBelow);
  }

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    setMenuDirection();
    if (typeof window === "undefined") {
      return undefined;
    }

    const handlePositionChange = () => setMenuDirection();
    window.addEventListener("resize", handlePositionChange);
    window.addEventListener("scroll", handlePositionChange, true);
    return () => {
      window.removeEventListener("resize", handlePositionChange);
      window.removeEventListener("scroll", handlePositionChange, true);
    };
  }, [open, preferredDirection, normalizedOptions.length, hasInlineAll]);

  function choose(optionValue: string) {
    onChange(optionValue);
    setOpen(false);
  }

  return (
    <div
      ref={controlRef}
      className={dropUp ? "select-control drop-up" : "select-control"}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <span>{label}</span>
      <button
        type="button"
        className={showAvatars ? "custom-select-trigger with-avatar" : "custom-select-trigger"}
        aria-label={`${label}: ${display.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => {
          if (!open) {
            setMenuDirection();
          }
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        {showAvatars ? <Avatar option={display} /> : null}
        <span className="custom-select-value">{display.label}</span>
        <span className="custom-select-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="custom-select-menu" id={listboxId} role="listbox" aria-label={label} tabIndex={-1}>
          {hasInlineAll ? (
            <button
              type="button"
              role="option"
              aria-selected={value === ""}
              className={value === "" ? "custom-select-option selected" : "custom-select-option"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose("")}
            >
              {showAvatars ? <Avatar option={{ value: "", label: "All" }} /> : null}
              <span>All {label.toLowerCase()}</span>
            </button>
          ) : null}
          {normalizedOptions.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={value === option.value}
              className={value === option.value ? "custom-select-option selected" : "custom-select-option"}
              key={`${label}-${option.value || option.label}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option.value)}
            >
              {showAvatars ? <Avatar option={option} /> : null}
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Avatar({ option }: { option: SelectOption }) {
  if (option.avatarUrl) {
    return <img className="assignee-avatar" src={option.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />;
  }

  return <span className="assignee-avatar fallback" aria-hidden="true">{avatarInitials(option.label)}</span>;
}

function avatarInitials(label: string) {
  if (!label || label.toLowerCase().startsWith("all")) {
    return "All";
  }

  if (label === "Unassigned") {
    return "Un";
  }

  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

function toSelectOptions(values: string[]): SelectOption[] {
  return values.map((value) => ({ value, label: value }));
}

function assigneeOptions(issues: Issue[]): SelectOption[] {
  const optionsByName = new Map<string, SelectOption>();

  for (const issue of issues) {
    const label = issue.assignee || "Unassigned";
    const existing = optionsByName.get(label);
    const avatarUrl = issue.assigneeAvatarUrl || "";

    if (!existing) {
      optionsByName.set(label, { value: label, label, avatarUrl });
    } else if (!existing.avatarUrl && avatarUrl) {
      optionsByName.set(label, { ...existing, avatarUrl });
    }
  }

  return Array.from(optionsByName.values()).sort((first, second) => first.label.localeCompare(second.label));
}

function createAssignableAssigneeOptions(data: DashboardData | null, issues: Issue[]): SelectOption[] {
  const avatarByName = new Map<string, string>();
  for (const issue of issues) {
    const name = issue.assignee || "";
    if (name && issue.assigneeAvatarUrl && !avatarByName.has(name)) {
      avatarByName.set(name, issue.assigneeAvatarUrl);
    }
  }

  const names = uniqueStrings(data?.assigneeOptions?.length ? data.assigneeOptions : DEFAULT_ASSIGNABLE_ASSIGNEES);
  return names.map((name) => ({
    value: name,
    label: name,
    avatarUrl: avatarByName.get(name) || ""
  }));
}

function createJiraProjectOptions(issues: Issue[], bridgeProjects: SelectOption[]): SelectOption[] {
  const issueProjects = uniqueStrings(issues.map((issue) => projectKeyFromIssue(issue.key || "")));
  const merged = new Map<string, SelectOption>();

  for (const option of bridgeProjects) {
    const key = projectKeyFromIssue(`${option.value}-1`) || option.value;
    if (key) {
      merged.set(key, { value: key, label: option.label || key });
    }
  }

  for (const project of issueProjects) {
    if (!merged.has(project)) {
      merged.set(project, { value: project, label: project });
    }
  }

  if (!merged.size) {
    merged.set("CORE", { value: "CORE", label: "CORE" });
  }

  return Array.from(merged.values()).sort((a, b) => a.value.localeCompare(b.value));
}

function projectsToSelectOptions(projects: JiraBridgeProject[]): SelectOption[] {
  return uniqueStrings(projects.map((project) => project.key || ""))
    .map((key) => {
      const project = projects.find((candidate) => candidate.key === key);
      return {
        value: key,
        label: project?.name ? `${key} - ${project.name}` : key
      };
    });
}

function projectKeyFromIssue(key: string) {
  const match = String(key || "").trim().toUpperCase().match(/^([A-Z][A-Z0-9]+)-\d+$/);
  return match?.[1] || "";
}

function normalizeTicketSearchKey(project: string, value: string) {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, "");

  if (/^[A-Z][A-Z0-9]+-\d+$/.test(raw)) {
    return raw;
  }

  const number = raw.replace(/\D+/g, "");
  const normalizedProject = projectKeyFromIssue(`${project}-1`) || String(project || "").trim().toUpperCase();

  return normalizedProject && number ? `${normalizedProject}-${number}` : "";
}

function findTicketInSnapshot(issues: Issue[], ticketKey: string): Issue | undefined {
  const normalizedKey = ticketKey.toUpperCase();
  const directIssue = issues.find((issue) => (issue.key || "").toUpperCase() === normalizedKey);

  if (directIssue) {
    return directIssue;
  }

  for (const issue of issues) {
    if (!issue.parent || typeof issue.parent === "string") {
      continue;
    }

    if ((issue.parent.key || "").toUpperCase() === normalizedKey) {
      return {
        key: issue.parent.key,
        url: issue.parent.url,
        summary: issue.parent.summary,
        description: issue.parent.description,
        type: issue.parent.type,
        status: issue.parent.status,
        priority: issue.parent.priority,
        isSubtask: false,
        components: [],
        parent: null
      };
    }
  }

  return undefined;
}

function jiraTicketUrl(data: DashboardData | null, issues: Issue[], ticketKey: string) {
  const siteUrl = (data?.siteUrl || jiraSiteUrlFromIssues(issues) || "https://golfnow.atlassian.net").replace(/\/$/, "");
  return `${siteUrl}/browse/${ticketKey}`;
}

async function fetchJiraIssueFromBridge(data: DashboardData | null, ticketKey: string): Promise<Issue | null> {
  const endpoint = bridgeIssueLookupEndpoint(data, ticketKey);

  if (!endpoint) {
    return null;
  }

  const response = await fetch(endpoint, {
    credentials: "include",
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));

  if (response.status === 404) {
    return null;
  }

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || "The Jira bridge lookup failed.");
  }

  return payload.issue || null;
}

function bridgeIssueLookupEndpoint(data: DashboardData | null, ticketKey: string) {
  const base = bridgeApiBase(data);
  if (!base) {
    return "";
  }

  base.pathname = "/issue";
  base.search = new URLSearchParams({ issueKey: ticketKey }).toString();
  return base.toString();
}

function bridgeProjectsEndpoint(data: DashboardData | null) {
  const base = bridgeApiBase(data);
  if (!base) {
    return "";
  }

  base.pathname = "/projects";
  base.search = "";
  return base.toString();
}

function bridgeRefreshEndpoint(data: DashboardData | null) {
  const base = bridgeApiBase(data);
  if (!base) {
    return "";
  }

  base.pathname = "/refresh";
  base.search = "";
  return base.toString();
}

function playwrightJobsEndpoint(data: DashboardData | null) {
  const base = bridgeApiBase(data);
  if (!base) {
    return "";
  }

  base.pathname = "/playwright/jobs";
  base.search = "";
  return base.toString();
}

function bridgeApiBase(data: DashboardData | null) {
  const endpoint = data?.assigneeDispatchEndpoint || "";
  if (!endpoint) {
    return null;
  }

  try {
    return new URL(endpoint);
  } catch {
    return null;
  }
}

function jiraSiteUrlFromIssues(issues: Issue[]) {
  const url = issues.find((issue) => issue.url)?.url || "";
  const match = url.match(/^(https?:\/\/[^/]+)/i);
  return match?.[1] || "";
}

function mergePlaywrightJobSummary(current: PlaywrightJobRequestState, summary: Record<string, any>): PlaywrightJobRequestState {
  const status = String(summary.status || current.status || "queued").toLowerCase();
  const normalizedStatus = status === "completed" || status === "failed" || status === "running" || status === "queued"
    ? status
    : current.status;
  const artifacts = Array.isArray(summary.artifacts)
    ? summary.artifacts.map((artifact) => ({
      label: String(artifact.label || artifact.type || "Artifact"),
      type: String(artifact.type || ""),
      href: String(artifact.href || "")
    })).filter((artifact) => artifact.href)
    : current.artifacts;

  return {
    ...current,
    status: normalizedStatus,
    message: String(summary.message || summary.summary || current.message || "Playwright job updated."),
    currentStep: String(summary.currentStep || summary.step || current.currentStep || ""),
    jobId: String(summary.jobId || current.jobId || ""),
    statusUrl: String(summary.statusUrl || current.statusUrl || ""),
    jobUrl: String(summary.jobUrl || current.jobUrl || ""),
    actionsUrl: String(summary.actionsUrl || current.actionsUrl || ""),
    failureReason: String(summary.failureReason || summary.error || current.failureReason || ""),
    failureLog: playwrightFailureLog(summary, current.failureLog),
    artifacts
  };
}

function playwrightFailureLog(summary: Record<string, any>, currentLog?: string) {
  const value = summary.failureLog || summary.logExcerpt || summary.logTail || summary.logs || currentLog || "";
  const text = Array.isArray(value) ? value.join("\n") : String(value || "");
  return text.trim().slice(0, 2400);
}

function clientPlaywrightJobId(ticketKey: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(16).slice(2, 10);
  return `${ticketKey}-${Date.now().toString(36)}-${suffix}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function playwrightJobArtifactUrl(jobId: string, fileName: string) {
  return `../playwright-jobs/${encodeURIComponent(jobId)}/${fileName}`;
}

function playwrightArtifactKind(artifact: PlaywrightArtifact) {
  const value = `${artifact.type || ""} ${artifact.label || ""} ${artifact.href || ""}`.toLowerCase();
  if (/screenshot|image|\.png|\.jpe?g|\.gif|\.webp/.test(value)) {
    return "image";
  }
  if (/video|\.webm|\.mp4|\.mov/.test(value)) {
    return "video";
  }
  return "";
}

function isPreviewablePlaywrightArtifact(artifact: PlaywrightArtifact) {
  return Boolean(artifact.href && playwrightArtifactKind(artifact));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function TicketDetail({
  issue,
  data,
  changeSets,
  assignmentOptions,
  assignmentRequest,
  onAssign
}: {
  issue?: Issue;
  data: DashboardData | null;
  changeSets: ChangeSets;
  assignmentOptions: SelectOption[];
  assignmentRequest?: AssignmentRequestState;
  onAssign: (issue: Issue, assignee: string) => void | Promise<void>;
}) {
  if (!issue) {
    return (
      <aside className="ticket-detail-panel">
        <p className="eyebrow">Details</p>
        <h2>No ticket selected</h2>
        <p className="detail-description">Load the data artifact or adjust filters to select a ticket.</p>
      </aside>
    );
  }

  const checklistTotal = issue.testChecklist?.total ?? issue.testChecklist?.testCases?.length ?? 0;
  const changeTags = changeLabels(issue.key || "", changeSets);

  return (
    <aside className="ticket-detail-panel" aria-label="Selected ticket details">
      <p className="eyebrow">Selected ticket</p>
      <div className="detail-heading">
        <TicketKeyCluster issue={issue} />
        <span className="priority-pill">{issue.priority || "None"}</span>
      </div>
      <h2>{issue.summary || "Untitled ticket"}</h2>
      <AssigneeAssignmentControl
        issue={issue}
        options={assignmentOptions}
        request={assignmentRequest}
        onAssign={onAssign}
      />
      <div className="change-tags">
        {changeTags.length > 0 ? changeTags.map((tag) => <span key={tag}>{tag}</span>) : <span>No pull diff change</span>}
      </div>
      <TicketDetailFields issue={issue} checklistTotal={checklistTotal} />
      <TicketDescription issue={issue} />
      <TicketComments issue={issue} data={data} />
      <div className="detail-actions">
        <a className="button-link primary" href={issue.url || "#"} target="_blank" rel="noreferrer">Open Jira</a>
        <a className="button-link" href={data?.dashboardUrl || "../"}>Current board actions</a>
      </div>
      <ChecklistWorkspace issue={issue} data={data} />
    </aside>
  );
}

function TicketDetailDialog({
  issue,
  data,
  changeSets,
  assignmentOptions,
  assignmentRequest,
  onAssign,
  onClose
}: {
  issue?: Issue;
  data: DashboardData | null;
  changeSets: ChangeSets;
  assignmentOptions: SelectOption[];
  assignmentRequest?: AssignmentRequestState;
  onAssign: (issue: Issue, assignee: string) => void | Promise<void>;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!issue) {
      return undefined;
    }

    document.body.classList.add("modal-open");
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [issue, onClose]);

  if (!issue) {
    return null;
  }

  const checklistTotal = issue.testChecklist?.total ?? issue.testChecklist?.testCases?.length ?? 0;
  const changeTags = changeLabels(issue.key || "", changeSets);

  return (
    <div className="ticket-detail-modal" role="presentation">
      <button className="ticket-detail-backdrop" type="button" aria-label="Close ticket details" onClick={onClose}></button>
      <section className="ticket-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="ticket-detail-dialog-title">
        <header className="ticket-detail-modal-header">
          <div>
            <div className="ticket-detail-modal-title">
              <TicketKeyCluster issue={issue} />
              <h2 id="ticket-detail-dialog-title">Ticket details</h2>
            </div>
            <p className="ticket-detail-modal-summary">{issue.summary || "Untitled ticket"}</p>
            <div className="description-modal-meta" aria-label="Ticket metadata">
              <span>{issue.type || "Ticket"}</span>
              <span>Status: {issue.status || "No status"}</span>
              <span>Priority: {issue.priority || "None"}</span>
              <span>Updated: {issue.updatedDisplay || "Unknown"}</span>
              <span>Media: {mediaSummary(issue)}</span>
              <span>Comments: {Number(issue.commentCount ?? issue.comments?.length ?? 0)}</span>
              <a href={issue.url || "#"} target="_blank" rel="noreferrer">Open Jira</a>
            </div>
          </div>
          <button className="ticket-detail-close" type="button" onClick={onClose} aria-label="Close ticket details">x</button>
        </header>

        <div className="ticket-detail-modal-body">
          <AssigneeAssignmentControl
            issue={issue}
            options={assignmentOptions}
            request={assignmentRequest}
            onAssign={onAssign}
          />
          <div className="change-tags">
            {changeTags.length > 0 ? changeTags.map((tag) => <span key={tag}>{tag}</span>) : <span>No pull diff change</span>}
          </div>
          <TicketDetailFields issue={issue} checklistTotal={checklistTotal} />
          <TicketDescription issue={issue} />
          <TicketComments issue={issue} data={data} />
          <ChecklistWorkspace issue={issue} data={data} />
        </div>
      </section>
    </div>
  );
}

function TicketDetailFields({ issue, checklistTotal }: { issue: Issue; checklistTotal: number }) {
  return (
    <dl className="detail-grid">
      <div><dt>Status</dt><dd>{issue.status || "None"}</dd></div>
      <div><dt>Assignee</dt><dd><AssigneeBadge issue={issue} /></dd></div>
      <div><dt>Assigned Developer</dt><dd><AssignedDeveloperBadge issue={issue} /></dd></div>
      <div><dt>Parent</dt><dd>{parentLabel(issue) || (issue.isSubtask ? "Subtask" : "Main ticket")}</dd></div>
      <div><dt>Checklist</dt><dd>{checklistTotal ? `${checklistTotal} cases` : "No parsed checklist"}</dd></div>
    </dl>
  );
}

function TicketDescription({ issue }: { issue: Issue }) {
  const html = normalizeDescriptionHtml(issue.descriptionHtml?.trim() || "");
  const imageCount = Number(issue.descriptionImageCount || 0);
  const videoCount = Number(issue.descriptionVideoCount || 0);
  const mediaCount = Number(issue.descriptionMediaCount || imageCount + videoCount);
  const hasContent = html || (issue.description || "").trim() || mediaCount > 0;

  return (
    <section className={hasContent ? "description-panel" : "description-panel is-empty"} aria-label={`Description for ${issue.key || "ticket"}`}>
      <div className="description-panel-heading">
        <h3>Description</h3>
        <span>{mediaCount ? mediaSummary(issue) : "Full text"}</span>
      </div>
      {html ? <div className="description-html" dangerouslySetInnerHTML={{ __html: html }} /> : <DescriptionText description={issue.description} />}
      {!html && mediaCount ? (
        <p className="description-note">{mediaSummary(issue)} referenced by Jira, but rendered media markup was not included in this dashboard artifact.</p>
      ) : null}
    </section>
  );
}

function mediaSummary(issue: Issue) {
  const imageCount = Number(issue.descriptionImageCount || 0);
  const videoCount = Number(issue.descriptionVideoCount || 0);
  const parts = [];

  if (imageCount) {
    parts.push(`${imageCount} image${imageCount === 1 ? "" : "s"}`);
  }
  if (videoCount) {
    parts.push(`${videoCount} video${videoCount === 1 ? "" : "s"}`);
  }

  if (parts.length) {
    return parts.join(" / ");
  }

  const mediaCount = Number(issue.descriptionMediaCount || 0);
  return mediaCount ? `${mediaCount} media item${mediaCount === 1 ? "" : "s"}` : "0";
}

function normalizeDescriptionHtml(html: string) {
  return html.replace(/\b(src|href)=(["'])assets\//g, (_match, attribute: string, quote: string) => `${attribute}=${quote}../assets/`);
}

function DescriptionText({ description }: { description?: string }) {
  const normalized = (description || "").trim();

  if (!normalized) {
    return <p className="description-empty">No description text is available in the artifact.</p>;
  }

  return (
    <>
      {normalized.split(/\n{2,}/).map((paragraph, paragraphIndex) => (
        <p key={`${paragraphIndex}-${paragraph.slice(0, 18)}`}>
          {paragraph.split(/\n/).map((line, lineIndex) => (
            <span key={`${paragraphIndex}-${lineIndex}`}>
              {lineIndex > 0 ? <br /> : null}
              {line}
            </span>
          ))}
        </p>
      ))}
    </>
  );
}

function TicketComments({ issue, data }: { issue: Issue; data: DashboardData | null }) {
  const comments = sortCommentsLatestFirst(Array.isArray(issue.comments) ? issue.comments : []);
  const commentCount = Number(issue.commentCount ?? comments.length);
  const hasComments = comments.length > 0;
  const latestComment = comments[0];
  const latestCommentUrl = issue.lastCommentUrl || latestComment?.url || "";
  const jiraCommentUrl = jiraCommentEndpoint(data);
  const [commentComposerOpen, setCommentComposerOpen] = useState(false);
  const latestCommentLabel = issue.lastCommentDisplay
    ? `Latest: ${issue.lastCommentDisplay}`
    : latestComment?.createdDisplay
      ? `Latest: ${latestComment.createdDisplay}`
      : "Latest comment";

  return (
    <section className={hasComments ? "ticket-comments-panel" : "ticket-comments-panel is-empty"} aria-label={`Comments for ${issue.key || "ticket"}`}>
      <div className="ticket-comments-heading">
        <h3>Comments</h3>
        <div className="ticket-comments-heading-actions">
          <span>
            {commentCount ? `${comments.length}${commentCount > comments.length ? ` of ${commentCount}` : ""} comment${commentCount === 1 ? "" : "s"}` : "No comments"}
          </span>
          <button
            className="comment-on-jira-button"
            type="button"
            disabled={!jiraCommentUrl}
            onClick={() => setCommentComposerOpen(true)}
          >
            Comment on Jira
          </button>
          {latestCommentUrl ? <a href={latestCommentUrl} target="_blank" rel="noreferrer">{latestCommentLabel}</a> : null}
        </div>
      </div>
      {hasComments ? (
        <div className="ticket-comments-list">
          {comments.map((comment, index) => (
            <article className="ticket-comment" key={comment.id || `${issue.key}-comment-${index}`}>
              <header className="ticket-comment-header">
                <Avatar option={{ value: comment.author || "Unknown", label: comment.author || "Unknown", avatarUrl: comment.authorAvatarUrl || "" }} />
                <div>
                  <strong>{comment.author || "Unknown"}</strong>
                  <span>{comment.createdDisplay || "Unknown date"}</span>
                </div>
              </header>
              {comment.bodyHtml ? (
                <div className="ticket-comment-body" dangerouslySetInnerHTML={{ __html: normalizeDescriptionHtml(comment.bodyHtml) }} />
              ) : (
                <DescriptionText description={comment.body || ""} />
              )}
              {(comment.url || comment.hasMedia) ? (
                <div className="ticket-comment-actions">
                  {comment.hasMedia ? <span>{comment.mediaCount || 1} Jira media item{Number(comment.mediaCount || 1) === 1 ? "" : "s"}</span> : null}
                  {comment.url ? <a href={comment.url} target="_blank" rel="noreferrer">Open comment in Jira</a> : null}
                </div>
              ) : null}
              {comment.updatedDisplay ? <p className="ticket-comment-edited">Edited {comment.updatedDisplay}</p> : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="description-empty">
          No comments were pulled into this dashboard artifact.
          {latestCommentUrl ? <> <a href={latestCommentUrl} target="_blank" rel="noreferrer">Open the latest Jira comment.</a></> : null}
        </p>
      )}
      {commentComposerOpen ? (
        <JiraCommentComposerModal issue={issue} data={data} endpoint={jiraCommentUrl} onClose={() => setCommentComposerOpen(false)} />
      ) : null}
    </section>
  );
}

function JiraCommentComposerModal({
  issue,
  data,
  endpoint,
  onClose
}: {
  issue: Issue;
  data: DashboardData | null;
  endpoint: string;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"draft" | "submitting" | "submitted" | "failed">("draft");
  const [message, setMessage] = useState("");
  const [commentUrl, setCommentUrl] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const titleId = useId();
  const canSubmit = Boolean(endpoint && issue.key && body.trim() && status !== "submitting");

  function applyEditorTool(tool: CommentEditorTool) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? body.length;
    const formatted = formatCommentSelection(body, start, end, tool);
    setBody(formatted.value);
    setStatus("draft");
    setMessage("");
    setCommentUrl("");
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(formatted.selectionStart, formatted.selectionEnd);
    }, 0);
  }

  async function submitComment() {
    if (!canSubmit) {
      return;
    }

    setStatus("submitting");
    setMessage("Posting Jira comment through the Cloudflare bridge...");
    setCommentUrl("");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        credentials: "include",
        body: JSON.stringify({
          issueKey: issue.key,
          issueUrl: issue.url,
          summary: issue.summary,
          body: body.trim(),
          bodyFormat: "adf",
          adf: buildJiraCommentAdf(body),
          releaseVersion: data?.version || "",
          repositorySlug: data?.repositorySlug || "",
          dashboardUrl: typeof window === "undefined" ? data?.dashboardUrl || "" : window.location.href,
          requestedAt: new Date().toISOString()
        })
      });
      const payload = await response.json().catch(() => ({ ok: false, message: "The Jira comment bridge returned an unreadable response." }));

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || payload.error || "The Jira comment bridge rejected the request.");
      }

      setStatus("submitted");
      setCommentUrl(payload.commentUrl || issue.url || "");
      setMessage("Jira comment posted. The dashboard comment list will refresh on the next Jira data pull.");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Bridge could not post the Jira comment.";
      setStatus("failed");
      setMessage(
        isHostedBridgeEndpoint(endpoint) && /failed to fetch|unreadable|load failed/i.test(errorMessage)
          ? "Cloudflare login is required. Open the bridge login link, then retry."
          : errorMessage
      );
    }
  }

  return (
    <div className="ticket-detail-modal jira-comment-modal" role="presentation">
      <button className="ticket-detail-backdrop" type="button" aria-label="Close Jira comment view" onClick={onClose}></button>
      <section className="jira-comment-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="jira-comment-modal-header">
          <div>
            <p className="eyebrow">Jira comments</p>
            <div className="ticket-detail-modal-title">
              <TicketKeyCluster issue={issue} />
              <h2 id={titleId}>Comment on Jira</h2>
            </div>
            <p className="ticket-detail-modal-summary">{issue.summary || "Untitled ticket"}</p>
          </div>
          <div className="jira-comment-modal-actions">
            <a className="button-link primary" href={issue.url || "#"} target="_blank" rel="noreferrer">Open Jira</a>
            <button className="ticket-detail-close" type="button" onClick={onClose} aria-label="Close Jira comment view">x</button>
          </div>
        </header>

        <div className="jira-comment-composer-shell">
          <label className="jira-comment-composer">
            <span>Comment</span>
            <div className="jira-comment-editor-toolbar" aria-label="Jira comment editor tools">
              {COMMENT_EDITOR_TOOLS.map((tool) => (
                <button
                  type="button"
                  key={tool.id}
                  title={tool.title}
                  aria-label={tool.title}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyEditorTool(tool.id)}
                >
                  {tool.label}
                </button>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
                if (status === "failed" || status === "submitted") {
                  setStatus("draft");
                  setMessage("");
                  setCommentUrl("");
                }
              }}
              placeholder="Write a Jira comment for this ticket..."
              rows={12}
              maxLength={32000}
              autoFocus
            />
          </label>
          <div className="jira-comment-composer-footer">
            <span>{body.trim().length} characters</span>
            <div className="jira-comment-submit-actions">
              {endpoint ? <a href={bridgeStatusUrl(endpoint)} target="_blank" rel="noreferrer">Bridge login</a> : null}
              {commentUrl ? <a href={commentUrl} target="_blank" rel="noreferrer">Open posted comment</a> : null}
              <button type="button" onClick={submitComment} disabled={!canSubmit}>
                {status === "submitting" ? "Posting" : "Submit comment to Jira"}
              </button>
            </div>
          </div>
          {message ? <p className={`jira-comment-submit-message ${status}`}>{message}</p> : null}
        </div>
      </section>
    </div>
  );
}

function formatCommentSelection(value: string, start: number, end: number, tool: CommentEditorTool) {
  const selected = value.slice(start, end);
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineEndIndex = value.indexOf("\n", end);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const lineSelection = value.slice(lineStart, lineEnd);

  function replaceRange(nextValue: string, nextStart: number, nextEnd: number) {
    return {
      value: nextValue,
      selectionStart: nextStart,
      selectionEnd: nextEnd
    };
  }

  function wrap(prefix: string, suffix: string, placeholder: string) {
    const content = selected || placeholder;
    const insert = `${prefix}${content}${suffix}`;
    const next = value.slice(0, start) + insert + value.slice(end);
    return replaceRange(next, start + prefix.length, start + prefix.length + content.length);
  }

  function prefixLines(prefixForLine: (line: string, index: number) => string, placeholder: string) {
    const source = lineSelection || placeholder;
    const lines = source.split("\n");
    const insert = lines.map((line, index) => line.trim() ? `${prefixForLine(line, index)}${line.replace(/^\s+/, "")}` : line).join("\n");
    const next = value.slice(0, lineStart) + insert + value.slice(lineEnd);
    return replaceRange(next, lineStart, lineStart + insert.length);
  }

  if (tool === "bold") {
    return wrap("**", "**", "bold text");
  }
  if (tool === "italic") {
    return wrap("_", "_", "italic text");
  }
  if (tool === "underline") {
    return wrap("__", "__", "underlined text");
  }
  if (tool === "strike") {
    return wrap("~~", "~~", "struck text");
  }
  if (tool === "inlineCode") {
    return wrap("`", "`", "code");
  }
  if (tool === "link") {
    const content = selected || "link text";
    const insert = `[${content}](https://)`;
    const next = value.slice(0, start) + insert + value.slice(end);
    const urlStart = start + content.length + 3;
    return replaceRange(next, urlStart, urlStart + "https://".length);
  }
  if (tool === "heading2") {
    return prefixLines(() => "## ", "Heading");
  }
  if (tool === "heading3") {
    return prefixLines(() => "### ", "Subheading");
  }
  if (tool === "bulletList") {
    return prefixLines(() => "- ", "List item");
  }
  if (tool === "orderedList") {
    return prefixLines((_line, index) => `${index + 1}. `, "List item");
  }
  if (tool === "quote") {
    return prefixLines(() => "> ", "Quoted note");
  }
  if (tool === "codeBlock") {
    const content = selected || "code";
    const leadingBreak = start > 0 && value[start - 1] !== "\n" ? "\n\n" : "";
    const trailingBreak = end < value.length && value[end] !== "\n" ? "\n\n" : "";
    const insert = `${leadingBreak}\`\`\`\n${content}\n\`\`\`${trailingBreak}`;
    const next = value.slice(0, start) + insert + value.slice(end);
    const contentStart = start + leadingBreak.length + 4;
    return replaceRange(next, contentStart, contentStart + content.length);
  }

  const leadingBreak = start > 0 && !value.slice(0, start).endsWith("\n\n") ? "\n\n" : "";
  const trailingBreak = end < value.length && !value.slice(end).startsWith("\n\n") ? "\n\n" : "";
  const insert = `${leadingBreak}---${trailingBreak}`;
  const next = value.slice(0, start) + insert + value.slice(end);
  return replaceRange(next, start + insert.length, start + insert.length);
}

function buildJiraCommentAdf(markup: string): JiraAdfDocument {
  const lines = String(markup || "").replace(/\r\n/g, "\n").split("\n");
  const content: JiraAdfNode[] = [];
  let index = 0;

  function pushParagraph(paragraphLines: string[]) {
    const text = paragraphLines.join("\n").trimEnd();
    if (text.trim()) {
      content.push(paragraphNode(text));
    }
  }

  while (index < lines.length) {
    const line = lines[index] || "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = trimmed.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      content.push({
        type: "codeBlock",
        attrs: fence[1] ? { language: fence[1] } : undefined,
        content: [{ type: "text", text: codeLines.join("\n") || " " }]
      });
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      content.push({ type: "rule" });
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      content.push({
        type: "heading",
        attrs: { level: Math.min(3, heading[1].length) },
        content: inlineNodes(heading[2])
      });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test((lines[index] || "").trim())) {
        quoteLines.push((lines[index] || "").trim().replace(/^>\s?/, ""));
        index += 1;
      }
      content.push({
        type: "blockquote",
        content: quoteLines.join("\n\n").split(/\n{2,}/).filter(Boolean).map((text) => paragraphNode(text))
      });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: JiraAdfNode[] = [];
      while (index < lines.length && /^[-*]\s+/.test((lines[index] || "").trim())) {
        items.push(listItemNode((lines[index] || "").trim().replace(/^[-*]\s+/, "")));
        index += 1;
      }
      content.push({ type: "bulletList", content: items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: JiraAdfNode[] = [];
      while (index < lines.length && /^\d+\.\s+/.test((lines[index] || "").trim())) {
        items.push(listItemNode((lines[index] || "").trim().replace(/^\d+\.\s+/, "")));
        index += 1;
      }
      content.push({ type: "orderedList", content: items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index] || "";
      const candidateTrimmed = candidate.trim();
      if (!candidateTrimmed) {
        break;
      }
      if (
        /^```/.test(candidateTrimmed)
        || /^---+$/.test(candidateTrimmed)
        || /^(#{1,3})\s+/.test(candidateTrimmed)
        || /^>\s?/.test(candidateTrimmed)
        || /^[-*]\s+/.test(candidateTrimmed)
        || /^\d+\.\s+/.test(candidateTrimmed)
      ) {
        break;
      }
      paragraphLines.push(candidate);
      index += 1;
    }
    pushParagraph(paragraphLines);
  }

  return {
    type: "doc",
    version: 1,
    content: content.length ? content : [paragraphNode(String(markup || "").trim() || " ")]
  };
}

function listItemNode(text: string): JiraAdfNode {
  return {
    type: "listItem",
    content: [paragraphNode(text)]
  };
}

function paragraphNode(text: string): JiraAdfNode {
  const lines = String(text || "").split("\n");
  const content = lines.flatMap((line, index) => {
    const nodes: JiraAdfNode[] = [];
    if (index > 0) {
      nodes.push({ type: "hardBreak" });
    }
    nodes.push(...inlineNodes(line));
    return nodes;
  });

  return {
    type: "paragraph",
    content: content.length ? content : [{ type: "text", text: " " }]
  };
}

function inlineNodes(text: string): JiraAdfNode[] {
  const nodes: JiraAdfNode[] = [];
  const tokenPattern = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|_[^_]+_|\[[^\]]+\]\(([^)]+)\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push({ type: "text", text: text.slice(cursor, match.index) });
    }

    const token = match[0];
    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const href = safeJiraCommentHref(linkMatch[2]);
      nodes.push(href
        ? { type: "text", text: linkMatch[1], marks: [{ type: "link", attrs: { href } }] }
        : { type: "text", text: linkMatch[1] });
    } else if (token.startsWith("**")) {
      nodes.push({ type: "text", text: token.slice(2, -2), marks: [{ type: "strong" }] });
    } else if (token.startsWith("__")) {
      nodes.push({ type: "text", text: token.slice(2, -2), marks: [{ type: "underline" }] });
    } else if (token.startsWith("~~")) {
      nodes.push({ type: "text", text: token.slice(2, -2), marks: [{ type: "strike" }] });
    } else if (token.startsWith("`")) {
      nodes.push({ type: "text", text: token.slice(1, -1), marks: [{ type: "code" }] });
    } else if (token.startsWith("_")) {
      nodes.push({ type: "text", text: token.slice(1, -1), marks: [{ type: "em" }] });
    }

    cursor = tokenPattern.lastIndex;
  }

  if (cursor < text.length) {
    nodes.push({ type: "text", text: text.slice(cursor) });
  }

  return nodes.length ? nodes : [{ type: "text", text: " " }];
}

function safeJiraCommentHref(value: string) {
  const href = String(value || "").trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(href) ? href : "";
}

function ChecklistWorkspace({ issue, data }: { issue: Issue; data: DashboardData | null }) {
  const storageKey = useMemo(() => checklistStorageKey(data, issue), [data, issue]);
  const [workspace, setWorkspace] = useState<ChecklistWorkspaceState>(() => createWorkspace(issue, null));

  useEffect(() => {
    setWorkspace(createWorkspace(issue, storageKey));
  }, [issue, storageKey]);

  useEffect(() => {
    if (!storageKey || workspace.status === "submitting") {
      return;
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify({
        items: workspace.items,
        evidence: workspace.evidence,
        concerns: workspace.concerns,
        status: workspace.status,
        message: workspace.message,
        submittedAt: workspace.submittedAt
      }));
    } catch (error) {
      console.warn("Could not save checklist workspace.", error);
    }
  }, [storageKey, workspace]);

  const completeCount = workspace.items.filter((item) => item.done).length;
  const preview = buildCommentPreview(issue, data, workspace);
  const canSubmit = workspace.items.length > 0 && workspace.status !== "submitting";

  function updateWorkspace(next: Partial<ChecklistWorkspaceState>) {
    setWorkspace((current) => ({
      ...current,
      ...next,
      status: current.status === "submitted" || current.status === "ready" ? "draft" : current.status,
      message: current.status === "failed" ? "" : current.message
    }));
  }

  function updateItem(itemId: string, next: Partial<ChecklistItem>) {
    setWorkspace((current) => ({
      ...current,
      status: current.status === "submitted" || current.status === "ready" ? "draft" : current.status,
      message: current.status === "failed" ? "" : current.message,
      items: current.items.map((item) => item.id === itemId ? { ...item, ...next } : item)
    }));
  }

  function addManualItem() {
    setWorkspace((current) => ({
      ...current,
      status: "draft",
      message: "",
      items: [...current.items, makeManualItem()]
    }));
  }

  function removeItem(itemId: string) {
    setWorkspace((current) => ({
      ...current,
      status: "draft",
      message: "",
      items: current.items.filter((item) => item.id !== itemId)
    }));
  }

  function markReady() {
    setWorkspace((current) => ({
      ...current,
      status: current.items.length ? "ready" : "draft",
      message: current.items.length ? "Ready to submit through the Cloudflare bridge." : "Add at least one test case first."
    }));
  }

  async function submitChecklist() {
    if (!canSubmit) {
      return;
    }

    const endpoint = checklistEndpoint(data);
    if (!endpoint) {
      setWorkspace((current) => ({
        ...current,
        status: "failed",
        message: "Checklist bridge endpoint is not configured for this board."
      }));
      return;
    }

    setWorkspace((current) => ({
      ...current,
      status: "submitting",
      message: "Submitting checklist comment through the Cloudflare bridge..."
    }));

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        credentials: "include",
        body: JSON.stringify(buildChecklistPayload(issue, data, workspace))
      });
      const payload = await response.json().catch(() => ({ ok: false, message: "The checklist bridge returned an unreadable response." }));

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || payload.error || "The checklist bridge rejected the request.");
      }

      setWorkspace((current) => ({
        ...current,
        status: "submitted",
        submittedAt: new Date().toISOString(),
        message: "Jira comment request accepted."
      }));
    } catch (error) {
      setWorkspace((current) => ({
        ...current,
        status: "failed",
        message: error instanceof Error ? error.message : "Bridge could not submit the Jira comment."
      }));
    }
  }

  return (
    <section className="checklist-workspace" aria-label="Checklist workspace">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">QA workspace</p>
          <h3>Checklist workspace</h3>
        </div>
        <span className={`workspace-state ${workspace.status}`}>{workspaceStatusLabel(workspace.status)}</span>
      </div>

      <div className="workspace-progress">
        <span>{completeCount} of {workspace.items.length} complete</span>
        <span>{sourceFileLabels(issue).join(", ") || "Manual checklist"}</span>
      </div>

      <div className="workspace-ticket-fields">
        <label>
          <span>Evidence</span>
          <textarea
            value={workspace.evidence}
            onChange={(event) => updateWorkspace({ evidence: event.target.value })}
            placeholder="Build, environment, data setup, screenshots, or API evidence"
          />
        </label>
        <label>
          <span>Concerns</span>
          <textarea
            value={workspace.concerns}
            onChange={(event) => updateWorkspace({ concerns: event.target.value })}
            placeholder="Risks, follow-ups, blockers, or open questions"
          />
        </label>
      </div>

      <div className="workspace-items">
        {workspace.items.length ? workspace.items.map((item, index) => (
          <article className="workspace-item" key={item.id}>
            <label className="workspace-check">
              <input type="checkbox" checked={item.done} onChange={(event) => updateItem(item.id, { done: event.target.checked })} />
              <span>{index + 1}</span>
            </label>
            <div className="workspace-item-body">
              <input value={item.title} onChange={(event) => updateItem(item.id, { title: event.target.value })} aria-label="Test case title" />
              <textarea value={item.notes} onChange={(event) => updateItem(item.id, { notes: event.target.value })} placeholder="Result notes" aria-label="Result notes" />
              {item.description || item.checks.length ? (
                <details>
                  <summary>{item.manual ? "Manual case" : "Imported case"}{item.checks.length ? ` / ${item.checks.length} checks` : ""}</summary>
                  {item.description ? <p>{item.description}</p> : null}
                  {item.checks.length ? <ul>{item.checks.map((check) => <li key={check}>{check}</li>)}</ul> : null}
                </details>
              ) : null}
            </div>
            <button className="workspace-remove" type="button" onClick={() => removeItem(item.id)} aria-label="Remove test case">x</button>
          </article>
        )) : <p className="workspace-empty">No test cases yet. Add a manual case to start this checklist.</p>}
      </div>

      <div className="workspace-actions">
        <button type="button" onClick={addManualItem}>Add manual case</button>
        <button type="button" onClick={markReady}>Mark ready</button>
        <button type="button" className="primary-action" disabled={!canSubmit} onClick={submitChecklist}>
          {workspace.status === "submitting" ? "Submitting..." : "Submit Jira comment"}
        </button>
      </div>

      {workspace.message ? <p className={`workspace-message ${workspace.status}`} role="status">{workspace.message}</p> : null}

      <details className="comment-preview" open>
        <summary>Jira comment preview</summary>
        <pre>{preview}</pre>
      </details>
    </section>
  );
}

async function fetchDashboardData(requestedUrl: string): Promise<DashboardData> {
  const candidates = [...new Set([requestedUrl, "dashboard-data.json", "../dashboard-data.json"])]
    .filter(Boolean)
    .map((value) => new URL(value, window.location.href).toString());

  let lastError = "";

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${candidate}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError || "Unable to load dashboard-data.json.");
}

async function fetchBoardRegistry(requestedUrl: string): Promise<BoardRegistry> {
  const candidates = [...new Set([requestedUrl, "../boards.json", "boards.json"])]
    .filter(Boolean)
    .map((value) => new URL(value, window.location.href).toString());

  let lastError = "";

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${candidate}`);
      }

      const registry = await response.json();
      if (!Array.isArray(registry.boards)) {
        throw new Error(`boards array missing from ${candidate}`);
      }

      return registry;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError || "Unable to load boards.json.");
}

function createFilterOptions(issues: Issue[]): FilterOptionSet {
  return {
    statuses: toSelectOptions(uniqueValues(issues.map((issue) => issue.status))),
    assignees: assigneeOptions(issues),
    priorities: toSelectOptions(uniqueValues(issues.map((issue) => issue.priority || "None"))),
    components: toSelectOptions(uniqueValues(issues.flatMap((issue) => issue.components || [])))
  };
}

function matchesFilters(issue: Issue, filters: Filters, changeSets: ChangeSets, activePreset: PresetKey) {
  const searchText = [
    issue.key,
    issue.summary,
    issue.status,
    issue.priority,
    issue.assignee,
    issue.assignedDeveloper,
    parentLabel(issue),
    ...(issue.components || [])
  ].filter(Boolean).join(" ").toLowerCase();
  const key = issue.key || "";

  return (!filters.search || searchText.includes(filters.search.toLowerCase()))
    && (!filters.status || issue.status === filters.status)
    && (!filters.assignee || (issue.assignee || "Unassigned") === filters.assignee)
    && (!filters.priority || (issue.priority || "None") === filters.priority)
    && (!filters.component || (issue.components || []).includes(filters.component))
    && matchesParentFilter(issue, filters.parent)
    && matchesChangedFilter(key, filters.changed, changeSets)
    && matchesActivePreset(issue, activePreset, changeSets);
}

function groupIssuesForCards(issues: Issue[], filters: Filters, changeSets: ChangeSets, activePreset: PresetKey): TicketGroup[] {
  const mainIssues: Issue[] = [];
  const subtasksByParent = new Map<string, Issue[]>();
  const orphanSubtasks: Issue[] = [];
  const isAssigneeScoped = Boolean(filters.assignee);

  for (const issue of issues) {
    if (!issue.isSubtask) {
      mainIssues.push(issue);
      continue;
    }

    const key = parentKey(issue);
    if (!key) {
      orphanSubtasks.push(issue);
      continue;
    }

    const parentSubtasks = subtasksByParent.get(key) || [];
    parentSubtasks.push(issue);
    subtasksByParent.set(key, parentSubtasks);
  }

  const grouped: TicketGroup[] = [];
  const groupedParents = new Set<string>();

  for (const issue of mainIssues) {
    const issueKey = issue.key || "";
    const subtasks = issueKey ? (subtasksByParent.get(issueKey) || []) : [];
    const mainMatches = matchesFilters(issue, filters, changeSets, activePreset);
    const matchingSubtasks = subtasks.filter((subtask) => matchesFilters(subtask, filters, changeSets, activePreset));

    if (!mainMatches && matchingSubtasks.length === 0) {
      continue;
    }

    grouped.push({
      issue,
      subtasks,
      visibleSubtasks: mainMatches && filters.parent !== "subtasks" && !isAssigneeScoped ? subtasks : matchingSubtasks,
      matchedBySubtask: !mainMatches && matchingSubtasks.length > 0
    });

    if (issueKey) {
      groupedParents.add(issueKey);
    }
  }

  for (const [parent, subtasks] of subtasksByParent.entries()) {
    if (groupedParents.has(parent)) {
      continue;
    }

    for (const subtask of subtasks) {
      if (matchesFilters(subtask, filters, changeSets, activePreset)) {
        grouped.push({
          issue: subtask,
          subtasks: [],
          visibleSubtasks: [],
          matchedBySubtask: true
        });
      }
    }
  }

  for (const subtask of orphanSubtasks) {
    if (matchesFilters(subtask, filters, changeSets, activePreset)) {
      grouped.push({
        issue: subtask,
        subtasks: [],
        visibleSubtasks: [],
        matchedBySubtask: true
      });
    }
  }

  return grouped;
}

function buildComponentCounts(issues: Issue[]) {
  return [...countBy(issues.flatMap((issue) => issue.components || []), (component) => component).entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function groupTicketSections(groups: TicketGroup[]): TicketSection[] {
  const sectionsByStatus = new Map<string, TicketGroup[]>();

  for (const group of groups) {
    const status = group.issue.status || "No status";
    const sectionGroups = sectionsByStatus.get(status) || [];
    sectionGroups.push(group);
    sectionsByStatus.set(status, sectionGroups);
  }

  return [...sectionsByStatus.entries()]
    .sort((left, right) => statusRank(left[0]) - statusRank(right[0]) || left[0].localeCompare(right[0]))
    .map(([status, sectionGroups]) => ({
      status,
      groups: sectionGroups.sort(compareTicketGroups)
    }));
}

function distributeTicketSections(sections: TicketSection[], openSubtaskParents: Set<string>, collapsedStatuses: Set<string>): TicketColumn[] {
  const columns = Array.from({ length: CARD_COLUMN_COUNT }, (_, index) => ({ id: index, weight: 0, sections: [] as TicketSection[] }));

  for (const section of sections) {
    const target = columns.reduce((lightest, column) => column.weight < lightest.weight ? column : lightest, columns[0]);
    target.sections.push(section);
    target.weight += estimateTicketSectionWeight(section, openSubtaskParents, collapsedStatuses);
  }

  return columns.filter((column) => column.sections.length > 0);
}

function estimateTicketSectionWeight(section: TicketSection, openSubtaskParents: Set<string>, collapsedStatuses: Set<string>) {
  if (collapsedStatuses.has(section.status)) {
    return 1.2;
  }

  return 1.4 + section.groups.reduce((total, group) => total + estimateTicketGroupWeight(group, openSubtaskParents), 0);
}

function estimateTicketGroupWeight(group: TicketGroup, openSubtaskParents: Set<string>) {
  const parentKeyValue = group.issue.key || "";
  const openSubtaskWeight = parentKeyValue && openSubtaskParents.has(parentKeyValue) ? group.visibleSubtasks.length * 0.64 : 0;
  const descriptionWeight = Math.min(1.1, (group.issue.summary || "").length / 150);
  return 1 + descriptionWeight + openSubtaskWeight;
}

function compareTicketGroups(left: TicketGroup, right: TicketGroup) {
  return priorityRank(left.issue.priority) - priorityRank(right.issue.priority)
    || updatedTime(right.issue) - updatedTime(left.issue)
    || (left.issue.key || "").localeCompare(right.issue.key || "");
}

function statusRank(status: string) {
  const normalized = status.toLowerCase();
  const index = STATUS_ORDER.findIndex((value) => value.toLowerCase() === normalized);
  return index >= 0 ? index : STATUS_ORDER.length + normalized.charCodeAt(0);
}

function priorityRank(priority?: string) {
  const normalized = (priority || "None").toUpperCase();
  if (normalized === "P0") return 0;
  if (normalized === "P1") return 1;
  if (normalized === "P2") return 2;
  if (normalized === "P3") return 3;
  if (normalized === "P4") return 4;
  if (normalized === "NONE") return 8;
  return 6;
}

function updatedTime(issue: Issue) {
  const value = issue.updated || issue.updatedDisplay || "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function matchesActivePreset(issue: Issue, activePreset: PresetKey, changeSets: ChangeSets) {
  if (activePreset === "qa") {
    return (issue.status || "").toLowerCase().includes("qa");
  }

  if (activePreset === "review") {
    return (issue.status || "").toLowerCase().includes("review");
  }

  if (activePreset === "moves") {
    return changeSets.status.has(issue.key || "");
  }

  if (activePreset === "unassigned") {
    return !issue.assignee || issue.assignee === "Unassigned";
  }

  return true;
}

function matchesParentFilter(issue: Issue, filter: string) {
  if (filter === "main") {
    return !issue.isSubtask;
  }

  if (filter === "subtasks") {
    return Boolean(issue.isSubtask);
  }

  if (filter === "has-parent") {
    return Boolean(issue.parent);
  }

  return true;
}

function matchesChangedFilter(key: string, filter: string, changeSets: ChangeSets) {
  if (!filter) {
    return true;
  }

  if (filter === "any") {
    return changeSets.any.has(key);
  }

  if (filter === "status") {
    return changeSets.status.has(key);
  }

  if (filter === "added") {
    return changeSets.added.has(key);
  }

  if (filter === "updated") {
    return changeSets.updated.has(key);
  }

  return true;
}

function presetFilters(preset: PresetKey): Filters {
  if (preset === "qa") {
    return EMPTY_FILTERS;
  }

  if (preset === "review") {
    return EMPTY_FILTERS;
  }

  if (preset === "moves") {
    return { ...EMPTY_FILTERS, changed: "status" };
  }

  if (preset === "unassigned") {
    return { ...EMPTY_FILTERS, assignee: "Unassigned" };
  }

  return EMPTY_FILTERS;
}

function createChangeSets(data: DashboardData | null): ChangeSets {
  const added = createKeySet(data?.pullDiff?.added);
  const updated = createKeySet(data?.pullDiff?.updated);
  const status = createKeySet(data?.pullDiff?.statusChanges);
  const any = new Set([...added, ...updated, ...status]);
  return { added, updated, status, any };
}

function createKeySet(changes?: PullChange[]) {
  return new Set((changes || []).map(extractChangeKey).filter(Boolean));
}

function extractChangeKey(change: PullChange) {
  if (typeof change === "string") {
    return change;
  }

  return change.key || change.issueKey || change.issue?.key || "";
}

function changeLabels(key: string, changeSets: ChangeSets) {
  return [
    changeSets.added.has(key) ? "Added" : "",
    changeSets.updated.has(key) ? "Updated" : "",
    changeSets.status.has(key) ? "Status moved" : ""
  ].filter(Boolean);
}

function uniqueValues(values: Array<string | undefined>) {
  return [...new Set(values.filter(Boolean) as string[])]
    .sort((left, right) => left.localeCompare(right));
}

function boardStatusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "active" || normalized === "current") {
    return "active";
  }

  if (normalized === "planned") {
    return "planned";
  }

  if (normalized === "archived") {
    return "archived";
  }

  return "listed";
}

function currentBoardEntry(registry: BoardRegistry | null, currentVersion?: string) {
  if (!currentVersion) {
    return registry?.boards?.[0] || null;
  }

  return registry?.boards?.find((board) => board.release === currentVersion || board.fixVersion === currentVersion) || null;
}

function buildCutoverValidation(data: DashboardData | null, registry: BoardRegistry | null, loadError: string): OperationsHealth {
  const board = currentBoardEntry(registry, data?.version);
  const repo = data?.repositorySlug || board?.repositorySlug || "";
  const boardUrl = data?.dashboardUrl || board?.url || "../";
  const modernUrl = board?.modernUrl || "./";
  const bridgeEndpoint = data?.assigneeDispatchEndpoint || "";
  const commentEndpoint = checklistEndpoint(data);
  const bridgeStatus = bridgeEndpoint ? bridgeStatusUrl(bridgeEndpoint) : "";
  const commentStatus = commentEndpoint ? bridgeStatusUrl(commentEndpoint) : bridgeStatus;
  const bridgeIsLocal = Boolean(bridgeEndpoint && isLocalBridgeEndpoint(bridgeEndpoint));
  const commentIsLocal = Boolean(commentEndpoint && isLocalBridgeEndpoint(commentEndpoint));
  const bridgeIsHosted = Boolean(bridgeEndpoint && isHostedBridgeEndpoint(bridgeEndpoint));
  const runbookUrl = "https://dewankabir009.github.io/jira-board-v3001-122-0/modern-dashboard-specs/specs/cutover-readiness-validation.md";

  const readGate: OperationsHealthItem = loadError ? {
    title: "Read parity snapshot",
    status: "Data blocked",
    detail: loadError,
    tone: "danger",
    links: [{ label: "Current board", href: boardUrl }]
  } : {
    title: "Read parity snapshot",
    status: data ? "Snapshot loaded" : "Waiting",
    detail: data
      ? `Automatic check: modern preview is reading the published Jira snapshot for ${data.version || "this board"}.`
      : "Waiting for dashboard-data.json before parity can be reviewed.",
    tone: data ? "good" : "neutral",
    links: [
      { label: "Current board", href: boardUrl },
      { label: "Modern preview", href: modernUrl },
      ...(data?.dataArtifact?.fileName ? [{ label: "Data artifact", href: `../${data.dataArtifact.fileName}` }] : [])
    ]
  };

  const pagesGate: OperationsHealthItem = {
    title: "GitHub Pages review",
    status: data ? "Preview loaded" : "Waiting",
    detail: data
      ? "Automatic check: the modern GitHub Pages bundle loaded and can reach its dashboard data artifact. This does not prove manual Jira write flows."
      : "Waiting for the published page and data artifact before the Pages review can be marked visible.",
    tone: data ? "good" : "neutral",
    links: [
      { label: "Modern preview", href: modernUrl },
      ...(repo ? [{ label: "Pages deployments", href: `https://github.com/${repo}/deployments` }] : [])
    ]
  };

  const assigneeGate: OperationsHealthItem = {
    title: "Assignee write",
    status: !data ? "Waiting" : bridgeIsLocal ? "Local endpoint" : !bridgeEndpoint ? "Bridge missing" : "Manual evidence pending",
    detail: !data
      ? "Bridge configuration appears after the dashboard data loads."
      : bridgeIsLocal
        ? "This board still points at a laptop-local endpoint. Live cutover requires the hosted Cloudflare bridge."
        : !bridgeEndpoint
          ? "No assignee dispatch endpoint is present in dashboard-data.json."
          : bridgeIsHosted
            ? "Manual gate: hosted Cloudflare route is configured, but the static dashboard cannot prove a Jira write happened. Complete with a named test ticket, Jira assignee readback, and the matching Slack tag."
            : "Manual gate: a non-local bridge is configured. Complete with a named test ticket and Jira assignee readback.",
    tone: !data ? "neutral" : bridgeIsLocal || !bridgeEndpoint ? "danger" : "attention",
    links: [
      ...(bridgeStatus ? [{ label: bridgeIsHosted ? "Cloudflare status" : "Bridge status", href: bridgeStatus }] : []),
      ...(repo ? [{ label: "Assign workflow", href: workflowUrl(repo, "update-jira-assignee.yml") }] : []),
      { label: "Current board", href: boardUrl }
    ]
  };

  const checklistGate: OperationsHealthItem = {
    title: "Checklist comment",
    status: !data ? "Waiting" : commentIsLocal ? "Local endpoint" : !commentEndpoint ? "Route missing" : "Manual evidence pending",
    detail: !data
      ? "Checklist comment route appears after the dashboard data loads."
      : commentIsLocal
        ? "Checklist comments still point at a laptop-local endpoint. Live cutover requires the hosted Cloudflare bridge."
        : !commentEndpoint
          ? "No checklist comment endpoint can be resolved for this board."
          : "Manual gate: post one checklist comment from a named test ticket, then confirm the Jira comment body and dashboard state remain consistent.",
    tone: !data ? "neutral" : commentIsLocal || !commentEndpoint ? "danger" : "attention",
    links: [
      ...(commentStatus ? [{ label: "Comment bridge", href: commentStatus }] : []),
      { label: "Current board", href: boardUrl }
    ]
  };

  const slackGate: OperationsHealthItem = {
    title: "Slack delivery",
    status: repo ? "Manual evidence pending" : "Repository unknown",
    detail: repo
      ? "Manual gate: confirm core-qa-dream-team receives the assignee-update message with the expected person tag, then confirm dashboard refresh notifications still land."
      : "Repository metadata is required before Slack workflows can be reviewed.",
    tone: repo ? "attention" : "neutral",
    links: repo ? [
      { label: "Assign workflow", href: workflowUrl(repo, "update-jira-assignee.yml") },
      { label: "Notify workflow", href: workflowUrl(repo, "notify-dashboard-push.yml") }
    ] : []
  };

  const signoffGate: OperationsHealthItem = {
    title: "Final cutover signoff",
    status: "Manual evidence pending",
    detail: "Manual gate: promote the modern board only after read parity, Jira writes, checklist comments, Slack notifications, and fallback notes are attached to the runbook.",
    tone: "warning",
    links: [{ label: "Validation runbook", href: runbookUrl }]
  };

  const items = [readGate, pagesGate, assigneeGate, checklistGate, slackGate, signoffGate];
  const hasDanger = items.some((item) => item.tone === "danger");
  const automaticReadyCount = [readGate, pagesGate].filter((item) => item.tone === "good").length;

  return {
    summary: hasDanger ? "Fix blockers first" : `${automaticReadyCount}/2 automatic checks ready; 4 manual gates pending`,
    summaryTone: hasDanger ? "danger" : automaticReadyCount === 2 ? "attention" : "neutral",
    items
  };
}

function buildOperationsHealth(data: DashboardData | null, loadError: string): OperationsHealth {
  const repo = data?.repositorySlug || "";
  const bridge = bridgeHealth(data);
  const dataStatus: OperationsHealthItem = loadError ? {
    title: "Jira data pull",
    status: "Data blocked",
    detail: loadError,
    tone: "danger",
    links: data?.dataArtifact?.fileName ? [{ label: "Data artifact", href: data.dataArtifact.fileName }] : []
  } : {
    title: "Jira data pull",
    status: data ? "Loaded" : "Loading",
    detail: data
      ? `Latest Jira snapshot: ${latestPullLabel(data)}. This is independent from assign and comment writes.`
      : "Waiting for dashboard-data.json to load.",
    tone: data ? "good" : "neutral",
    links: data?.dataArtifact?.fileName ? [{ label: "Data artifact", href: data.dataArtifact.fileName }] : []
  };

  const pagesStatus: OperationsHealthItem = {
    title: "GitHub Pages preview",
    status: data ? "Published" : "Waiting",
    detail: data
      ? `This modern preview loaded from the published Pages bundle for ${data.version || "this board"}.`
      : "The preview shell is available while the data artifact is loading.",
    tone: data ? "good" : "neutral",
    links: [
      ...(data?.dashboardUrl ? [{ label: "Live board", href: data.dashboardUrl }] : []),
      ...(repo ? [{ label: "Pages deploys", href: `https://github.com/${repo}/deployments` }] : [])
    ]
  };

  const bridgeStatus: OperationsHealthItem = {
    title: "Jira write bridge",
    status: bridge.status,
    detail: bridge.detail,
    tone: bridge.tone,
    links: [
      ...(bridge.statusUrl ? [{ label: bridge.linkLabel, href: bridge.statusUrl }] : []),
      ...(repo ? [{ label: "Assign workflow", href: workflowUrl(repo, "update-jira-assignee.yml") }] : [])
    ]
  };

  const actionsStatus: OperationsHealthItem = {
    title: "Workflow runs",
    status: repo ? "Review live runs" : "Repository unknown",
    detail: repo
      ? "Refreshes, assignee updates, and dashboard push notifications each have separate workflow histories."
      : "Repository metadata is not available in the data artifact.",
    tone: repo ? "attention" : "neutral",
    links: repo ? [
      { label: "Refresh data", href: workflowUrl(repo, "refresh-jira-board.yml") },
      { label: "All Actions", href: `https://github.com/${repo}/actions` }
    ] : []
  };

  const slackStatus: OperationsHealthItem = {
    title: "Slack notifications",
    status: repo ? "Workflow hook" : "Not inspected",
    detail: repo
      ? "Ticket refresh and dashboard push notifications are workflow-driven, so delivery health should be checked separately from bridge auth."
      : "Slack notification status depends on workflow configuration.",
    tone: repo ? "attention" : "neutral",
    links: repo ? [{ label: "Notify workflow", href: workflowUrl(repo, "notify-dashboard-push.yml") }] : []
  };

  const hasDanger = [dataStatus, pagesStatus, bridgeStatus, actionsStatus, slackStatus].some((item) => item.tone === "danger");
  const hasAttention = [dataStatus, pagesStatus, bridgeStatus, actionsStatus, slackStatus].some((item) => item.tone === "attention" || item.tone === "warning");

  return {
    summary: hasDanger ? "Needs attention" : hasAttention ? "Check linked systems" : "Core paths visible",
    summaryTone: hasDanger ? "danger" : hasAttention ? "attention" : "good",
    items: [dataStatus, pagesStatus, bridgeStatus, actionsStatus, slackStatus]
  };
}

function bridgeButtonStatus(data: DashboardData | null): BridgeButtonStatus {
  const endpoint = data?.assigneeDispatchEndpoint || "";

  if (!data) {
    return { label: "Loading", tone: "neutral" };
  }

  if (!endpoint) {
    return { label: "Missing", tone: "danger" };
  }

  if (isLocalBridgeEndpoint(endpoint)) {
    return { label: "Local", tone: "danger" };
  }

  if (isHostedBridgeEndpoint(endpoint)) {
    return { label: "Login", tone: "attention" };
  }

  return { label: "External", tone: "attention" };
}

function bridgeHealth(data: DashboardData | null): { status: string; detail: string; tone: HealthTone; statusUrl: string; linkLabel: string } {
  const endpoint = data?.assigneeDispatchEndpoint || "";

  if (!data) {
    return {
      status: "Waiting",
      detail: "Bridge configuration will appear after the data artifact loads.",
      tone: "neutral",
      statusUrl: "",
      linkLabel: "Bridge status"
    };
  }

  if (!endpoint) {
    return {
      status: "Not configured",
      detail: "No assignee dispatch endpoint is present in dashboard-data.json.",
      tone: "danger",
      statusUrl: "",
      linkLabel: "Bridge status"
    };
  }

  const statusUrl = bridgeStatusUrl(endpoint);
  if (isLocalBridgeEndpoint(endpoint)) {
    return {
      status: "Local endpoint",
      detail: "This board points at localhost. Live GitHub Pages boards must use the hosted Cloudflare bridge, not a laptop-local bridge.",
      tone: "danger",
      statusUrl,
      linkLabel: "Local status"
    };
  }

  if (isHostedBridgeEndpoint(endpoint)) {
    return {
      status: "Cloudflare Login",
      detail: "Jira assign and checklist comments route through the hosted Worker. Open the Access login/status link if writes need to be re-enabled.",
      tone: "attention",
      statusUrl,
      linkLabel: "Re-enable bridge"
    };
  }

  return {
    status: "External bridge",
    detail: "A non-local dispatch endpoint is configured. Check its status separately from Jira data refresh.",
    tone: "attention",
    statusUrl,
    linkLabel: "Bridge status"
  };
}

function latestPullLabel(data: DashboardData) {
  return data.pullDiff?.currentPulledAtDisplay || data.pulledAtDisplay || data.pulledAt || "pending";
}

function workflowUrl(repositorySlug: string, workflowName: string) {
  return `https://github.com/${repositorySlug}/actions/workflows/${workflowName}`;
}

function bridgeStatusUrl(endpoint: string) {
  return endpoint.replace(/\/assign$/, "/status").replace(/\/comment-checklist$/, "/status").replace(/\/comment$/, "/status");
}

function isLocalBridgeEndpoint(endpoint: string) {
  return /(^|\/\/)(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(endpoint);
}

function isHostedBridgeEndpoint(endpoint: string) {
  return /jira-board-assignee-bridge\.dfkabir253\.workers\.dev/i.test(endpoint);
}

function normalizedPullHistory(data: DashboardData | null) {
  if (Array.isArray(data?.pullHistory) && data.pullHistory.length) {
    return data.pullHistory;
  }

  return data?.pullDiff ? [data.pullDiff] : [];
}

function getDiffLists(diff?: PullDiffEntry | null) {
  return {
    added: diff?.added || [],
    removed: diff?.removed || [],
    updated: diff?.updated || [],
    statusChanges: diff?.statusChanges || []
  };
}

function pullHasChanges(diff?: PullDiffEntry | null) {
  const lists = getDiffLists(diff);
  return Boolean(lists.added.length || lists.updated.length || lists.statusChanges.length || lists.removed.length);
}

function pullDisplay(value?: string) {
  if (!value) {
    return "Pending";
  }

  if (/no previous pull/i.test(value) || /\b(ET|UTC)\b/i.test(value) || /Z$/.test(value)) {
    return value;
  }

  return `${value} ET`;
}

function changeHref(change: PullChange) {
  return typeof change === "string" ? "" : change.url || "";
}

function changeSummary(change: PullChange) {
  return typeof change === "string" ? "" : change.summary || "";
}

function changeParentLabel(change: PullChange) {
  if (typeof change === "string" || !change.parent) {
    return "";
  }

  if (typeof change.parent === "string") {
    return `Parent: ${change.parent}`;
  }

  const label = change.parent.key || change.parent.summary || "";
  return label ? `Parent: ${label}` : "";
}

function changeDetailLabels(change: PullChange) {
  if (typeof change === "string") {
    return [];
  }

  const details = (change.changes || []).map((entry) => {
    const field = entry.field || "Changed";
    const before = entry.before || entry.from || "Empty";
    const after = entry.after || entry.to || "Empty";
    return `${field}: ${before} -> ${after}`;
  });

  if (!details.length && (change.before || change.after)) {
    details.push(`${change.before || "Empty"} -> ${change.after || "Empty"}`);
  }

  if (!details.length && change.status) {
    details.push(`Status: ${change.status}`);
  }

  if (!details.length && change.updatedDisplay) {
    details.push(`Updated ${change.updatedDisplay}`);
  }

  return details;
}

function statusChangeLabel(change: PullChange) {
  const details = changeDetailLabels(change);
  return details[0] || "Status changed";
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function ticketCopyText(issue: Issue) {
  const key = issue.key || "Ticket";
  const summary = (issue.summary || "Untitled ticket").trim();
  const url = issue.url || "";
  return url ? `${key} - ${summary}\n${url}` : `${key} - ${summary}`;
}

function sortCommentsLatestFirst(comments: JiraComment[]) {
  return comments
    .map((comment, index) => ({ comment, index, timestamp: commentTimestamp(comment) }))
    .sort((first, second) => {
      if (second.timestamp !== first.timestamp) {
        return second.timestamp - first.timestamp;
      }
      return second.index - first.index;
    })
    .map((entry) => entry.comment);
}

function commentTimestamp(comment: JiraComment) {
  const parsed = Date.parse(comment.updatedDisplay || comment.createdDisplay || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildReleaseAnalytics(_data: DashboardData | null, issues: Issue[], changeSets: ChangeSets): ReleaseAnalytics {
  const mainTotal = issues.filter((issue) => !issue.isSubtask).length;
  const subtaskTotal = issues.length - mainTotal;

  const assignees = toDistributionRows(countBy(issues, (issue) => issue.assignee || "Unassigned"), issues.length, 6, "blue");
  const priorities = toDistributionRows(countBy(issues, (issue) => issue.priority || "None"), issues.length, 6, "amber");
  const components = toDistributionRows(countBy(issues.flatMap((issue) => issue.components?.length ? issue.components : ["No component"]), (component) => component), issues.length, 7, "green");

  return {
    issueTotal: issues.length,
    mainTotal,
    subtaskTotal,
    changedTotal: changeSets.any.size,
    assignees,
    priorities,
    components,
    insights: [
      insightForTop("Ownership", assignees, "has the highest current load"),
      insightForTop("Priority", priorities, "is the largest priority group"),
      insightForTop("Component", components, "has the most release concentration")
    ]
  };
}

function countBy<T>(items: T[], selector: (item: T) => string) {
  return items.reduce((counts, item) => {
    const label = selector(item) || "None";
    counts.set(label, (counts.get(label) || 0) + 1);
    return counts;
  }, new Map<string, number>());
}

function toDistributionRows(counts: Map<string, number>, total: number, limit: number, tone: AnalyticsTone): DistributionRow[] {
  const rows = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);

  return rows.map(([label, value]) => ({
    label,
    value,
    share: total ? (value / total) * 100 : 0,
    tone
  }));
}

function insightForTop(label: string, rows: DistributionRow[], suffix: string) {
  const top = rows[0];
  if (!top) {
    return `${label}: no data available yet.`;
  }

  return `${label}: ${top.label} ${suffix} (${top.value}).`;
}

function formatComponents(components?: string[]) {
  return components && components.length > 0 ? components.join(", ") : "None";
}

function formatSubtaskCount(visible: number, total: number) {
  if (!total) {
    return "subtasks";
  }

  const noun = total === 1 ? "subtask" : "subtasks";
  if (visible === total) {
    return `${total} ${noun}`;
  }

  return `${visible} of ${total} ${noun}`;
}

function parentLabel(issue: Issue) {
  if (!issue.parent) {
    return "";
  }

  if (typeof issue.parent === "string") {
    return issue.parent;
  }

  return issue.parent.key || issue.parent.summary || "";
}

function parentKey(issue: Issue) {
  if (!issue.parent) {
    return "";
  }

  if (typeof issue.parent === "string") {
    return issue.parent;
  }

  return issue.parent.key || "";
}

function bridgeEntryUrl(data: DashboardData | null) {
  if (!data?.assigneeDispatchEndpoint) {
    return "#";
  }

  return bridgeStatusUrl(data.assigneeDispatchEndpoint);
}

function sortLabel(value: false | "asc" | "desc") {
  if (value === "asc") {
    return "Asc";
  }

  if (value === "desc") {
    return "Desc";
  }

  return "";
}

function ariaSort(value: false | "asc" | "desc") {
  if (value === "asc") {
    return "ascending";
  }

  if (value === "desc") {
    return "descending";
  }

  return "none";
}

function createWorkspace(issue: Issue, storageKey: string | null): ChecklistWorkspaceState {
  const baseItems = baseChecklistItems(issue);
  const empty = emptyWorkspace(baseItems);

  if (!storageKey) {
    return empty;
  }

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (!saved) {
      return empty;
    }

    const savedItems = Array.isArray(saved.items) ? saved.items : [];
    const savedById = new Map(savedItems.map((item: ChecklistItem) => [item.id, item]));
    const mergedItems = baseItems.map((item) => {
      const savedItem = savedById.get(item.id);
      return savedItem ? normalizeChecklistItem({ ...item, ...savedItem }) : item;
    });

    for (const savedItem of savedItems) {
      if (savedItem?.manual && !mergedItems.some((item) => item.id === savedItem.id)) {
        mergedItems.push(normalizeChecklistItem(savedItem));
      }
    }

    return {
      items: mergedItems,
      evidence: String(saved.evidence || ""),
      concerns: String(saved.concerns || ""),
      status: isWorkspaceStatus(saved.status) ? saved.status : "draft",
      message: String(saved.message || ""),
      submittedAt: String(saved.submittedAt || "")
    };
  } catch (error) {
    console.warn("Could not load checklist workspace.", error);
    return empty;
  }
}

function emptyWorkspace(items: ChecklistItem[] = []): ChecklistWorkspaceState {
  return {
    items,
    evidence: "",
    concerns: "",
    status: "draft",
    message: "",
    submittedAt: ""
  };
}

function isWorkspaceStatus(value: unknown): value is WorkspaceStatus {
  return value === "draft" || value === "ready" || value === "submitting" || value === "submitted" || value === "failed";
}

function baseChecklistItems(issue: Issue): ChecklistItem[] {
  const testCases = Array.isArray(issue.testChecklist?.testCases) ? issue.testChecklist?.testCases : [];

  return testCases.map((testCase, index) => normalizeChecklistItem({
    id: `${testCase.sourceFile || "source"}::${testCase.id || "TC"}::${index}`,
    sourceId: testCase.id || "",
    sourceFile: testCase.sourceFile || "",
    manual: false,
    title: `${testCase.id ? `${testCase.id}: ` : ""}${testCase.title || "Untitled test case"}`,
    done: false,
    notes: "",
    description: testCase.description || "",
    checks: Array.isArray(testCase.checks) ? testCase.checks : []
  }));
}

function normalizeChecklistItem(item: Partial<ChecklistItem>): ChecklistItem {
  return {
    id: String(item.id || makeId("item")),
    sourceId: String(item.sourceId || ""),
    sourceFile: String(item.sourceFile || (item.manual ? "Manual" : "")),
    manual: Boolean(item.manual),
    title: String(item.title || "New test case"),
    done: Boolean(item.done),
    notes: String(item.notes || ""),
    description: String(item.description || ""),
    checks: Array.isArray(item.checks) ? item.checks.map((check) => String(check)) : []
  };
}

function makeManualItem(): ChecklistItem {
  return normalizeChecklistItem({
    id: makeId("manual"),
    manual: true,
    sourceFile: "Manual",
    title: "New test case",
    done: false,
    notes: ""
  });
}

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}::${crypto.randomUUID()}`;
  }

  return `${prefix}::${Date.now()}::${Math.random().toString(36).slice(2, 8)}`;
}

function checklistStorageKey(data: DashboardData | null, issue: Issue) {
  if (!issue.key) {
    return null;
  }

  const files = sourceFileLabels(issue).join("|") || "manual";
  return `modern-checklist-v1:${data?.version || "unknown"}:${issue.key}:${files}`;
}

function sourceFileLabels(issue: Issue) {
  return (issue.testChecklist?.files || [])
    .map((file) => file.filename || file.id || "")
    .filter(Boolean);
}

function workspaceStatusLabel(status: WorkspaceStatus) {
  if (status === "ready") {
    return "Ready";
  }

  if (status === "submitting") {
    return "Submitting";
  }

  if (status === "submitted") {
    return "Submitted";
  }

  if (status === "failed") {
    return "Failed";
  }

  return "Draft";
}

function checklistEndpoint(data: DashboardData | null) {
  if (data?.testChecklistCommentEndpoint) {
    return data.testChecklistCommentEndpoint;
  }

  if (data?.assigneeDispatchEndpoint) {
    return data.assigneeDispatchEndpoint.replace(/\/assign$/, "/comment-checklist");
  }

  return "";
}

function jiraCommentEndpoint(data: DashboardData | null) {
  if (data?.assigneeDispatchEndpoint) {
    return data.assigneeDispatchEndpoint.replace(/\/assign$/, "/comment");
  }

  if (data?.testChecklistCommentEndpoint) {
    return data.testChecklistCommentEndpoint.replace(/\/comment-checklist$/, "/comment");
  }

  return "";
}

function buildChecklistPayload(issue: Issue, data: DashboardData | null, workspace: ChecklistWorkspaceState) {
  return {
    issueKey: issue.key,
    issueUrl: issue.url,
    summary: issue.summary,
    releaseVersion: data?.version || "",
    repositorySlug: data?.repositorySlug || "",
    dashboardUrl: typeof window === "undefined" ? data?.dashboardUrl || "" : window.location.href,
    sourceFiles: sourceFileLabels(issue),
    items: payloadItems(workspace)
  };
}

function payloadItems(workspace: ChecklistWorkspaceState) {
  const items = workspace.items.map((item) => ({
    title: item.title,
    done: Boolean(item.done),
    notes: item.notes || "",
    images: []
  }));

  if (workspace.evidence || workspace.concerns) {
    items.push({
      title: "Ticket-level evidence and concerns",
      done: Boolean(workspace.evidence && !workspace.concerns),
      notes: [
        workspace.evidence ? `Evidence: ${workspace.evidence}` : "",
        workspace.concerns ? `Concerns: ${workspace.concerns}` : ""
      ].filter(Boolean).join("\n\n"),
      images: []
    });
  }

  return items;
}

function buildCommentPreview(issue: Issue, data: DashboardData | null, workspace: ChecklistWorkspaceState) {
  const items = payloadItems(workspace);
  const complete = items.filter((item) => item.done).length;
  const sourceFiles = sourceFileLabels(issue).join(", ") || "Manual checklist";
  const lines = [
    `Test checklist submitted for ${issue.key || "ticket"}.`,
    `Progress: ${complete} of ${items.length} complete.`,
    `Source: ${sourceFiles}.`,
    `Dashboard: ${data?.dashboardUrl || "Current board"}.`,
    "",
    "| # | Status | Test case | Notes |",
    "| --- | --- | --- | --- |",
    ...items.map((item, index) => `| ${index + 1} | ${item.done ? "Complete" : "Open"} | ${escapeTableCell(item.title)} | ${escapeTableCell(item.notes)} |`)
  ];

  return lines.join("\n");
}

function escapeTableCell(value: string) {
  return String(value || "")
    .replace(/\r?\n/g, "<br>")
    .replace(/\|/g, "\\|")
    .trim();
}
