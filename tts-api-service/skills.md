# skills.md — ISP self-diagnosis API coding standards

How an AI agent should **write code** in the ISP self-diagnosis backend. This project is a multi-tenant ISP diagnostics platform where customers run automated network checks through a portal, and the backend communicates from a VPS (Virtual Private Server) to branch MikroTik routers using API-SSL.

Architecture, workflow, security rules, and deployment rules may also live in `AGENTS.md`. This file is concrete and enforceable for backend implementation.

---

## System context

The application is hosted on a VPS (Virtual Private Server), not inside the ISP network. The backend communicates directly with ISP MikroTik routers through RouterOS API-SSL.

Required communication model:

```text
Customer Portal
    |
    | HTTPS
    v
VPS Backend
    |
    | Outbound TCP 8729 from VPS Public IP
    v
MikroTik Public WAN IP
    |
    | Firewall allows only VPS Public IP
    v
RouterOS API-SSL
```

The system must support:

- Multiple ISP companies.
- Multiple branches per ISP company.
- Strict tenant and branch isolation.
- Customer self-diagnosis.
- MikroTik diagnostics.
- Support ticket creation.
- Customer troubleshooting guidance.
- Email/SMS/portal notifications.
- Audit logs for every router API command.

---

## Engineering principles

- **SOLID**
  - *Single Responsibility:* each layer has exactly one job.
    - `diagnostics.controller.ts` adapts HTTP requests/responses.
    - `diagnostics.service.ts` coordinates diagnostic creation and result retrieval.
    - `diagnostic-orchestrator.service.ts` creates and schedules diagnostic jobs.
    - `mikrotik-diagnostic.service.ts` performs MikroTik-specific checks.
    - `mikrotik-api.client.ts` only handles RouterOS API communication.
    - `diagnostic-rules.service.ts` classifies results.
    - `tickets.service.ts` creates and updates support tickets.
    - `*.repository.ts` files perform data access only.
  - *Open/Closed:* add new diagnostic checks as new check methods or strategy classes. Do not add unrelated branching logic inside controllers.
  - *Interface Segregation:* pass narrow context objects such as `AuthUserContext`, `TenantBranchContext`, and `DiagnosticContext`; do not pass full database records when only `tenantId`, `branchId`, or `userId` is required.
  - *Dependency Inversion:* services should depend on interfaces or injected providers. Do not instantiate infrastructure clients directly inside business logic.

- **DRY:** domain enums, status values, issue codes, router roles, diagnostic step names, and permissions must live once in `constants/` or `types/`. Import them; do not re-type string literals.

- **KISS:** keep controllers thin. Keep router communication isolated. Keep diagnostic rules readable and explainable.

- **YAGNI:** do not build AI classification, auto-remediation, router write commands, or complex workflow engines unless the task explicitly requires them. The MVP should be deterministic and rule-based.

- **Defensive Coding:**
  - *Optional Chaining & Fallbacks:* Always use optional chaining (`?.`) when accessing potentially nested or nullable properties of objects to avoid runtime "Cannot read property of undefined" errors. Provide sensible fallback/default data using the nullish coalescing operator (`??`) to prevent application crashes and errors.
    - Example: `const email = user?.profile?.email ?? 'no-email@isp.com';`
  - *Try-Catch-Finally:* Always use a `finally` block in `try-catch` blocks, particularly when working with shared or finite resources (such as database connections, network sockets, active queue clients, or lock releases) to guarantee cleanup, connection closure, or state resetting under both success and error conditions.

---

## Mandatory layer boundaries

Use this flow for new APIs:

```text
route -> controller -> service -> repository
                         |
                         v
                    domain service
                         |
                         v
                 infrastructure adapter/client
```

For diagnostics:

```text
diagnostics.controller.ts
    -> diagnostics.service.ts
        -> diagnostic-orchestrator.service.ts
            -> diagnostic queue/job
                -> diagnostic-job.processor.ts
                    -> mikrotik-diagnostic.service.ts
                        -> mikrotik-api.client.ts
                    -> diagnostic-rules.service.ts
                    -> tickets.service.ts
                    -> notification.service.ts
```

### Controller responsibilities

Controllers may only:

- Read authenticated user context.
- Parse and validate request data.
- Call one service method.
- Return the service response.
- Pass errors to the centralized error handler.

