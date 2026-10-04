/**
 * Nairobi CRM — Core Business Logic & Security Utilities
 * Universal Module Definition (UMD) - works in Node.js and Browser.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CrmCore = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * Pipeline deal stages
   * Includes both terminal stages: "won" (Closed won) and "lost" (Closed lost)
   */
  const STAGES = [
    { id: "qualified", label: "Qualified" },
    { id: "meeting", label: "Meeting booked" },
    { id: "proposal", label: "Proposal" },
    { id: "negotiation", label: "Negotiation" },
    { id: "won", label: "Closed won" },
    { id: "lost", label: "Closed lost" },
  ];

  /**
   * Pre-defined loss reasons for Kenyan commercial sales
   */
  const LOSS_REASONS = [
    "Price / Budget constraints",
    "Competitor chosen",
    "Project postponed / frozen",
    "No decision / Unresponsive",
    "Feature gap / Compliance requirements",
    "Other",
  ];

  /**
   * Security: Sanitizes untrusted strings to prevent Cross-Site Scripting (XSS).
   * Encodes HTML control characters (&, <, >, ", ').
   *
   * @param {*} input - Value to sanitize
   * @returns {string} Safe HTML-encoded string
   */
  function escapeHtml(input) {
    if (input === null || input === undefined) return "";
    return String(input)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Formats a numeric value into Kenyan Shillings (KES).
   * Gracefully handles null, undefined, negative numbers, and non-numeric inputs.
   *
   * @param {number|string} amount
   * @returns {string} Formatted currency string, e.g. "KES 1,200,000"
   */
  function formatKES(amount) {
    const num = Number(amount);
    const validNum = Number.isFinite(num) ? num : 0;
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      maximumFractionDigits: 0,
    }).format(validNum);
  }

  /**
   * Generates a unique RFC 4122 v4 UUID.
   * Fallback for environments where crypto.randomUUID() might not be available.
   *
   * @returns {string} UUID
   */
  function generateId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Calculates dashboard summary metrics:
   * - Open pipeline total (excludes won & lost)
   * - Closed won total
   * - Closed lost total
   * - Win rate percentage
   *
   * @param {Array} deals
   * @param {Array} contacts
   * @param {Array} companies
   * @returns {object} Aggregated metrics
   */
  function calculateMetrics(deals = [], contacts = [], companies = []) {
    const safeDeals = Array.isArray(deals) ? deals : [];
    const openDeals = safeDeals.filter((d) => d.stage !== "won" && d.stage !== "lost");
    const wonDeals = safeDeals.filter((d) => d.stage === "won");
    const lostDeals = safeDeals.filter((d) => d.stage === "lost");

    const pipelineTotal = openDeals.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
    const wonTotal = wonDeals.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
    const lostTotal = lostDeals.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

    const closedCount = wonDeals.length + lostDeals.length;
    const winRate = closedCount > 0 ? Math.round((wonDeals.length / closedCount) * 100) : 0;

    return {
      pipelineTotal,
      wonTotal,
      lostTotal,
      winRate,
      openCount: openDeals.length,
      wonCount: wonDeals.length,
      lostCount: lostDeals.length,
      contactsCount: Array.isArray(contacts) ? contacts.length : 0,
      companiesCount: Array.isArray(companies) ? companies.length : 0,
    };
  }

  /**
   * Performs referential integrity cleanup and cascade deletion across the CRM database.
   * Prevents dangling foreign keys in deals, contacts, and activities.
   *
   * @param {object} db - Database object { companies, contacts, deals, activities }
   * @param {"company"|"contact"|"deal"|"activity"} entityType - Entity kind being removed
   * @param {string} id - Identifier of the entity to delete
   * @returns {object} Updated database clone with removed references
   */
  function cascadeDelete(db, entityType, id) {
    if (!db || !id) return db;

    // Shallow copy collections for immutability
    const nextDb = {
      companies: [...(db.companies || [])],
      contacts: [...(db.contacts || [])],
      deals: [...(db.deals || [])],
      activities: [...(db.activities || [])],
    };

    if (entityType === "company") {
      // 1. Identify all contacts and deals belonging to this company
      const companyContactIds = new Set(
        nextDb.contacts.filter((c) => c.companyId === id).map((c) => c.id)
      );
      const companyDealIds = new Set(
        nextDb.deals.filter((d) => d.companyId === id).map((d) => d.id)
      );

      // 2. Cascade delete activities linked to either these deals or contacts
      nextDb.activities = nextDb.activities.filter(
        (a) => !companyDealIds.has(a.dealId) && !companyContactIds.has(a.contactId)
      );

      // 3. Cascade delete deals belonging to this company
      nextDb.deals = nextDb.deals.filter((d) => d.companyId !== id);

      // 4. Cascade delete contacts belonging to this company
      nextDb.contacts = nextDb.contacts.filter((c) => c.companyId !== id);

      // 5. Remove the company itself
      nextDb.companies = nextDb.companies.filter((c) => c.id !== id);
    } else if (entityType === "contact") {
      // 1. Remove activities directly linked to this contact
      nextDb.activities = nextDb.activities.filter((a) => a.contactId !== id);

      // 2. Unlink contact reference from deals (keep the deal under the company)
      nextDb.deals = nextDb.deals.map((d) =>
        d.contactId === id ? { ...d, contactId: "" } : d
      );

      // 3. Remove contact
      nextDb.contacts = nextDb.contacts.filter((c) => c.id !== id);
    } else if (entityType === "deal") {
      // 1. Remove activities linked specifically to this deal
      nextDb.activities = nextDb.activities.filter((a) => a.dealId !== id);

      // 2. Remove the deal
      nextDb.deals = nextDb.deals.filter((d) => d.id !== id);
    } else if (entityType === "activity") {
      // Remove single activity
      nextDb.activities = nextDb.activities.filter((a) => a.id !== id);
    }

    return nextDb;
  }

  /**
   * Validates an uploaded JSON backup payload before importing.
   * Checks structure, types, and schema integrity.
   *
   * @param {*} rawData - Parsed JSON object
   * @returns {{ valid: boolean, error?: string, sanitizedData?: object }}
   */
  function validateBackup(rawData) {
    if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
      return { valid: false, error: "Backup file must be a JSON object." };
    }

    const requiredKeys = ["companies", "contacts", "deals", "activities"];
    for (const key of requiredKeys) {
      if (!Array.isArray(rawData[key])) {
        return {
          valid: false,
          error: `Missing or invalid '${key}' array in backup payload.`,
        };
      }
    }

    // Validate that entries have IDs and string/number properties
    const sanitizeList = (list, defaultFields) =>
      list
        .filter((item) => item && typeof item === "object" && !Array.isArray(item))
        .map((item) => ({
          ...defaultFields,
          ...item,
          id: item.id ? String(item.id) : generateId(),
        }));

    const sanitizedData = {
      companies: sanitizeList(rawData.companies, { name: "Unnamed Account", industry: "", city: "" }),
      contacts: sanitizeList(rawData.contacts, { firstName: "", lastName: "", email: "", phone: "" }),
      deals: sanitizeList(rawData.deals, { name: "Unnamed Deal", amount: 0, stage: "qualified" }),
      activities: sanitizeList(rawData.activities, { type: "note", body: "", at: new Date().toISOString() }),
      version: rawData.version || "1.0",
      importedAt: new Date().toISOString(),
    };

    return { valid: true, sanitizedData };
  }

  /**
   * Converts an array of objects to an RFC 4180 compliant CSV string.
   *
   * @param {Array<object>} rows
   * @param {Array<{ key: string, label: string }>} columns
   * @returns {string} CSV formatted string
   */
  function exportToCSV(rows = [], columns = []) {
    if (!rows.length || !columns.length) return "";

    const escapeCSV = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const header = columns.map((c) => escapeCSV(c.label)).join(",");
    const body = rows
      .map((row) => columns.map((col) => escapeCSV(row[col.key] || "")).join(","))
      .join("\r\n");

    return `${header}\r\n${body}`;
  }

  return {
    STAGES,
    LOSS_REASONS,
    escapeHtml,
    formatKES,
    generateId,
    calculateMetrics,
    cascadeDelete,
    validateBackup,
    exportToCSV,
  };
});
