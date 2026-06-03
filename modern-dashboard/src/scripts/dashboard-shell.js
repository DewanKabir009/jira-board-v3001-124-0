const shell = document.querySelector("[data-dashboard-shell]");

if (shell) {
  startDashboardShell(shell);
}

async function startDashboardShell(root) {
  const requestedUrl = root.dataset.dataUrl || document.documentElement.dataset.dashboardDataUrl || "../dashboard-data.json";

  try {
    const data = await fetchDashboardData(requestedUrl);
    const state = createState(data);
    renderDashboard(root, state);
    bindFilters(root, state);
  } catch (error) {
    renderLoadError(root, error);
  }
}

async function fetchDashboardData(requestedUrl) {
  const candidates = buildDataUrlCandidates(requestedUrl);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${candidate}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to load dashboard data.");
}

function buildDataUrlCandidates(requestedUrl) {
  const values = [
    requestedUrl,
    "dashboard-data.json",
    "../dashboard-data.json"
  ];

  return [...new Set(values)]
    .filter(Boolean)
    .map((value) => new URL(value, window.location.href).toString());
}

function createState(data) {
  const issues = Array.isArray(data.issues) ? data.issues : [];

  return {
    data,
    issues,
    filters: {
      search: "",
      status: "",
      assignee: "",
      priority: ""
    }
  };
}

function renderDashboard(root, state) {
  renderMeta(root, state.data);
  populateFilterOptions(root, state.issues);
  renderFilteredTickets(root, state);
}

function renderMeta(root, data) {
  setText(root, "[data-meta='version']", data.version || "Release board");
  setText(root, "[data-meta='summary']", `${data.repositorySlug || "Jira release board"} rendered from ${data.dataArtifact?.fileName || "dashboard-data.json"}.`);
  setText(root, "[data-meta='total']", String(data.total ?? data.issues?.length ?? 0));
  setText(root, "[data-meta='pulledAt']", data.pullDiff?.currentPulledAtDisplay || data.pulledAtDisplay || "Pending");
  setText(root, "[data-meta='schema']", data.schemaVersion || "dashboard-data/v1");
  setText(root, "[data-meta='bridge']", data.assigneeDispatchEndpoint ? "Cloudflare" : "Not configured");

  setHref(root, "[data-link='legacy-dashboard']", data.dashboardUrl || "../");
  setHref(root, "[data-link='jira-filter']", data.jiraFilterUrl || data.siteUrl || "#");

  const bridgeUrl = data.assigneeDispatchEndpoint ? new URL(data.assigneeDispatchEndpoint).origin : "#";
  setHref(root, "[data-link='bridge-login']", bridgeUrl);
}

function populateFilterOptions(root, issues) {
  addOptions(root, "[data-filter='status']", uniqueValues(issues, "status"));
  addOptions(root, "[data-filter='assignee']", uniqueValues(issues, "assignee"));
  addOptions(root, "[data-filter='priority']", uniqueValues(issues, "priority"));
}

function addOptions(root, selector, values) {
  const select = root.querySelector(selector);
  if (!select) {
    return;
  }

  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
}

function uniqueValues(issues, field) {
  return [...new Set(issues.map((issue) => issue[field]).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function bindFilters(root, state) {
  for (const control of root.querySelectorAll("[data-filter]")) {
    control.addEventListener("input", () => {
      state.filters[control.dataset.filter] = control.value;
      renderFilteredTickets(root, state);
    });
  }
}

function renderFilteredTickets(root, state) {
  const filtered = state.issues.filter((issue) => matchesFilters(issue, state.filters));
  setText(root, "[data-meta='filteredCount']", `${filtered.length} shown`);
  renderStatusLanes(root, filtered);
  renderTickets(root, filtered);
}

function matchesFilters(issue, filters) {
  const haystack = [
    issue.key,
    issue.summary,
    issue.status,
    issue.priority,
    issue.assignee,
    ...(Array.isArray(issue.components) ? issue.components : [])
  ].filter(Boolean).join(" ").toLowerCase();

  return (!filters.search || haystack.includes(filters.search.toLowerCase()))
    && (!filters.status || issue.status === filters.status)
    && (!filters.assignee || issue.assignee === filters.assignee)
    && (!filters.priority || issue.priority === filters.priority);
}

function renderStatusLanes(root, issues) {
  const container = root.querySelector("[data-status-lanes]");
  if (!container) {
    return;
  }

  const counts = new Map();
  for (const issue of issues) {
    const status = issue.status || "No status";
    counts.set(status, (counts.get(status) || 0) + 1);
  }

  const lanes = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6);

  container.replaceChildren(...lanes.map(([status, count]) => {
    const lane = document.createElement("article");
    lane.className = "status-lane";
    lane.innerHTML = `<h3>${escapeHtml(status)}</h3><p>${count} ticket${count === 1 ? "" : "s"}</p>`;
    return lane;
  }));
}

function renderTickets(root, issues) {
  const container = root.querySelector("[data-ticket-list]");
  if (!container) {
    return;
  }

  const cards = issues.slice(0, 30).map((issue) => {
    const card = document.createElement("article");
    card.className = "ticket-card";
    card.innerHTML = `
      <div class="ticket-card-header">
        <a class="ticket-key" href="${escapeAttribute(issue.url || "#")}" target="_blank" rel="noreferrer">${escapeHtml(issue.key || "Ticket")}</a>
        <span class="ticket-priority">${escapeHtml(issue.priority || "None")}</span>
      </div>
      <h3>${escapeHtml(issue.summary || "Untitled ticket")}</h3>
      <dl class="ticket-fields">
        <div><dt>Status</dt><dd>${escapeHtml(issue.status || "None")}</dd></div>
        <div><dt>Assignee</dt><dd>${escapeHtml(issue.assignee || "Unassigned")}</dd></div>
        <div><dt>Updated</dt><dd>${escapeHtml(issue.updatedDisplay || "Unknown")}</dd></div>
      </dl>
      <p class="ticket-components">${escapeHtml(formatComponents(issue.components))}</p>
    `;
    return card;
  });

  if (cards.length === 0) {
    const empty = document.createElement("article");
    empty.className = "ticket-card placeholder";
    empty.innerHTML = "<h3>No matching tickets</h3><p>Adjust the filters to broaden the view.</p>";
    container.replaceChildren(empty);
    return;
  }

  container.replaceChildren(...cards);
}

function formatComponents(components) {
  return Array.isArray(components) && components.length > 0 ? components.join(", ") : "No components";
}

function renderLoadError(root, error) {
  setText(root, "[data-meta='version']", "Dashboard data unavailable");
  setText(root, "[data-meta='summary']", error?.message || "Unable to read dashboard-data.json.");

  const list = root.querySelector("[data-ticket-list]");
  if (list) {
    const card = document.createElement("article");
    card.className = "ticket-card placeholder error";
    card.innerHTML = "<h3>Data artifact not loaded</h3><p>Build output is intact, but the JSON artifact path needs to be available beside the hosted board.</p>";
    list.replaceChildren(card);
  }
}

function setText(root, selector, value) {
  const element = root.querySelector(selector);
  if (element) {
    element.textContent = value;
  }
}

function setHref(root, selector, value) {
  const element = root.querySelector(selector);
  if (element) {
    element.setAttribute("href", value);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