Controllers must not:

- Query the database directly.
- Call MikroTik directly.
- Create tickets directly.
- Run diagnostic rules directly.
- Accept `tenant_id`, `branch_id`, or `router_id` from customer request bodies.

### Service responsibilities

Services may:

- Apply business rules.
- Coordinate repositories.
- Call domain services.
- Throw `AppError`.
- Create audit logs through an audit service.

Services must not:

- Format HTTP responses.
- Read raw `req` or `res`.
- Store secrets directly.
- Mix MikroTik command execution with classification rules.

### Repository responsibilities

Repositories may:

- Read and write database records.
- Always filter by `tenant_id` and `branch_id` where applicable.
- Return typed entities or `null`.

Repositories must not:

- Contain HTTP logic.
- Contain business rules.
- Call MikroTik.
- Create notifications.
- Create tickets except through explicit ticket repository methods called by `tickets.service.ts`.

### Infrastructure adapter/client responsibilities

Infrastructure clients may:

- Call MikroTik API-SSL.
- Call secure secret store, environment configuration, or vault.
- Send email/SMS.
- Publish or consume queue jobs.

Infrastructure clients must not:

- Classify diagnostic ownership.
- Decide whether to create tickets.
- Format customer-facing troubleshooting messages.

---

## Tenant and branch isolation rules

Every customer, service, router, diagnostic run, diagnostic step, ticket, notification, and audit log must be scoped by:

```text
tenant_id
branch_id
```

### Never trust customer-provided tenant or branch values

Bad:

```ts
const { tenantId, branchId, routerId } = req.body;
```

Good:

```ts
const { tenantId, branchId, userId } = getAuthUserContext(req);
```

### Every scoped query must include tenant and branch

Bad:

```ts
const router = await routerRepository.findById(routerId);
```

Good:

```ts
const router = await routerRepository.findById({
  id: routerId,
  tenantId: context.tenantId,
  branchId: context.branchId,
});
```

### Router selection must be backend-controlled

Customer APIs must never accept `routerId`.

Good flow:

```text
auth user -> tenant_id + branch_id -> customer service -> branch router -> diagnostic job
```

### Job payloads must include tenant and branch

```ts
interface RunDiagnosticJob {
  jobType: 'run_diagnostic';
  tenantId: string;
  branchId: string;
  diagnosticRunId: string;
  customerServiceId: string;
}
```

The worker must validate that every loaded record matches the job scope.

---

## MikroTik communication rules

The backend talks to MikroTik routers from a VPS through RouterOS API-SSL.

### Required rules

- Use API-SSL on TCP `8729`.
- Never use plain API port `8728` in production.
- MikroTik firewall must allow only the VPS Public IP.
- Each router must have a dedicated diagnostic API user.
- The diagnostic API user should be read-only for MVP.
- Never use the MikroTik `admin` user.
- Never store raw MikroTik passwords in PostgreSQL.
- Load credentials from a secure vault or environment variables.
- Log every MikroTik command in `router_api_audit_logs`.
- Mask secrets, tokens, and passwords in all logs.
- Add connection timeouts.
- Add command timeouts.
- Add per-router concurrency limits.
- Add circuit breaker behavior for unhealthy routers.

### Allowed first-version MikroTik checks

Read-only diagnostic checks only:

```text
pppoe_session_check
dhcp_lease_check
arp_table_check
ip_conflict_check
router_interface_check
dns_resolver_check
bandwidth_queue_check
router_resource_check
recent_disconnect_log_check
```

### Do not add write operations in MVP

Do not implement these unless explicitly requested and reviewed:

```text
restart router
disable customer
change customer speed profile
remove DHCP lease
kill PPPoE session
modify firewall
modify address list
change DNS settings
```

### MikroTik client must be infrastructure-only

Bad:

```ts
class MikroTikApiClient {
  async diagnoseAndCreateTicket() {
    // connects to router
    // classifies issue
    // creates support ticket
  }
}
```

Good:

```ts
class MikroTikApiClient {
  async execute<T>(
    command: string,
    params?: Record<string, string>,
  ): Promise<T> {
    // only RouterOS communication
  }
}
```

---

## Diagnostic workflow rules

Use background jobs for diagnostics. Do not run full MikroTik diagnostics inside the initial HTTP request.

