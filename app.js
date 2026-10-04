/**
 * AfriCRM — Main Frontend Application Controller (v1.0.0-PROD)
 * Mobile-First, Multi-Tenant B2B Sales CRM for African SMEs.
 * Full integration with AfriCRM REST API (/api/v1/*) and local failover.
 */

const {
  STAGES,
  LOSS_REASONS,
  escapeHtml,
  formatKES,
} = window.CrmCore || {};

// Global in-memory cache
let crmState = {
  user: null,
  organization: null,
  metrics: null,
  contacts: [],
  companies: [],
  deals: [],
  quotes: [],
  products: [],
  tasks: [],
  activities: [],
};

// DOM Elements
const qs = (sel) => document.querySelector(sel);
const view = qs("#view");
const modal = qs("#modal");
const formEl = qs("#record-form");
const toastEl = qs("#toast");

// Toast Feedback System
let toastTimeout;
function showToast(message, type = "info") {
  if (!toastEl) return;
  clearTimeout(toastTimeout);
  toastEl.textContent = message;
  toastEl.className = `toast visible toast-${type}`;
  toastTimeout = setTimeout(() => {
    toastEl.classList.remove("visible");
  }, 4000);
}

// API Client Helper
async function api(path, options = {}) {
  try {
    const res = await fetch(`/api/v1${path}`, {
      headers: { "Content-Type": "application/json", ...options.headers },
      ...options,
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    console.error(`API Error on ${path}:`, err);
    throw err;
  }
}

/**
 * Initializes state from backend REST API
 */
async function syncState() {
  try {
    const [me, metrics, contacts, companies, deals, quotes, products, tasks, activities] = await Promise.all([
      api("/auth/me").catch(() => null),
      api("/dashboard/metrics").catch(() => null),
      api("/contacts").catch(() => []),
      api("/companies").catch(() => []),
      api("/deals").catch(() => []),
      api("/quotes").catch(() => []),
      api("/products").catch(() => []),
      api("/tasks").catch(() => []),
      api("/activities").catch(() => []),
    ]);

    crmState = {
      user: me?.user,
      organization: me?.organization,
      metrics,
      contacts,
      companies,
      deals,
      quotes,
      products,
      tasks,
      activities,
    };
  } catch (err) {
    showToast("Could not connect to AfriCRM API. Running in local mode.", "error");
  }
}

// -----------------------------------------------------------------------------
// CLIENT ROUTER
// -----------------------------------------------------------------------------

async function route() {
  const hash = location.hash.replace("#/", "") || "dashboard";
  const [name, id] = hash.split("/");
  const q = (qs("#q")?.value || "").trim().toLowerCase();

  // Highlight active nav item
  document.querySelectorAll("[data-route]").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === name);
  });

  const routes = {
    dashboard,
    deals,
    contacts,
    companies,
    quotes,
    tasks,
    activities,
    import: csvImportView,
  };

  const handler = routes[name] || dashboard;
  await handler(id, q);
}

// -----------------------------------------------------------------------------
// VIEW CONTROLLERS
// -----------------------------------------------------------------------------

/**
 * Executive Dashboard View
 */
async function dashboard(_, q) {
  await syncState();
  const m = crmState.metrics || {
    pipelineTotal: 0,
    cashCollected: 0,
    wonTotal: 0,
    lostTotal: 0,
    winRate: 0,
    openCount: 0,
    wonCount: 0,
    contactsCount: 0,
  };

  view.innerHTML = `
    <p class="kicker">Executive Sales Desk · Nairobi Hub</p>
    <h2 class="page-title">Revenue & Pipeline Overview</h2>
    <p class="lede">Real-time KES cash collection, pipeline velocity, and active deals.</p>
    
    <div class="metrics">
      <div class="metric">
        <b>${formatKES(m.pipelineTotal)}</b>
        <span>Open Pipeline (${m.openCount} deals)</span>
      </div>
      <div class="metric">
        <b style="color:var(--leaf-mid)">${formatKES(m.cashCollected)}</b>
        <span>Cash Collected (M-Pesa / Bank)</span>
      </div>
      <div class="metric">
        <b>${formatKES(m.wonTotal)}</b>
        <span>Closed Won (${m.wonCount})</span>
      </div>
      <div class="metric">
        <b>${m.winRate}%</b>
        <span>Win Rate · ${m.contactsCount} Contacts</span>
      </div>
    </div>

    <div class="toolbar" style="margin-top:28px">
      <div>
        <h3 style="margin:0;font-family:var(--font-display);font-size:1.4rem">Deal Pipeline</h3>
        <p class="lede" style="margin:4px 0 0">Drag deals across stages or use the mobile selector.</p>
      </div>
      <button class="btn" data-new="deal">New Deal</button>
    </div>

    ${renderBoard(q)}
  `;

  bindBoard();
}

