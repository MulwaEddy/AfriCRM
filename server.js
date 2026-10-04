/**
 * AfriCRM — Production & Local Server Entrypoint
 * Fast HTTP server with RESTful API (/api/v1/*) and static asset delivery.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const Database = require("./src/db/database");
const { normalizePhoneNumber, formatCurrency } = require("./src/utils/sanitizer");
const { findContactDuplicate, findCompanyDuplicate } = require("./src/utils/duplicate-detector");
const { parseCSV, autoMapColumns, processContactImport, serializeToCSV } = require("./src/utils/csv-engine");
const { initiateStkPush } = require("./src/adapters/daraja-mpesa");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;
const ORG_ID = "org_africrm_ke";

const MIME_TYPES = {
  ".html": "text/html; charset=UTF-8",
  ".css": "text/css; charset=UTF-8",
  ".js": "application/javascript; charset=UTF-8",
  ".json": "application/json; charset=UTF-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

/**
 * Helper to read request body as JSON
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Helper to send JSON responses
 */
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=UTF-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Organization-Id",
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // Handle CORS pre-flight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Organization-Id",
    });
    return res.end();
  }

  // ---------------------------------------------------------------------------
  // REST API: /api/v1/*
  // ---------------------------------------------------------------------------
  if (pathname.startsWith("/api/v1/")) {
    try {
      // 1. Current Session Context
      if (pathname === "/api/v1/auth/me" && method === "GET") {
        const org = Database.getOrganization(ORG_ID);
        const users = Database.getUsers(ORG_ID);
        return sendJson(res, 200, {
          user: users[0], // Founder/Admin
          organization: org,
          permissions: ["*"],
        });
      }

      // 2. Dashboard KPI Metrics
      if (pathname === "/api/v1/dashboard/metrics" && method === "GET") {
        const deals = Database.getDeals(ORG_ID);
        const contacts = Database.getContacts(ORG_ID);
        const companies = Database.getCompanies(ORG_ID);
        const payments = Database.getPayments(ORG_ID);

        const openDeals = deals.filter((d) => d.stageId !== "stg_won" && d.stageId !== "stg_lost");
        const wonDeals = deals.filter((d) => d.stageId === "stg_won");
        const lostDeals = deals.filter((d) => d.stageId === "stg_lost");

        const pipelineTotal = openDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);
        const wonTotal = wonDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);
        const lostTotal = lostDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);
        const cashCollected = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

        const closedCount = wonDeals.length + lostDeals.length;
        const winRate = closedCount > 0 ? Math.round((wonDeals.length / closedCount) * 100) : 0;

        return sendJson(res, 200, {
          pipelineTotal,
          wonTotal,
          lostTotal,
          cashCollected,
          winRate,
          openCount: openDeals.length,
          wonCount: wonDeals.length,
          lostCount: lostDeals.length,
          contactsCount: contacts.length,
          companiesCount: companies.length,
          currency: "KES",
        });
      }

      // 3. Contacts Endpoints
      if (pathname === "/api/v1/contacts" && method === "GET") {
        const q = (parsedUrl.searchParams.get("q") || "").toLowerCase();
        let contacts = Database.getContacts(ORG_ID);
        if (q) {
          contacts = contacts.filter((c) =>
            `${c.firstName} ${c.lastName} ${c.email} ${c.phone} ${c.jobTitle || ""}`.toLowerCase().includes(q)
          );
        }
        return sendJson(res, 200, contacts);
      }

      if (pathname === "/api/v1/contacts" && method === "POST") {
        const body = await readJsonBody(req);
        body.phone = normalizePhoneNumber(body.phone);
        const existing = Database.getContacts(ORG_ID);
        const dup = findContactDuplicate(body, existing);

        if (dup.isDuplicate && !parsedUrl.searchParams.get("force")) {
          return sendJson(res, 409, {
            error: "Duplicate contact detected",
            matchReason: dup.matchReason,
            matchedContact: dup.matchedContact,
          });
        }

        const saved = Database.saveContact(ORG_ID, body);
        return sendJson(res, 201, saved);
      }

      if (pathname.startsWith("/api/v1/contacts/") && method === "DELETE") {
        const id = pathname.replace("/api/v1/contacts/", "");
        Database.cascadeDelete(ORG_ID, "contact", id);
        return sendJson(res, 200, { success: true, deletedId: id });
      }

      // 4. Companies Endpoints
      if (pathname === "/api/v1/companies" && method === "GET") {
        const q = (parsedUrl.searchParams.get("q") || "").toLowerCase();
        let companies = Database.getCompanies(ORG_ID);
        if (q) {
          companies = companies.filter((c) =>
            `${c.name} ${c.industry || ""} ${c.city || ""} ${c.commercialHub || ""}`.toLowerCase().includes(q)
          );
        }
        return sendJson(res, 200, companies);
      }

      if (pathname === "/api/v1/companies" && method === "POST") {
        const body = await readJsonBody(req);
        const existing = Database.getCompanies(ORG_ID);
        const dup = findCompanyDuplicate(body, existing);

        if (dup.isDuplicate && !parsedUrl.searchParams.get("force")) {
          return sendJson(res, 409, {
            error: "Duplicate company detected",
            matchReason: dup.matchReason,
            matchedCompany: dup.matchedCompany,
          });
        }

        const saved = Database.saveCompany(ORG_ID, body);
        return sendJson(res, 201, saved);
      }

      if (pathname.startsWith("/api/v1/companies/") && method === "DELETE") {
        const id = pathname.replace("/api/v1/companies/", "");
        Database.cascadeDelete(ORG_ID, "company", id);
        return sendJson(res, 200, { success: true, deletedId: id });
      }

      // 5. Deals & Stages Endpoints
      if (pathname === "/api/v1/stages" && method === "GET") {
        return sendJson(res, 200, Database.getStages());
      }

      if (pathname === "/api/v1/deals" && method === "GET") {
        return sendJson(res, 200, Database.getDeals(ORG_ID));
      }

      if (pathname === "/api/v1/deals" && method === "POST") {
        const body = await readJsonBody(req);
        body.value = Number(body.value || 0);
        const saved = Database.saveDeal(ORG_ID, body);
        return sendJson(res, 201, saved);
      }

      if (pathname.startsWith("/api/v1/deals/") && pathname.endsWith("/stage") && method === "PATCH") {
        const parts = pathname.split("/");
        const id = parts[4];
        const body = await readJsonBody(req);
        const deals = Database.getDeals(ORG_ID);
        const deal = deals.find((d) => d.id === id);

        if (!deal) {
          return sendJson(res, 404, { error: "Deal not found" });
        }

        deal.stageId = body.stageId;
        if (body.stageId === "stg_lost") {
          deal.lossReason = body.lossReason || "Other / Not specified";
          deal.lossNotes = body.lossNotes || "";
        } else {
          delete deal.lossReason;
          delete deal.lossNotes;
        }

        Database.saveDeal(ORG_ID, deal);

        // Auto-log activity on stage change
        const stageObj = Database.getStages().find((s) => s.id === body.stageId);
        Database.saveActivity(ORG_ID, {
          type: "stage_change",
          subject: `Deal moved to ${stageObj ? stageObj.name : body.stageId}`,
          body: `Stage updated for '${deal.title}'. Value: ${formatCurrency(deal.value, deal.currency)}`,
          dealId: deal.id,
          contactId: deal.contactId,
        });

        return sendJson(res, 200, deal);
      }

      if (pathname.startsWith("/api/v1/deals/") && method === "DELETE") {
        const id = pathname.replace("/api/v1/deals/", "");
        Database.cascadeDelete(ORG_ID, "deal", id);
        return sendJson(res, 200, { success: true, deletedId: id });
      }

      // 6. Products & Quotes Endpoints
      if (pathname === "/api/v1/products" && method === "GET") {
        return sendJson(res, 200, Database.getProducts(ORG_ID));
      }

      if (pathname === "/api/v1/quotes" && method === "GET") {
        return sendJson(res, 200, Database.getQuotes(ORG_ID));
      }

      if (pathname === "/api/v1/quotes" && method === "POST") {
        const body = await readJsonBody(req);
        const items = body.items || [];
        const subtotal = items.reduce((s, it) => s + (Number(it.lineTotal) || 0), 0);
        const taxRate = 16.0; // 16% Kenya VAT
        const taxAmount = Math.round(subtotal * (taxRate / 100));
        const grandTotal = subtotal + taxAmount;

        const quote = {
          ...body,
          quoteNumber: `QUO-2026-${Math.floor(100 + Math.random() * 900)}`,
          subtotal,
          taxAmount,
          grandTotal,
          currency: "KES",
          status: "sent",
        };

        const saved = Database.saveQuote(ORG_ID, quote);

        // Record activity
        Database.saveActivity(ORG_ID, {
          type: "quote",
          subject: `Quote ${saved.quoteNumber} Issued`,
          body: `Generated quote for KES ${grandTotal.toLocaleString()} with 16% VAT.`,
          contactId: saved.contactId,
          dealId: saved.dealId,
        });

        return sendJson(res, 201, saved);
      }

      // 7. M-Pesa STK Push Payment Simulation & Receipt
      if (pathname === "/api/v1/payments/mpesa-stk" && method === "POST") {
        const body = await readJsonBody(req);
        const result = await initiateStkPush({
          phone: body.phone,
          amount: body.amount,
          accountReference: body.accountReference || "AfriCRM",
        });

        const payment = Database.savePayment(ORG_ID, {
          dealId: body.dealId,
          amount: result.amount,
          currency: "KES",
          method: "mpesa_stk",
          mpesaReceiptNumber: result.receiptNumber,
          customerPhone: result.phone,
          status: "completed",
        });

        // Record activity in deal timeline
        Database.saveActivity(ORG_ID, {
          type: "payment",
          subject: "M-Pesa STK Push Payment Settled",
          body: `Collected KES ${result.amount.toLocaleString()} from ${result.phone}. Receipt: ${result.receiptNumber}.`,
          dealId: body.dealId,
          contactId: body.contactId,
        });

        // If linked to deal, auto-move deal to 'won'
        if (body.dealId) {
          const deal = Database.getDeals(ORG_ID).find((d) => d.id === body.dealId);
          if (deal) {
            deal.stageId = "stg_won";
            Database.saveDeal(ORG_ID, deal);
          }
        }

        return sendJson(res, 200, { success: true, payment, result });
      }

      // 8. Tasks & Activities Endpoints
      if (pathname === "/api/v1/tasks" && method === "GET") {
        return sendJson(res, 200, Database.getTasks(ORG_ID));
      }

      if (pathname === "/api/v1/tasks" && method === "POST") {
        const body = await readJsonBody(req);
        const saved = Database.saveTask(ORG_ID, body);
        return sendJson(res, 201, saved);
      }

      if (pathname.startsWith("/api/v1/tasks/") && pathname.endsWith("/complete") && method === "PATCH") {
        const id = pathname.split("/")[4];
        const task = Database.getTasks(ORG_ID).find((t) => t.id === id);
        if (task) {
          task.status = "completed";
          Database.saveTask(ORG_ID, task);
        }
        return sendJson(res, 200, task || {});
      }

      if (pathname === "/api/v1/activities" && method === "GET") {
        return sendJson(res, 200, Database.getActivities(ORG_ID));
      }

      if (pathname === "/api/v1/activities" && method === "POST") {
        const body = await readJsonBody(req);
        const saved = Database.saveActivity(ORG_ID, body);
        return sendJson(res, 201, saved);
      }

      // 9. CSV Smart Import Endpoint
      if (pathname === "/api/v1/contacts/import-csv" && method === "POST") {
        const body = await readJsonBody(req);
        const rawCsv = body.csvText || "";
        const grid = parseCSV(rawCsv);
        if (grid.length < 2) {
          return sendJson(res, 400, { error: "CSV file is empty or missing headers" });
        }
        const mapping = body.mapping || autoMapColumns(grid[0]);
        const existing = Database.getContacts(ORG_ID);
        const result = processContactImport(grid, mapping, existing, body.duplicateStrategy || "merge");

        // Save imported and updated records
        result.imported.forEach((c) => Database.saveContact(ORG_ID, c));
        result.updated.forEach((c) => Database.saveContact(ORG_ID, c));

        return sendJson(res, 200, {
          success: true,
          importedCount: result.imported.length,
          updatedCount: result.updated.length,
          skippedCount: result.skippedCount,
        });
      }

      // 10. CSV Export Endpoint
      if (pathname === "/api/v1/export-csv" && method === "GET") {
        const type = parsedUrl.searchParams.get("type") || "contacts";
        if (type === "contacts") {
          const contacts = Database.getContacts(ORG_ID);
          const columns = [
            { key: "firstName", label: "First Name" },
            { key: "lastName", label: "Last Name" },
            { key: "email", label: "Email" },
            { key: "phone", label: "Phone" },
            { key: "jobTitle", label: "Job Title" },
            { key: "city", label: "Location" },
          ];
          const csv = serializeToCSV(contacts, columns);
          res.writeHead(200, {
            "Content-Type": "text/csv; charset=UTF-8",
            "Content-Disposition": 'attachment; filename="africrm-contacts.csv"',
          });
          return res.end(csv);
        } else {
          const deals = Database.getDeals(ORG_ID);
          const columns = [
            { key: "title", label: "Deal Title" },
            { key: "value", label: "Amount" },
            { key: "currency", label: "Currency" },
            { key: "stageId", label: "Stage" },
          ];
          const csv = serializeToCSV(deals, columns);
          res.writeHead(200, {
            "Content-Type": "text/csv; charset=UTF-8",
            "Content-Disposition": 'attachment; filename="africrm-deals.csv"',
          });
          return res.end(csv);
        }
      }

      // 11. Reset Demo Data
      if (pathname === "/api/v1/reset-demo" && method === "POST") {
        Database.reset();
        return sendJson(res, 200, { success: true, message: "Demo data restored successfully." });
      }

      return sendJson(res, 404, { error: `Endpoint not found: ${method} ${pathname}` });
    } catch (err) {
      console.error("API Error:", err);
      return sendJson(res, 500, { error: err.message });
    }
  }

  // ---------------------------------------------------------------------------
  // Static File Serving
  // ---------------------------------------------------------------------------
  let safeUrl = pathname;
  if (safeUrl === "/" || safeUrl === "") safeUrl = "/index.html";

  const normalizedPath = path.normalize(safeUrl).replace(/^(\.\.[\/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalizedPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("403 Forbidden");
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/html; charset=UTF-8" });
        res.end(`<h2>404 Not Found</h2><p>Cannot find ${safeUrl}</p>`);
      } else {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`500 Server Error: ${err.message}`);
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
    });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  AfriCRM Multi-Tenant Server Running!`);
  console.log(`  Local URL: http://localhost:${PORT}`);
  console.log(`  REST API:  http://localhost:${PORT}/api/v1/auth/me`);
  console.log(`======================================================\n`);
});