Required flow:

```text
POST /api/v1/diagnostics
    -> validate request
    -> resolve customer service
    -> create diagnostic_runs row
    -> create diagnostic_steps rows
    -> enqueue diagnostic job
    -> return diagnostic_run_id
```

Worker flow:

```text
diagnostic-job.processor.ts
    -> load diagnostic run by tenant_id + branch_id
    -> load customer service by tenant_id + branch_id
    -> load router by tenant_id + branch_id
    -> load router credentials from secret manager
    -> run MikroTik checks
    -> save diagnostic step results
    -> classify result
    -> update diagnostic run
    -> create support ticket if ISP-side
    -> send notification
```

### Diagnostic result ownership

Allowed final results:

```ts
export const DIAGNOSTIC_RESULT = {
  ISP_SIDE: 'isp_side',
  CUSTOMER_SIDE: 'customer_side',
  INCONCLUSIVE: 'inconclusive',
} as const;
```

Use `inconclusive` when the system cannot safely determine ownership. Do not guess.

---

## Diagnostic rules engine standards

Diagnostic classification must be deterministic and explainable.

Good rule result:

```ts
interface DiagnosticDecision {
  owner: DiagnosticResultOwner;
  issueCode: DiagnosticIssueCode;
  priority: TicketPriority;
  confidenceScore: number;
  message: string;
  shouldCreateTicket: boolean;
}
```

Rules must:

- Prefer clear evidence over assumptions.
- Include confidence score.
- Include issue code.
- Include customer-safe message.
- Avoid exposing router credentials, private IPs, or internal command output to customers.
- Create tickets only for ISP-side or critical inconclusive issues.

Example:

```ts
if (result.dns.ipEndpointWorks && !result.dns.domainEndpointWorks && result.branchDnsDown) {
  return {
    owner: DIAGNOSTIC_RESULT.ISP_SIDE,
    issueCode: DIAGNOSTIC_ISSUE_CODE.DNS_FAILURE,
    priority: TICKET_PRIORITY.HIGH,
    confidenceScore: 90,
    message: 'DNS failure detected in the ISP branch network.',
    shouldCreateTicket: true,
  };
}
```

---

## Database standards

Primary database: PostgreSQL.

- **Strict PostgreSQL Thinking:** We MUST use PostgreSQL as our database. When creating schemas, tables, relationships, or indexes, design and think strictly in a **PostgreSQL-native way** (utilizing PostgreSQL-specific data types, constraints, and features rather than generic SQL or patterns designed for other engines).

Recommended table groups:

```text
tenants
branches
users
customer_services
routers
diagnostic_runs
diagnostic_steps
support_tickets
troubleshooting_guides
notifications
audit_logs
router_api_audit_logs
```

### Entity rules

- **Think PostgreSQL Strictly:** When designing tables and columns, explicitly leverage PostgreSQL's native capabilities.
- Use UUID primary keys (`uuid` type).
- Every tenant-scoped table must include `tenant_id`.
- Every branch-scoped table must include `branch_id`.
- Use `created_at` and `updated_at` timestamps with time zone (`timestamptz`).
- Use `deleted_at` only if soft delete is required.
- Use PostgreSQL `INET` for IP addresses where possible.
- Use PostgreSQL `MACADDR` for MAC addresses where possible.
- Use PostgreSQL `JSONB` only for flexible raw diagnostic results and metadata.
- Do not store MikroTik raw credentials in database tables.

### Repository method naming

Good:

```ts
findByIdScoped(params: TenantBranchIdParams): Promise<Router | null>
findActiveServiceByUser(params: FindCustomerServiceParams): Promise<CustomerService | null>
createDiagnosticRun(input: CreateDiagnosticRunInput): Promise<DiagnosticRun>
updateDiagnosticResult(input: UpdateDiagnosticResultInput): Promise<void>
```

Bad:

```ts
getData(id: string): Promise<any>
findRouter(routerId: string): Promise<Router>
```

---

## TypeScript standards