/**
 * Deal Pipeline View (6-Stage Kanban Board)
 */
async function dealsView(_, q) {
  await syncState();
  view.innerHTML = `
    <div class="toolbar">
      <div>
        <p class="kicker">Revenue Pipeline</p>
        <h2 class="page-title">Deal Board</h2>
        <p class="lede">6-Stage Kenyan B2B pipeline. Amounts denominated in KES.</p>
      </div>
      <button class="btn" data-new="deal">New Deal</button>
    </div>
    ${renderBoard(q)}
  `;
  bindBoard();
}

function renderBoard(q = "") {
  const stages = [
    { id: "stg_qualified", label: "Qualified", key: "qualified" },
    { id: "stg_meeting", label: "Meeting Booked", key: "meeting" },
    { id: "stg_proposal", label: "Proposal", key: "proposal" },
    { id: "stg_negotiation", label: "Negotiation", key: "negotiation" },
    { id: "stg_won", label: "Closed Won", key: "won" },
    { id: "stg_lost", label: "Closed Lost", key: "lost" },
  ];

  const getCompName = (id) => crmState.companies.find((c) => c.id === id)?.name || "—";
  const getContName = (id) => {
    const c = crmState.contacts.find((x) => x.id === id);
    return c ? `${c.firstName} ${c.lastName}` : "—";
  };

  const matches = (d) =>
    `${d.title} ${getCompName(d.companyId)} ${getContName(d.contactId)} ${d.lossReason || ""}`
      .toLowerCase()
      .includes(q);

  return `
    <div class="board">
      ${stages
        .map((stage) => {
          const list = crmState.deals.filter((d) => d.stageId === stage.id && matches(d));
          const sum = list.reduce((s, d) => s + (Number(d.value) || 0), 0);
          return `
          <section class="column" data-stage="${stage.id}">
            <h3>${escapeHtml(stage.label)} · ${formatKES(sum)}</h3>
            ${list
              .map(
                (d) => `
              <article 
                class="deal ${stage.key === "won" ? "deal-won" : ""} ${stage.key === "lost" ? "deal-lost" : ""}" 
                draggable="true" 
                data-id="${escapeHtml(d.id)}" 
                data-edit="deal"
              >
                <strong>${escapeHtml(d.title)}</strong>
                <small>${formatKES(d.value)} · ${escapeHtml(getCompName(d.companyId))}</small>
                ${d.lossReason ? `<span class="loss-tag">${escapeHtml(d.lossReason)}</span>` : ""}
                
                <!-- Mobile Touch Stage Selector -->
                <select class="stage-select-touch" onchange="moveDealStage('${d.id}', this.value)" onclick="event.stopPropagation()">
                  ${stages
                    .map(
                      (s) =>
                        `<option value="${s.id}" ${d.stageId === s.id ? "selected" : ""}>Move: ${escapeHtml(s.label)}</option>`
                    )
                    .join("")}
                </select>
              </article>`
              )
              .join("")}
          </section>`;
        })
        .join("")}
    </div>
  `;
}

