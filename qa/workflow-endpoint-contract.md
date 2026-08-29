# Workflow endpoint contract coverage

Write-based persistence QA uses the injectable adapter; production endpoints are not used for destructive QA.

| Endpoint | Methods | Indirect writes | Classification |
|---|---|---|---|
| `/.netlify/functions/sessions` | GET, POST, PATCH | sessions, availability, audit activity | READ_ONLY_TESTED / NOT_SAFE_FOR_PRODUCTION_QA |
| `/.netlify/functions/session-notes` | GET, POST, PATCH | session notes and processing writes | READ_ONLY_TESTED / NOT_SAFE_FOR_PRODUCTION_QA |
| `/.netlify/functions/aftercare` | GET, POST, PATCH | aftercare, audit logs, communications | READ_ONLY_TESTED / NOT_SAFE_FOR_PRODUCTION_QA |
| `/.netlify/functions/recommendations` | GET, POST, PATCH | recommendations | READ_ONLY_TESTED / NOT_SAFE_FOR_PRODUCTION_QA |
| `/.netlify/functions/verify-pin` | POST | none | CONTRACT_ONLY |

No production write endpoint is called by the adapter-driven persistence validator.