- Use strict TypeScript.
- Do not add `any` or `as any`.
- Prefer `unknown` with narrowing for external responses.
- Define DTOs and schemas for every API input.
- Derive input types from Zod where Zod is used.
- Keep domain types in `types/`.
- Keep enum-like values in `constants/`.
- Use explicit return types on public service methods.
- **Use Object Chaining & Fallbacks:** Always use optional chaining (`?.`) and nullish coalescing (`??`) for accessing nested properties on API inputs, external responses, and optional database entities to provide fallback data and avoid runtime errors.
- Do not pass full database objects when a narrow context type is enough.

### Context types

Use narrow context objects:

```ts
export interface AuthUserContext {
  userId: string;
  tenantId: string;
  branchId: string;
  role: UserRole;
  email?: string;
}

export interface TenantBranchContext {
  tenantId: string;
  branchId: string;
}
```

### External response handling

MikroTik/API responses must be typed and normalized.

Bad:

```ts
const result: any = await client.execute('/ppp/active/print');
return result[0].name;
```

Good:

```ts
const rows = await this.mikrotikClient.execute<RouterOsPppActiveRow[]>(
  '/ppp/active/print',
);

return rows.map(normalizePppActiveRow);
```

---

## Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Route file | lowercase resource, plural | `routes/diagnostics.ts`, `routes/routers.ts` |
| Controller file | `*.controller.ts` | `diagnostics.controller.ts` |
| Service file | `*.service.ts` | `diagnostics.service.ts` |
| Domain service file | `*.service.ts` | `diagnostic-rules.service.ts` |
| Repository file | `*.repository.ts` | `router.repository.ts` |
| Infrastructure client | `*.client.ts` | `mikrotik-api.client.ts` |
| Queue processor | `*.processor.ts` | `diagnostic-job.processor.ts` |
| Validator file | `*.schemas.ts` | `diagnostic.schemas.ts` |
| Constants file | plural domain name | `diagnostic.constants.ts` |
| Types file | plural domain name | `diagnostic.types.ts` |
| Classes | PascalCase | `DiagnosticsService`, `MikroTikApiClient` |
| Functions / variables | camelCase | `startDiagnostic`, `classifyDiagnostic` |
| Constants | UPPER_SNAKE_CASE keys | `DIAGNOSTIC_RESULT.ISP_SIDE` |
| DTOs | `*Dto` or `*Input` | `StartDiagnosticInput` |

---

## Request validation standard

- Define schemas in `validators/*.schemas.ts` or module-local `*.schemas.ts`.
- Parse in the controller before calling the service.
- Do not parse request bodies inside services.
- Do not accept `tenant_id`, `branch_id`, or `router_id` in customer diagnostic request bodies.

Example:

```ts
export const startDiagnosticSchema = z.object({
  issueType: z.enum([
    'slow_speed',
    'no_internet',
    'dns_failure',
    'ip_conflict',
    'frequent_disconnect',
    'unknown',
  ]),
});

export type StartDiagnosticInput = z.infer<typeof startDiagnosticSchema>;
```

Controller:

```ts
async start(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = getAuthUserContext(req);
    const input = startDiagnosticSchema.parse(req.body);
    const result = await diagnosticsService.startDiagnostic(user, input);
    return res.status(202).json(result);
  } catch (error) {
    next(error);
  }
}
```

---

## Error handling standard

- Services throw `AppError` using factory methods.
- Controllers catch and call `next(error)`.
- The centralized error handler formats all responses.
- Do not format error JSON manually inside services.
- Do not expose internal router command errors to customers.
- Log internal errors with correlation IDs.
- **Try-Catch-Finally:** Always include a `finally` block in all `try-catch` structures. The `finally` block must be used to perform mandatory cleanups, release concurrency locks, reset local states, or close/return open resource connections (like database clients or network sockets) regardless of whether the execution succeeded or failed.

Recommended error categories:

```text
badRequest      -> invalid input
unauthorized    -> missing/invalid authentication
forbidden       -> tenant/branch/role access denied
notFound        -> scoped resource not found
conflict        -> duplicate or invalid state transition
serviceUnavailable -> router/API/secret manager unavailable
timeout         -> MikroTik command timeout
internal        -> unexpected server error
```

Customer-safe message example:

```text
The diagnostic system could not complete this check. Please try again later.
```

Internal log example:

```text
router_api_timeout tenant=... branch=... router=... diagnosticRun=...
```

Do not show this internal detail to customers.

---

## Shared types, constants, and enums

Single source of truth required.

Recommended files:

```text
constants/user-role.constants.ts
constants/diagnostic.constants.ts
constants/router.constants.ts
constants/ticket.constants.ts
constants/notification.constants.ts

types/auth.types.ts
types/tenant.types.ts
types/diagnostic.types.ts
types/router.types.ts
types/ticket.types.ts
```

Example constants:

```ts
export const DIAGNOSTIC_ISSUE_TYPE = {
  SLOW_SPEED: 'slow_speed',
  NO_INTERNET: 'no_internet',
  DNS_FAILURE: 'dns_failure',
  IP_CONFLICT: 'ip_conflict',
  FREQUENT_DISCONNECT: 'frequent_disconnect',
  UNKNOWN: 'unknown',
} as const;

export const DIAGNOSTIC_STEP = {
  PPPoE_SESSION_CHECK: 'pppoe_session_check',
  DHCP_LEASE_CHECK: 'dhcp_lease_check',
  ARP_TABLE_CHECK: 'arp_table_check',
  IP_CONFLICT_CHECK: 'ip_conflict_check',
  ROUTER_INTERFACE_CHECK: 'router_interface_check',
  DNS_RESOLVER_CHECK: 'dns_resolver_check',
  BANDWIDTH_QUEUE_CHECK: 'bandwidth_queue_check',
  ROUTER_RESOURCE_CHECK: 'router_resource_check',
  RECENT_DISCONNECT_LOG_CHECK: 'recent_disconnect_log_check',
} as const;
```

Do not duplicate strings like `'isp_side'`, `'dns_failure'`, `'open'`, `'critical'`, or `'primary'`.

---

## Secrets and configuration rules

- Read application config from `config/env.ts` or a typed config service.
- Do not use `process.env` directly in feature code.
- Store MikroTik credentials in a secure vault or encrypted configuration.
- Store only `credential_secret_key` in the `routers` table.
- Never log secrets.
- Never include secrets in audit logs.
- Never return secrets from APIs.
- Rotate MikroTik API credentials when needed.
- Enforce strict file/access permissions for secret storage on the VPS.

Bad:

```ts
const password = process.env.MIKROTIK_PASSWORD;
```

Good:

```ts
const credentials = await secretService.getRouterCredentials(
  router.credentialSecretKey,
);
```

---

## Logging and observability

Use structured logs. Every diagnostic flow should include:

```text
request_id
tenant_id
branch_id
user_id
diagnostic_run_id
router_id
```

Log these events:

```text
diagnostic_started
diagnostic_job_enqueued
diagnostic_job_started
mikrotik_command_started
mikrotik_command_completed
mikrotik_command_failed
diagnostic_classified
support_ticket_created
notification_sent
diagnostic_failed
```

Never log:

```text
MikroTik password
JWT token
refresh token
secret manager values
full request body with sensitive data
raw customer credentials
```

Recommended metrics:

```text
diagnostic_runs_total
diagnostic_runs_failed_total
diagnostic_runs_by_result
mikrotik_api_latency_ms
mikrotik_api_failures_total
router_unreachable_total
tickets_auto_created_total
dns_failure_detected_total
ip_conflict_detected_total
```

---

## Audit logging standard

Every MikroTik command must create a `router_api_audit_logs` record.

Required fields:

```text
tenant_id
branch_id
router_id
diagnostic_run_id
command_name
status
duration_ms
created_at
```

Optional fields:

```text
actor_user_id
command_args
error_message
```

Rules:

- Mask sensitive command args.
- Do not store passwords.
- Do not store secret keys.
- Do not store full raw responses if they contain sensitive values.
- Store summarized responses in diagnostic steps instead.

---

## Security standards

### Customer/API security

- Use HTTPS.
- Use JWT/session authentication.
- Use RBAC.
- Rate-limit diagnostics.
- Do not accept tenant/branch/router IDs from customer diagnostic APIs.
- Enforce tenant/branch scope in all queries.
- Return customer-safe errors only.

### Router security

- API-SSL only.
- VPS Public IP allowlisted only.
- Plain API disabled.
- Dedicated read-only API user.
- Minimum permissions.
- Credentials in secure store.
- Command audit logs.
- Connection timeout.
- Command timeout.
- Per-router circuit breaker.

### VPS security