function bindBoard() {
  let draggingId = null;

  view.querySelectorAll(".deal").forEach((el) => {
    el.addEventListener("dragstart", (e) => {
      draggingId = el.dataset.id;
      el.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    el.addEventListener("dragend", () => {
      el.classList.remove("is-dragging");
    });

    el.addEventListener("click", () => {
      openForm("deal", el.dataset.id);
    });
  });

  view.querySelectorAll(".column").forEach((col) => {
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      col.classList.add("drag-over");
    });

    col.addEventListener("dragleave", () => {
      col.classList.remove("drag-over");
    });

    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");
      if (!draggingId) return;
      await moveDealStage(draggingId, col.dataset.stage);
    });
  });
}

/**
 * Handles Deal stage transition with mandatory loss reason capture
 */
window.moveDealStage = async function (dealId, targetStageId) {
  const deal = crmState.deals.find((d) => d.id === dealId);
  if (!deal) return;

  if (targetStageId === "stg_lost") {
    const reason = prompt(
      "Mandatory: Please select or enter the Loss Reason for this deal:\n- Price / Budget constraints\n- Competitor chosen\n- Project postponed\n- Unresponsive\n- Other",
      "Competitor chosen"
    );
    if (!reason) {
      showToast("Loss reason required to move deal to Closed Lost.", "error");
      return;
    }
    deal.lossReason = reason;
  }

  try {
    const updated = await api(`/deals/${dealId}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ stageId: targetStageId, lossReason: deal.lossReason }),
    });
    showToast("Deal stage updated!", "success");
    await route();
  } catch (err) {
    showToast("Failed to update deal stage: " + err.message, "error");
  }
};

/**
 * Contacts View
 */
async function contacts(_, q) {
  await syncState();
  const getCompName = (id) => crmState.companies.find((c) => c.id === id)?.name || "—";

  const rows = crmState.contacts.filter((c) =>
    `${c.firstName} ${c.lastName} ${c.email} ${c.phone} ${c.jobTitle || ""} ${getCompName(c.companyId)}`
      .toLowerCase()
      .includes(q)
  );

  view.innerHTML = `
    <div class="toolbar">
      <div>
        <p class="kicker">People & Buyers</p>
        <h2 class="page-title">Contacts</h2>
        <p class="lede">Direct WhatsApp, phone dialer links, and data quality scoring.</p>
      </div>
      <button class="btn" data-new="contact">New Contact</button>
    </div>
    ${
      rows.length
        ? `
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Title & Company</th>
            <th>WhatsApp</th>
            <th>Call</th>
            <th>Email</th>
            <th>Location</th>
            <th>Quality</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((c) => {
              const waClean = (c.whatsappNumber || c.phone || "").replace(/\D/g, "");
              return `
            <tr data-edit="contact" data-id="${escapeHtml(c.id)}">
              <td><strong>${escapeHtml(c.firstName)} ${escapeHtml(c.lastName)}</strong></td>
              <td>${escapeHtml(c.jobTitle || "—")} · <small>${escapeHtml(getCompName(c.companyId))}</small></td>
              <td>
                ${
                  waClean
                    ? `<a href="https://wa.me/${waClean}?text=Hello%20${encodeURIComponent(c.firstName)}" target="_blank" class="btn-wa" onclick="event.stopPropagation()">💬 WhatsApp</a>`
                    : "—"
                }
              </td>
              <td>
                ${
                  c.phone
                    ? `<a href="tel:${escapeHtml(c.phone)}" class="chip" onclick="event.stopPropagation()">📞 ${escapeHtml(c.phone)}</a>`
                    : "—"
                }
              </td>
              <td><a href="mailto:${escapeHtml(c.email)}" class="chip" onclick="event.stopPropagation()">${escapeHtml(c.email || "—")}</a></td>
              <td>${escapeHtml(c.city || "Nairobi")}</td>
              <td><span class="score-badge ${(c.dataQualityScore || 80) >= 90 ? "high" : "mid"}">${c.dataQualityScore || 85}%</span></td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>`
        : `<p class="empty">No contacts match that search.</p>`
    }
  `;
}

/**
 * Companies View
 */
async function companies(_, q) {
  await syncState();
  const rows = crmState.companies.filter((c) =>
    `${c.name} ${c.industry || ""} ${c.commercialHub || ""} ${c.kraPin || ""}`.toLowerCase().includes(q)
  );

  view.innerHTML = `
    <div class="toolbar">
      <div>
        <p class="kicker">Corporate Accounts</p>
        <h2 class="page-title">Companies</h2>
        <p class="lede">Enterprises & SMEs across Westlands, Upper Hill, Industrial Area, and Kilimani.</p>
      </div>
      <button class="btn" data-new="company">New Company</button>
    </div>
    ${
      rows.length
        ? `
      <table class="table">
        <thead>
          <tr>
            <th>Company Name</th>
            <th>Industry</th>
            <th>Hub / Location</th>
            <th>KRA Tax PIN</th>
            <th>Deals</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (c) => `
            <tr data-edit="company" data-id="${escapeHtml(c.id)}">
              <td><strong>${escapeHtml(c.name)}</strong></td>
              <td>${escapeHtml(c.industry || "—")}</td>
              <td>${escapeHtml(c.commercialHub || c.city || "Nairobi")}</td>
              <td>${c.kraPin ? `<span class="kra-badge">PIN: ${escapeHtml(c.kraPin)}</span>` : "—"}</td>
              <td>${crmState.deals.filter((d) => d.companyId === c.id).length}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`
        : `<p class="empty">No companies match that search.</p>`
    }
  `;
}

/**
 * Quotes & Billing View
 */
async function quotes(_, q) {
  await syncState();
  const getCompName = (id) => crmState.companies.find((c) => c.id === id)?.name || "—";

  view.innerHTML = `
    <div class="toolbar">
      <div>
        <p class="kicker">Invoicing & Cash Collection</p>
        <h2 class="page-title">Quotes & Billing</h2>
        <p class="lede">Itemized KES quotes with 16% VAT and instant Safaricom M-Pesa STK Push prompts.</p>
      </div>
      <button class="btn" data-new="quote">New Quote</button>
    </div>
    ${
      crmState.quotes.length
        ? `
      <table class="table">
        <thead>
          <tr>
            <th>Quote #</th>
            <th>Account</th>
            <th>Subtotal</th>
            <th>VAT (16%)</th>
            <th>Grand Total</th>
            <th>Status</th>
            <th>Payment Action</th>
          </tr>
        </thead>
        <tbody>
          ${crmState.quotes
            .map(
              (q) => `
            <tr>
              <td><strong>${escapeHtml(q.quoteNumber)}</strong></td>
              <td>${escapeHtml(getCompName(q.companyId))}</td>
              <td>${formatKES(q.subtotal)}</td>
              <td>${formatKES(q.taxAmount)}</td>
              <td><strong>${formatKES(q.grandTotal)}</strong></td>
              <td><span class="score-badge high">${escapeHtml(q.status.toUpperCase())}</span></td>
              <td>
                <button 
                  class="btn-mpesa" 
                  type="button" 
                  onclick="triggerMpesaPush('${q.id}', ${q.grandTotal}, '${escapeHtml(q.quoteNumber)}')"
                >
                  📱 M-Pesa STK Push
                </button>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`
        : `<p class="empty">No quotes created yet.</p>`
    }
  `;
}

/**
 * Triggers Safaricom M-Pesa STK push prompt to customer phone
 */
window.triggerMpesaPush = async function (quoteId, amount, quoteNumber) {
  const phone = prompt("Enter customer phone number for M-Pesa STK push:", "0722110441");
  if (!phone) return;

  showToast(`Initiating M-Pesa STK Push of ${formatKES(amount)} to ${phone}...`, "info");

  try {
    const res = await api("/payments/mpesa-stk", {
      method: "POST",
      body: JSON.stringify({ phone, amount, accountReference: quoteNumber }),
    });

    if (res.success) {
      showToast(`M-Pesa Payment Settled! Receipt: ${res.result.receiptNumber}`, "success");
      await syncState();
      await route();
    }
  } catch (err) {
    showToast("M-Pesa STK Push failed: " + err.message, "error");
  }
};

/**
 * Tasks Desk View
 */
async function tasks(_, q) {
  await syncState();
  const rows = crmState.tasks.filter((t) => `${t.title} ${t.description || ""}`.toLowerCase().includes(q));

  view.innerHTML = `
    <div class="toolbar">
      <div>
        <p class="kicker">Action Items</p>
        <h2 class="page-title">Tasks Desk</h2>
        <p class="lede">Priority follow-ups, contract calls, and client touchpoints.</p>
      </div>
      <button class="btn" data-new="task">New Task</button>
    </div>
    ${
      rows.length
        ? `
      <table class="table">
        <thead>
          <tr>
            <th>Done</th>
            <th>Task Title</th>
            <th>Priority</th>
            <th>Due Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (t) => `
            <tr>
              <td>
                <input 
                  type="checkbox" 
                  ${t.status === "completed" ? "checked" : ""} 
                  onchange="toggleTaskDone('${t.id}')" 
                />
              </td>
              <td><strong>${escapeHtml(t.title)}</strong><br><small>${escapeHtml(t.description || "")}</small></td>
              <td><span class="priority-pill priority-${t.priority || "medium"}">${escapeHtml(t.priority || "medium")}</span></td>
              <td>${t.dueDate ? new Date(t.dueDate).toLocaleDateString("en-KE") : "—"}</td>
              <td>${escapeHtml(t.status)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`
        : `<p class="empty">No tasks pending.</p>`
    }
  `;
}

window.toggleTaskDone = async function (id) {
  try {
    await api(`/tasks/${id}/complete`, { method: "PATCH" });
    showToast("Task marked as completed!", "success");
    await route();
  } catch (err) {
    showToast("Could not update task: " + err.message, "error");
  }
};

/**
 * Activity Feed View
 */
async function activities(_, q) {
  await syncState();
  const sorted = [...crmState.activities].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  view.innerHTML = `
    <div class="toolbar">
      <div>
        <p class="kicker">Touchpoints Feed</p>
        <h2 class="page-title">Activity Timeline</h2>
        <p class="lede">Calls, WhatsApp messages, payments, quotes, and stage shifts.</p>
      </div>
      <button class="btn" data-new="activity">Log Activity</button>
    </div>
    <div class="feed">
      ${
        sorted.length
          ? sorted
              .map(
                (a) => `
        <article class="item">
          <time>${new Date(a.createdAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
          <div>
            <strong>${escapeHtml((a.type || "note").toUpperCase())}</strong> · ${escapeHtml(a.subject || "Touchpoint")}
            <p>${escapeHtml(a.body || "")}</p>
          </div>
        </article>`
              )
              .join("")
          : `<p class="empty">No sales activities recorded yet.</p>`
      }
    </div>
  `;
}

/**
 * CSV Import Wizard View
 */
function csvImportView() {
  view.innerHTML = `
    <div class="toolbar">
      <div>
        <p class="kicker">Data Migration</p>
        <h2 class="page-title">CSV Smart Import</h2>
        <p class="lede">Import customer contacts with auto-column mapping and duplicate resolution.</p>
      </div>
    </div>

    <div class="import-box">
      <h3>Paste or Upload CSV Data</h3>
      <p class="lede">Paste CSV text below with headers such as: First Name, Last Name, Email, Phone, Company, Location.</p>
      <textarea id="csv-paste-area" class="import-textarea" rows="8" placeholder="First Name,Last Name,Work Email,Telephone,Company,Location
Amina,Mwangi,amina@safaricom.co.ke,+254722110441,Safaricom PLC,Westlands
David,Otieno,david@twiga.ke,+254711882190,Twiga Foods,Industrial Area"></textarea>
      
      <div style="margin-top:16px;display:flex;gap:16px;align-items:center;">
        <label>
          <strong>Duplicate Strategy:</strong>
          <select id="csv-dup-strategy" style="padding:6px 10px;margin-left:8px;border-radius:6px;border:1px solid var(--line)">
            <option value="merge" selected>Merge with Existing (Recommended)</option>
            <option value="skip">Skip Duplicates</option>
            <option value="overwrite">Overwrite Existing</option>
          </select>
        </label>
        <button class="btn" id="run-import-btn" type="button">Run Import & Deduplicate</button>
      </div>
      <div id="import-results" style="margin-top:20px;"></div>
    </div>
  `;

  qs("#run-import-btn").addEventListener("click", async () => {
    const csvText = qs("#csv-paste-area").value.trim();
    if (!csvText) {
      showToast("Please paste CSV data first.", "error");
      return;
    }
    const duplicateStrategy = qs("#csv-dup-strategy").value;
    showToast("Processing import & deduplicating...", "info");

    try {
      const res = await api("/contacts/import-csv", {
        method: "POST",
        body: JSON.stringify({ csvText, duplicateStrategy }),
      });

      qs("#import-results").innerHTML = `
        <div style="padding:16px;background:rgba(47, 107, 79, 0.1);border-radius:8px;border:1px solid var(--leaf)">
          <h4 style="margin:0 0 6px;color:var(--leaf-mid)">Import Completed Successfully!</h4>
          <p style="margin:0">
            <strong>${res.importedCount}</strong> new contacts created · 
            <strong>${res.updatedCount}</strong> records merged/updated · 
            <strong>${res.skippedCount}</strong> duplicates skipped.
          </p>
        </div>
      `;
      showToast(`Import finished: ${res.importedCount} new, ${res.updatedCount} updated.`, "success");
      await syncState();
    } catch (err) {
      showToast("Import error: " + err.message, "error");
    }
  });
}

// -----------------------------------------------------------------------------
// MODALS & FORMS
// -----------------------------------------------------------------------------

const formSchemas = {
  contact: (r = {}) => `
    <h3 id="modal-title">${r.id ? "Edit Contact" : "New Contact"}</h3>
    <input type="hidden" name="id" value="${escapeHtml(r.id || "")}" />
    <label>First Name</label><input name="firstName" required value="${escapeHtml(r.firstName || "")}" />
    <label>Last Name</label><input name="lastName" required value="${escapeHtml(r.lastName || "")}" />
    <label>Work Email</label><input name="email" type="email" value="${escapeHtml(r.email || "")}" />
    <label>Kenyan Phone (E.164, e.g. +254 7XX...)</label><input name="phone" value="${escapeHtml(r.phone || "")}" placeholder="+254 7..." />
    <label>Job Title</label><input name="jobTitle" value="${escapeHtml(r.jobTitle || "")}" />
    <label>Company</label>
    <select name="companyId">
      <option value="">— Select Company —</option>
      ${crmState.companies.map((c) => `<option value="${c.id}" ${c.id === r.companyId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
    </select>
    <div class="sheet-actions">
      ${r.id ? `<button class="ghost" type="button" data-delete style="color:var(--lost)">Delete</button>` : ""}
      <button class="ghost" type="button" onclick="modal.close()">Cancel</button>
      <button class="btn" type="submit">Save Contact</button>
    </div>
  `,

  company: (r = {}) => `
    <h3 id="modal-title">${r.id ? "Edit Company" : "New Company"}</h3>
    <input type="hidden" name="id" value="${escapeHtml(r.id || "")}" />
    <label>Company Name</label><input name="name" required value="${escapeHtml(r.name || "")}" />
    <label>Industry</label><input name="industry" value="${escapeHtml(r.industry || "")}" placeholder="Telecom, Agri-logistics" />
    <label>Nairobi Commercial Hub</label>
    <select name="commercialHub">
      ${["Westlands", "Upper Hill", "Industrial Area", "Kilimani", "CBD", "Karen", "Parklands", "Mombasa Road"]
        .map((h) => `<option value="${h}" ${r.commercialHub === h ? "selected" : ""}>${h}</option>`)
        .join("")}
    </select>
    <label>KRA Tax PIN (e.g. P051234567Z)</label>
    <input name="kraPin" value="${escapeHtml(r.kraPin || "")}" placeholder="P05..." />
    <div class="sheet-actions">
      ${r.id ? `<button class="ghost" type="button" data-delete style="color:var(--lost)">Delete</button>` : ""}
      <button class="ghost" type="button" onclick="modal.close()">Cancel</button>
      <button class="btn" type="submit">Save Company</button>
    </div>
  `,

  deal: (r = {}) => `
    <h3 id="modal-title">${r.id ? "Edit Deal" : "New Deal"}</h3>
    <input type="hidden" name="id" value="${escapeHtml(r.id || "")}" />
    <label>Deal Title</label><input name="title" required value="${escapeHtml(r.title || "")}" />
    <label>Amount (KES)</label><input name="value" type="number" min="0" required value="${escapeHtml(r.value || "")}" />
    <label>Pipeline Stage</label>
    <select name="stageId">
      ${[
        { id: "stg_qualified", label: "Qualified" },
        { id: "stg_meeting", label: "Meeting Booked" },
        { id: "stg_proposal", label: "Proposal" },
        { id: "stg_negotiation", label: "Negotiation" },
        { id: "stg_won", label: "Closed Won" },
        { id: "stg_lost", label: "Closed Lost" },
      ]
        .map((s) => `<option value="${s.id}" ${r.stageId === s.id ? "selected" : ""}>${s.label}</option>`)
        .join("")}
    </select>
    <label>Company</label>
    <select name="companyId">
      <option value="">— Select Company —</option>
      ${crmState.companies.map((c) => `<option value="${c.id}" ${c.id === r.companyId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
    </select>
    <label>Contact Person</label>
    <select name="contactId">
      <option value="">— Select Contact —</option>
      ${crmState.contacts.map((c) => `<option value="${c.id}" ${c.id === r.contactId ? "selected" : ""}>${escapeHtml(c.firstName)} ${escapeHtml(c.lastName)}</option>`).join("")}
    </select>
    <div class="sheet-actions">
      ${r.id ? `<button class="ghost" type="button" data-delete style="color:var(--lost)">Delete</button>` : ""}
      <button class="ghost" type="button" onclick="modal.close()">Cancel</button>
      <button class="btn" type="submit">Save Deal</button>
    </div>
  `,

  quote: (r = {}) => `
    <h3 id="modal-title">New Itemized Quote</h3>
    <label>Company Account</label>
    <select name="companyId" required>
      <option value="">— Select Company —</option>
      ${crmState.companies.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
    </select>
    <label>Product / Service</label>
    <select name="productId" id="q-product-select">
      ${crmState.products.map((p) => `<option value="${p.id}" data-price="${p.unitPrice}">${escapeHtml(p.name)} (${formatKES(p.unitPrice)})</option>`).join("")}
    </select>
    <label>Quantity</label>
    <input name="quantity" type="number" value="1" min="1" required />
    <p style="font-size:0.85rem;color:var(--mute);margin:12px 0">Note: 16% Kenya VAT is calculated automatically on save.</p>
    <div class="sheet-actions">
      <button class="ghost" type="button" onclick="modal.close()">Cancel</button>
      <button class="btn" type="submit">Generate Quote</button>
    </div>
  `,

  task: (r = {}) => `
    <h3 id="modal-title">New Sales Task</h3>
    <label>Title</label><input name="title" required placeholder="e.g. Schedule WhatsApp demo" />
    <label>Priority</label>
    <select name="priority">
      <option value="medium">Medium</option>
      <option value="high">High</option>
      <option value="urgent">Urgent</option>
      <option value="low">Low</option>
    </select>
    <label>Due Date</label><input name="dueDate" type="date" />
    <label>Notes</label><textarea name="description" rows="3"></textarea>
    <div class="sheet-actions">
      <button class="ghost" type="button" onclick="modal.close()">Cancel</button>
      <button class="btn" type="submit">Create Task</button>
    </div>
  `,

  activity: (r = {}) => `
    <h3 id="modal-title">Log Activity</h3>
    <label>Type</label>
    <select name="type">
      <option value="call">Call</option>
      <option value="whatsapp">WhatsApp Message</option>
      <option value="meeting">Meeting</option>
      <option value="note">Note</option>
    </select>
    <label>Subject</label><input name="subject" required placeholder="e.g. Discussed SLA pricing" />
    <label>Details</label><textarea name="body" rows="4" required></textarea>
    <div class="sheet-actions">
      <button class="ghost" type="button" onclick="modal.close()">Cancel</button>
      <button class="btn" type="submit">Save Activity</button>
    </div>
  `,
};

function openForm(kind, id) {
  let record = {};
  if (id) {
    if (kind === "contact") record = crmState.contacts.find((x) => x.id === id);
    if (kind === "company") record = crmState.companies.find((x) => x.id === id);
    if (kind === "deal") record = crmState.deals.find((x) => x.id === id);
  }
  formEl.innerHTML = formSchemas[kind](record || {});
  formEl.dataset.kind = kind;
  modal.showModal();
}

// Form Submission Handler
formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const kind = formEl.dataset.kind;
  const formData = Object.fromEntries(new FormData(formEl));

  try {
    if (kind === "quote") {
      const selectedProd = crmState.products.find((p) => p.id === formData.productId) || crmState.products[0];
      const qty = Number(formData.quantity || 1);
      const lineTotal = (selectedProd?.unitPrice || 0) * qty;

      await api("/quotes", {
        method: "POST",
        body: JSON.stringify({
          companyId: formData.companyId,
          items: [{ productId: selectedProd.id, name: selectedProd.name, quantity: qty, unitPrice: selectedProd.unitPrice, lineTotal }],
        }),
      });
      showToast("Quote created successfully!", "success");
    } else {
      const endpoint = `/${kind}s`;
      await api(endpoint, {
        method: "POST",
        body: JSON.stringify(formData),
      });
      showToast(`${kind.toUpperCase()} saved!`, "success");
    }

    modal.close();
    await syncState();
    await route();
  } catch (err) {
    showToast("Error saving: " + err.message, "error");
  }
});

// Delete Record Handler
formEl.addEventListener("click", async (e) => {
  if (e.target.matches("[data-delete]")) {
    const kind = formEl.dataset.kind;
    const id = new FormData(formEl).get("id");
    if (!id) return;

    if (!confirm(`Are you sure you want to delete this ${kind}? Linked items will be updated.`)) {
      return;
    }

    try {
      await api(`/${kind}s/${id}`, { method: "DELETE" });
      modal.close();
      showToast("Record deleted.", "info");
      await syncState();
      await route();
    } catch (err) {
      showToast("Delete failed: " + err.message, "error");
    }
  }
});

// Global Event Listeners
view.addEventListener("click", (e) => {
  const newTrigger = e.target.closest("[data-new]");
  if (newTrigger) return openForm(newTrigger.dataset.new);

  const editTrigger = e.target.closest("[data-edit]");
  if (editTrigger && !editTrigger.draggable) {
    openForm(editTrigger.dataset.edit, editTrigger.dataset.id);
  }
});

qs("#search-form").addEventListener("submit", (e) => e.preventDefault());
qs("#q").addEventListener("input", () => route());

qs("#export-csv-btn").addEventListener("click", () => {
  window.open("/api/v1/export-csv?type=contacts", "_blank");
});

qs("#reset-demo-btn").addEventListener("click", async () => {
  if (confirm("Reset demo database with fresh Kenyan starter dataset?")) {
    await api("/reset-demo", { method: "POST" });
    showToast("AfriCRM demo data reset!", "success");
    await syncState();
    await route();
  }
});

window.addEventListener("hashchange", route);

// Boot
(async () => {
  await syncState();
  await route();
})();
