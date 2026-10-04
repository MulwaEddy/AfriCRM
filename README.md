# AfriCRM — The All-in-One Sales CRM Built for African SMEs

> **Manage leads, calls, WhatsApp, email, deals, quotes, and payments in one local desk.**

AfriCRM combines the practical sales functionality of HubSpot, Salesforce, Zoho CRM, GoHighLevel, and Monday.com, deeply localized for Kenya and Sub-Saharan Africa. Built with **multi-tenant-ready architecture** for private company deployment and SaaS scalability.

---

## Core Differentiators

- 💬 **WhatsApp-First Outreach:** Official Meta WhatsApp Cloud API integration & direct `wa.me` links.
- 📱 **Click-to-Call:** Instant mobile dialer handoff (`tel:`) and call outcome logging.
- 🇰🇪 **Local Payments & Invoicing:** Safaricom M-Pesa Daraja STK Push prompts and PesaLink bank settlement.
- 📊 **6-Stage KES Deal Pipeline:** Interactive Kanban board with drag-and-drop on desktop and touch stage selectors on mobile.
- 🔒 **Data Quality & Security:** Built-in fuzzy duplicate detection, XSS sanitization, and cascade referential integrity.
- 🚀 **Low-Bandwidth & Zero Dependencies:** Ultra-light client footprint, zero external runtime packages required.

---

## Quickstart (Run on Local PC)

Your local machine has **Node.js (v26.10.0)** installed.

### 1. Start the AfriCRM Server
```powershell
node server.js
```
The application will be live at:
👉 **[http://localhost:3000](http://localhost:3000)**

### 2. Run the Automated Test Suite (42 Tests)
```powershell
npm.cmd test
# Or directly via Node:
node --test test/*.test.js
```

### 3. Docker Multi-Container Stack (Production)
```bash
docker-compose up -d
```
Starts AfriCRM App, PostgreSQL 16, and Redis.

---

## Architecture & REST API (`/api/v1/*`)

| Endpoint | Method | Description |
| :--- | :---: | :--- |
| `/api/v1/auth/me` | `GET` | Current user profile, organization context, and RBAC permissions. |
| `/api/v1/dashboard/metrics` | `GET` | Open pipeline, cash collected, won, lost, and win rate %. |
| `/api/v1/contacts` | `GET`, `POST` | Contacts list with search and duplicate check. |
| `/api/v1/companies` | `GET`, `POST` | Company accounts with KRA PIN and Nairobi commercial hub filters. |
| `/api/v1/deals` | `GET`, `POST` | Deal pipeline records denominated in KES. |
| `/api/v1/deals/:id/stage` | `PATCH` | Move deal stage (enforces mandatory loss reason for Closed Lost). |
| `/api/v1/quotes` | `GET`, `POST` | Itemized quotes with 16% Kenya VAT and grand total calculations. |
| `/api/v1/payments/mpesa-stk` | `POST` | Trigger Safaricom Daraja STK Push prompt to client's phone. |
| `/api/v1/tasks` | `GET`, `POST` | Task desk with priority pills and one-click completion. |
| `/api/v1/activities` | `GET`, `POST` | Unified chronological touchpoint timeline. |
| `/api/v1/contacts/import-csv`| `POST` | CSV Smart Import with auto-column mapping and deduplication. |
| `/api/v1/export-csv` | `GET` | Export contacts or deals to RFC 4180 CSV. |
| `/api/v1/reset-demo` | `POST` | Restore fresh Kenyan starter dataset. |

---

## Detailed Documentation

- **[Master Architecture Specification & PRD](file:///C:/Users/Administrator/.gemini/antigravity/brain/a95c1c9d-1f15-472c-878e-b1fd9d076c6f/africrm_architecture_spec.md)**
- **[Engineering Tracker & Roadmap](file:///c:/Users/Administrator/Downloads/Nairobi%20CRM/ENGINEERING.md)**
- **[45-Table PostgreSQL Schema DDL](file:///c:/Users/Administrator/Downloads/Nairobi%20CRM/src/db/schema.sql)**