- VPS outbound access should be restricted where practical (e.g. firewalls/ufw rules).
- Limit VPS SSH access to trusted ports and public keys only.
- Use firewall and host-based intrusion detection/prevention systems (e.g. Fail2ban, ufw).
- Secure and aggregate logs in a central secure location.
- Encrypt database storage.
- Restrict admin dashboard access.
- Use WAF or API rate limiting for public endpoints.

---

## Background job standards

Diagnostics must be asynchronous.

Use one of:

```text
BullMQ/Redis
RabbitMQ
Amazon SQS
Kafka
```

For MVP, BullMQ/Redis is acceptable.

Job processing rules:

- Job must include `tenantId` and `branchId`.
- Worker must reload records from DB using tenant and branch scope.
- Worker must not trust stale job payload data.
- Worker must update diagnostic status.
- Worker must update each diagnostic step.
- Worker must handle retries carefully.
- Worker must not retry authentication failures aggressively.
- Worker must mark diagnostics as failed or inconclusive after timeout.

Recommended limits:

```text
Router connection timeout: 5 seconds
Command timeout: 5-10 seconds
Full diagnostic timeout: 30-60 seconds
Max concurrent diagnostics per router: 3-5
```

---

## Ticketing standards

Only `tickets.service.ts` may decide to create support tickets from diagnostic decisions.

Create ticket automatically when:

```text
final_result = isp_side
OR final_result = inconclusive AND severity = critical
OR many customers in the same branch report the same issue
```

Do not auto-create tickets for simple customer-side cases:

```text
account_inactive
router_not_connected
customer_device_dns_cache_issue
customer_wifi_issue
```

Ticket must include:

```text
tenant_id
branch_id
user_id
customer_service_id
diagnostic_run_id
title
description
priority
status
```

Ticket descriptions must be useful for support staff but must not include secrets.

---

## Notification standards

Only `notification.service.ts` may send notifications.

Notification types:

```text
email
sms
whatsapp
portal
```

For ISP-side issues, notify the customer that a ticket was created.

For customer-side issues, send troubleshooting guidance.

Do not send raw MikroTik logs or internal command results to customers.

---

## Testing standards

Use Jest for unit tests and integration tests.

### Unit tests

Required for:

```text
diagnostic-rules.service.ts
diagnostics.service.ts
diagnostic-orchestrator.service.ts
tickets.service.ts
tenant-scope.guard.ts
mikrotik-diagnostic.service.ts with mocked MikroTik client
repositories with mocked DB client or test DB
```

### Integration tests

Required for:

```text
POST /api/v1/diagnostics
GET /api/v1/diagnostics/:id/result
admin diagnostic list
ticket status update
tenant/branch access denial
```

### MikroTik tests

Do not run tests against production MikroTik routers.

Use:

```text
mock MikroTik API client
recorded safe fixtures
local fake RouterOS API server
staging router only when explicitly configured
```

### Security tests

Add tests for:

```text
customer cannot pass branch_id to route diagnostic to another branch
customer cannot access another branch diagnostic run
admin cannot access another tenant unless super_admin
router lookup always uses tenant_id + branch_id
MikroTik credentials are never returned from APIs
```

### Coverage expectation

Any business logic added or changed must include tests. Focus especially on:

```text
tenant isolation
branch isolation
diagnostic classification
ticket creation rules
router failure handling
```

---

## Example good implementation

Controller:

```ts
export class DiagnosticsController {
  async start(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = getAuthUserContext(req);
      const input = startDiagnosticSchema.parse(req.body);

      const result = await diagnosticsService.startDiagnostic(user, input);

      return res.status(202).json(result);
    } catch (error) {
      next(error);
    }
  }
}
```

Service:

```ts
export class DiagnosticsService {
  async startDiagnostic(
    user: AuthUserContext,
    input: StartDiagnosticInput,
  ): Promise<StartDiagnosticResponse> {
    const customerService =
      await this.customerServiceRepository.findActiveByUser({
        tenantId: user.tenantId,
        branchId: user.branchId,
        userId: user.userId,
      });

    if (!customerService) {
      throw AppError.notFound('Active customer service');
    }

    const diagnosticRun = await this.diagnosticsRepository.createRun({
      tenantId: user.tenantId,
      branchId: user.branchId,
      userId: user.userId,
      customerServiceId: customerService.id,
      issueType: input.issueType,
      status: DIAGNOSTIC_STATUS.PENDING,
    });

    await this.diagnosticOrchestrator.enqueueRun({
      tenantId: user.tenantId,
      branchId: user.branchId,
      diagnosticRunId: diagnosticRun.id,
      customerServiceId: customerService.id,
    });

    return {
      diagnosticRunId: diagnosticRun.id,
      status: diagnosticRun.status,
    };
  }
}
```

Worker:

```ts
export class DiagnosticJobProcessor {
  async process(job: RunDiagnosticJob): Promise<void> {
    const context = {
      tenantId: job.tenantId,
      branchId: job.branchId,
    };

    const diagnosticRun =
      await this.diagnosticsRepository.findByIdScoped({
        ...context,
        id: job.diagnosticRunId,
      });

    if (!diagnosticRun) {
      throw AppError.notFound('Diagnostic run');
    }

    const router = await this.routerRepository.findPrimaryByBranch(context);

    if (!router) {
      await this.diagnosticsRepository.markInconclusive({
        ...context,
        id: job.diagnosticRunId,
        issueCode: DIAGNOSTIC_ISSUE_CODE.ROUTER_UNAVAILABLE,
      });
      return;
    }

    const result = await this.mikrotikDiagnosticService.runChecks({
      ...context,
      router,
      diagnosticRun,
    });

    const decision = this.diagnosticRulesService.classify(result);

    await this.diagnosticsRepository.saveDecision({
      ...context,
      diagnosticRunId: diagnosticRun.id,
      decision,
    });

    if (decision.shouldCreateTicket) {
      await this.ticketsService.createFromDiagnostic({
        ...context,
        diagnosticRunId: diagnosticRun.id,
        decision,
      });
    }
  }
}
```

---

## Anti-patterns to reject

Reject any implementation that:

- Lets customers submit `tenant_id`, `branch_id`, or `router_id`.
- Queries branch-scoped data without `tenant_id` and `branch_id`.
- Calls MikroTik directly from controllers.
- Stores MikroTik passwords in PostgreSQL.
- Logs MikroTik credentials.
- Uses MikroTik plain API port `8728` in production.
- Uses the MikroTik `admin` user.
- Runs full diagnostics inside the HTTP request without a background job.
- Creates tickets directly from the MikroTik client.
- Mixes diagnostic rules with router API commands.
- Returns raw router command output to customers.
- Adds write commands to MikroTik without explicit approval.
- Adds `any` or `as any`.
- Duplicates enum/status strings across files.
- Handles errors inline instead of using centralized error handling.
- Skips tests for tenant isolation or diagnostic classification.
- Ignores PostgreSQL-native features and schemas or creates generic SQL patterns not optimized/designed for PostgreSQL strictly.
- Accesses deeply nested properties of optional or external objects without optional chaining (`?.`) and fallback values (`??`), risking unhandled runtime exceptions.
- Leaves database connections, router sockets, or locks open by omitting a `finally` block in `try-catch` operations.

---

## MVP implementation order

Build in this order:

```text
1. Auth + tenant/branch context
2. Tenant, branch, user, customer service models
3. Router model with credential_secret_key
4. Secrets service for MikroTik credentials
5. MikroTik API client
6. Diagnostics API
7. Diagnostic queue and worker
8. MikroTik read-only checks
9. Diagnostic rules service
10. Ticket creation
11. Notification service
12. Admin dashboard APIs
13. Audit logs
14. Rate limiting and monitoring
15. Tests for tenant/branch isolation
```

Do not start with AI. First build deterministic diagnostics that support engineers can understand and verify.

---

## Final rule

For every new feature, ask:

```text
Does this preserve tenant isolation?
Does this preserve branch isolation?
Does this avoid exposing router management unnecessarily?
Does this keep controllers thin?
Does this keep MikroTik communication isolated?
Does this store secrets safely?
Does this produce an auditable diagnostic result?
Does this think strictly in a PostgreSQL-native way for database schemas?
Does this use optional chaining and nullish coalescing to protect against undefined properties and provide fallback data?
Does this include a finally block in try-catch statements to guarantee resource cleanup?
Does this include tests for the changed business logic?
```

If the answer is no, the implementation is not acceptable.
