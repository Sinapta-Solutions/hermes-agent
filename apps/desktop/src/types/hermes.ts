export interface Workspace {
  board_id?: null | string
  branch?: null | string
  created_at: string
  description?: null | string
  id: string
  name: string
  repo_path?: null | string
  updated_at: string
  vault_path?: null | string
}

export interface WorkspacesResponse {
  object: 'list'
  workspaces: Workspace[]
}

export interface WorkspaceMutationResponse {
  object: 'hermes.workspace'
  workspace: Workspace
}

export interface WorkspacePayload {
  board_id?: null | string
  branch?: null | string
  description?: null | string
  name: string
  repo_path?: null | string
  vault_path?: null | string
}

export interface WorkspaceCloseReadinessItem {
  code: string
  count?: number
  message: string
  path?: string
}

export interface WorkspaceCloseReadiness {
  blockers: WorkspaceCloseReadinessItem[]
  ready: boolean
  warnings: WorkspaceCloseReadinessItem[]
}

export interface WorkspaceStatus {
  close_readiness?: WorkspaceCloseReadiness
  event_count: number
  object: 'hermes.workspace.status'
  profile_count: number
  repo_exists: boolean
  task_counts: Record<string, number>
  vault_exists: boolean
  workspace_id: string
}

export interface WorkspaceEvent {
  created_at: string
  id: string
  message: string
  metadata?: null | Record<string, unknown>
  type: string
  workspace_id: string
}

export interface WorkspaceEventsResponse {
  events: WorkspaceEvent[]
  limit: number
  object: 'list'
}

export type KanbanStatus = 'triage' | 'todo' | 'scheduled' | 'ready' | 'running' | 'blocked' | 'done' | 'archived'

export interface KanbanBoard {
  archived: boolean
  color?: null | string
  created_at?: number
  db_path?: string
  default_workdir?: null | string
  description?: null | string
  icon?: null | string
  name: string
  slug: string
  task_counts: Record<string, number>
  task_total: number
  workspace_id?: null | string
  worktree_base_ref?: null | string
}

export interface KanbanBoardsResponse {
  boards: KanbanBoard[]
  object: 'list'
}

export interface KanbanGitRepository {
  branch?: null | string
  id: string
  label: string
  path: string
  source: 'board' | 'task'
  task_id?: null | string
}

export interface KanbanGitRepositoriesResponse {
  board: string
  object: 'hermes.kanban.git.repos'
  repos: KanbanGitRepository[]
}

export interface KanbanGitChangeFile {
  original_path?: string
  path: string
  raw_status: string
  sensitive: boolean
  staged: boolean
  status: 'added' | 'changed' | 'conflicted' | 'copied' | 'deleted' | 'modified' | 'renamed' | 'untracked'
}

export interface KanbanGitStatusResponse {
  board: string
  files: KanbanGitChangeFile[]
  object: 'hermes.kanban.git.status'
  repo: KanbanGitRepository
}

export interface KanbanGitDiffResponse {
  board: string
  diff: string
  object: 'hermes.kanban.git.diff'
  path: string
  repo: KanbanGitRepository
}

export interface KanbanGitCommitPushPayload {
  message: string
  paths?: string[]
  repo_id?: null | string
}

export interface KanbanGitCommitPushResponse {
  board: string
  branch: string
  commit: string
  committed: boolean
  object: 'hermes.kanban.git.commit_push'
  paths: string[]
  pushed: boolean
  repo: KanbanGitRepository
}

export interface KanbanWorkflowEvidence {
  actor?: null | string
  created_at?: null | number
  kind?: null | string
  metadata?: null | Record<string, unknown>
  run_id?: null | number
  text?: null | string
  timestamp?: null | number
}

export type KanbanWorkflowStepStatus = 'pending' | 'ready' | 'running' | 'passed' | 'blocked' | 'failed' | 'skipped'

export interface KanbanWorkflowApproval {
  blocked_task_status?: null | string
  decided_at?: null | number
  decided_by?: null | string
  decision_reason?: null | string
  id?: null | string
  reason?: null | string
  requested_at?: null | number
  requested_by?: null | string
  run_id?: null | number
  status?: null | 'approved' | 'pending' | 'rejected'
}

export interface KanbanWorkflowStep {
  assignee?: null | string
  depends_on?: string[]
  evidence?: KanbanWorkflowEvidence[]
  approval?: KanbanWorkflowApproval
  id: string
  max_retries?: null | number
  retry_count?: number
  run_id?: null | number
  session_id?: null | string
  status: KanbanWorkflowStepStatus
  timestamps?: Record<string, null | number>
  title?: null | string
  type?: null | string
  validation_criteria?: string[]
}

export interface KanbanWorkflowStepPayload {
  assignee?: null | string
  depends_on?: string[]
  id: string
  max_retries?: null | number
  title?: null | string
  type?: null | string
  validation_criteria?: string[]
}

export interface KanbanWorkflowStepUpdatePayload {
  assignee?: null | string
  evidence?: null | string
  status?: KanbanWorkflowStepStatus
}

export interface KanbanWorkflowRoute {
  current_step_id?: null | string
  policy?: Record<string, unknown>
  steps: KanbanWorkflowStep[]
  template_id?: null | string
  version?: number
}

export interface KanbanTask {
  assignee?: null | string
  body?: null | string
  branch_name?: null | string
  completed_at?: null | number
  consecutive_failures: number
  created_at: number
  created_by?: null | string
  current_run_id?: null | number
  current_step_key?: null | string
  goal_max_turns?: null | number
  goal_mode: boolean
  id: string
  last_failure_error?: null | string
  last_heartbeat_at?: null | number
  model_override?: null | string
  priority: number
  result?: null | string
  session_id?: null | string
  skills?: null | string
  started_at?: null | number
  status: KanbanStatus
  tenant?: null | string
  title: string
  worker_pid?: null | number
  workflow_route?: KanbanWorkflowRoute | null
  workflow_template_id?: null | string
  workflowRoute?: KanbanWorkflowRoute | null
  workspace_kind: string
  workspace_path?: null | string
}

export interface KanbanTasksResponse {
  board: KanbanBoard | null
  object: 'list'
  task_counts: Record<string, number>
  tasks: KanbanTask[]
}

export interface KanbanTaskPayload {
  assignee?: null | string
  body?: null | string
  priority?: number
  status?: KanbanStatus
  tenant?: null | string
  title: string
  workflowRoute?: KanbanWorkflowRoute | null
  workspace_kind?: string
  workspace_path?: null | string
}

export interface KanbanTaskUpdatePayload {
  assignee?: null | string
  body?: null | string
  priority?: number
  status?: KanbanStatus
  tenant?: null | string
  title?: string
  workflowRoute?: KanbanWorkflowRoute | null
  workspace_kind?: string
  workspace_path?: null | string
}

export interface KanbanTaskMutationResponse {
  object: 'hermes.kanban.task'
  task: KanbanTask
}

export interface KanbanEvent {
  created_at: number
  id: number
  kind: string
  payload?: null | string | Record<string, unknown>
  run_id?: null | number
  task_id: string
}

export interface KanbanActivityItem {
  author?: string
  body?: string
  comment_id?: number
  created_at: number
  id: number
  kind: string
  payload?: unknown
  raw_kind?: string
  run_id?: null | number
  source: 'comment' | 'event'
  task_id: string
  task_title?: null | string
}

export interface KanbanActivityResponse {
  activity: KanbanActivityItem[]
  board: string
  object: 'hermes.kanban.activity'
  task_id?: string
}

export interface KanbanComment {
  author: string
  body: string
  created_at: number
  id: number
  task_id: string
}

export interface KanbanCommentPayload {
  author?: string
  body: string
  intent?: 'interrupt' | 'resume'
}

export interface KanbanCommentMutationResponse {
  comment: KanbanComment
  object: 'hermes.kanban.comment'
}

export interface KanbanFailure {
  ended_at?: null | number
  error?: null | string
  event_id?: number
  kind?: string
  outcome?: null | string
  payload?: KanbanEvent['payload']
  profile?: null | string
  run_id?: null | number
  source: 'event' | 'run' | 'task'
  started_at?: null | number
  summary?: null | string
}

export interface KanbanRun {
  claim_expires?: null | number
  claim_lock?: null | string
  ended_at?: null | number
  error?: null | string
  id: number
  last_heartbeat_at?: null | number
  max_runtime_seconds?: null | number
  metadata?: null | Record<string, unknown> | string
  outcome?: null | string
  profile?: null | string
  started_at: number
  status: string
  step_key?: null | string
  summary?: null | string
  task_id: string
  worker_pid?: null | number
}

export interface KanbanTaskRunsResponse {
  object: 'hermes.kanban.task.runs'
  runs: KanbanRun[]
  task_id: string
}

export interface KanbanBlocker {
  assignee?: null | string
  id: string
  status: KanbanStatus
  title: string
}

export interface KanbanBlockersResponse {
  blocked: boolean
  blockers: KanbanBlocker[]
  board: string
  object: 'hermes.kanban.blockers'
  task_id: string
}

export interface KanbanTaskDetailResponse {
  blockers?: KanbanBlocker[]
  comments: KanbanComment[]
  events: KanbanEvent[]
  failures?: KanbanFailure[]
  links: Array<{ child_id: string; parent_id: string }>
  object: 'hermes.kanban.task.detail'
  runs: KanbanRun[]
  task: KanbanTask
}

export interface KanbanAssigneesResponse {
  assignees: string[]
  object: 'list'
}

export interface KanbanDispatcherRun {
  claim_expires?: null | number
  id: number
  last_heartbeat_at?: null | number
  profile?: null | string
  started_at: number
  status: string
  step_key?: null | string
  task_id: string
  task_status: KanbanStatus
  title: string
  worker_pid?: null | number
}

export interface KanbanDispatcherStatusResponse {
  active_runs: KanbanDispatcherRun[]
  board: KanbanBoard | null
  dispatch_in_gateway: boolean
  gateway_pid?: null | number
  last_event_at?: null | number
  object: 'hermes.kanban.dispatcher_status'
  pending_approvals_count: number
  invalid_workflow_route_count?: number
  ready_count: number
  running_count: number
  stale_running_count: number
}

export interface ConfigFieldSchema {
  category?: string
  description?: string
  options?: unknown[]
  type?: 'boolean' | 'list' | 'number' | 'select' | 'string' | 'text'
}

export interface ConfigSchemaResponse {
  category_order?: string[]
  fields: Record<string, ConfigFieldSchema>
}

export interface AudioTranscriptionResponse {
  ok: boolean
  provider?: string
  transcript: string
}

export interface AudioSpeakResponse {
  ok: boolean
  data_url: string
  mime_type: string
  provider?: string
}

export interface ElevenLabsVoice {
  label: string
  name: string
  voice_id: string
}

export interface ElevenLabsVoicesResponse {
  available: boolean
  voices: ElevenLabsVoice[]
}

export interface OAuthProviderStatus {
  error?: string
  expires_at?: null | string
  has_refresh_token?: boolean
  last_refresh?: null | string
  logged_in: boolean
  source?: null | string
  source_label?: null | string
  token_preview?: null | string
}

export interface OAuthProvider {
  cli_command: string
  docs_url: string
  flow: 'device_code' | 'external' | 'loopback' | 'pkce'
  id: string
  name: string
  status: OAuthProviderStatus
}

export interface OAuthProvidersResponse {
  providers: OAuthProvider[]
}

export type OAuthStartResponse =
  | {
      auth_url: string
      expires_in: number
      flow: 'pkce'
      session_id: string
    }
  | {
      expires_in: number
      flow: 'device_code'
      poll_interval: number
      session_id: string
      user_code: string
      verification_url: string
    }
  | {
      auth_url: string
      expires_in: number
      flow: 'loopback'
      session_id: string
    }

export interface OAuthSubmitResponse {
  message?: string
  ok: boolean
  status: 'approved' | 'error'
}

export interface OAuthPollResponse {
  error_message?: null | string
  expires_at?: null | number
  session_id: string
  status: 'approved' | 'denied' | 'error' | 'expired' | 'pending'
}

export interface EnvVarInfo {
  advanced: boolean
  category: string
  // True when this var is a messaging-platform credential owned by a card on
  // the dedicated Messaging page. The Keys page hides these to avoid
  // duplicating the richer channel-configuration UI.
  channel_managed?: boolean
  description: string
  is_password: boolean
  is_set: boolean
  redacted_value: null | string
  tools: string[]
  url: null | string
}

export interface MessagingEnvVarInfo {
  advanced: boolean
  description: string
  is_password: boolean
  is_set: boolean
  key: string
  prompt: string
  redacted_value: null | string
  required: boolean
  url: null | string
}

export interface MessagingHomeChannel {
  chat_id: string
  name: string
  platform: string
  thread_id?: string
}

export interface MessagingPlatformInfo {
  configured: boolean
  description: string
  docs_url: string
  enabled: boolean
  env_vars: MessagingEnvVarInfo[]
  error_code?: null | string
  error_message?: null | string
  gateway_running: boolean
  home_channel?: MessagingHomeChannel | null
  id: string
  name: string
  state?: null | string
  updated_at?: null | string
}

export interface MessagingPlatformsResponse {
  platforms: MessagingPlatformInfo[]
}

export interface MessagingPlatformUpdate {
  clear_env?: string[]
  enabled?: boolean
  env?: Record<string, string>
}

export interface MessagingPlatformTestResponse {
  message: string
  ok: boolean
  state?: null | string
}

export interface GatewayReadyPayload {
  skin?: unknown
}

export interface HermesConfig {
  agent?: {
    reasoning_effort?: string
    personalities?: Record<string, unknown>
    service_tier?: string
  }
  display?: {
    personality?: string
    skin?: string
  }
  terminal?: {
    cwd?: string
  }
  stt?: {
    enabled?: boolean
  }
  voice?: {
    max_recording_seconds?: number
  }
}

export type HermesConfigRecord = Record<string, unknown>

export interface ModelInfoResponse {
  auto_context_length?: number
  capabilities?: Record<string, unknown>
  config_context_length?: number
  effective_context_length?: number
  model: string
  provider: string
}

export interface ModelPricing {
  /** Formatted $/Mtok input price, e.g. "$3.00", or "free", or "" if unknown. */
  input: string
  /** Formatted $/Mtok output price. */
  output: string
  /** Formatted $/Mtok cached-input price, or null when the model has none. */
  cache: string | null
  /** True when the model costs nothing (free tier eligible). */
  free: boolean
}

export interface ModelOptionProvider {
  is_current?: boolean
  models?: string[]
  name: string
  slug: string
  total_models?: number
  warning?: string
  /** True when the provider has usable credentials. False for canonical
   *  providers surfaced by `include_unconfigured` that the user hasn't set up
   *  yet — render these with a setup affordance instead of hiding them. */
  authenticated?: boolean
  /** Auth flow for an unconfigured provider: "api_key" can be activated inline
   *  by pasting `key_env`; anything else (oauth_*, external, aws_sdk, …) needs
   *  the `hermes model` CLI / onboarding OAuth flow. */
  auth_type?: string
  /** Env var to paste an API key into, for unconfigured `api_key` providers. */
  key_env?: string
  /** True for providers defined via the user's `providers:` config block. */
  is_user_defined?: boolean
  /** Per-model pricing keyed by model id (present when the picker requested
   *  pricing and the provider supports live pricing). */
  pricing?: Record<string, ModelPricing>
  /** Nous only: whether the current account is on the free tier. */
  free_tier?: boolean
  /** Nous only: paid models a free-tier user cannot select (shown disabled). */
  unavailable_models?: string[]
  /** Per-model option support, keyed by model id (present when the picker
   *  requested capabilities). Lets the UI gate fast/reasoning controls. */
  capabilities?: Record<string, ModelCapabilities>
}

export interface ModelCapabilities {
  fast: boolean
  reasoning: boolean
}

export interface ModelOptionsResponse {
  model?: string
  provider?: string
  providers?: ModelOptionProvider[]
}

export interface PaginatedSessions {
  limit: number
  offset: number
  sessions: SessionInfo[]
  total: number
  /** Listable conversation count per profile (children excluded), keyed by
   *  profile name. Lets the sidebar scope its "Load more" footer to the active
   *  profile instead of the global total. Present only on
   *  `/api/profiles/sessions`. */
  profile_totals?: Record<string, number>
  /** Per-profile read failures from the cross-profile aggregator (e.g. a locked
   *  or corrupt state.db). Present only on `/api/profiles/sessions`. */
  errors?: Array<{ profile: string; error: string }>
}

export interface RpcEvent<T = unknown> {
  payload?: T
  session_id?: string
  type: string
}

export interface SessionCreateResponse {
  info?: SessionRuntimeInfo
  message_count?: number
  messages?: SessionMessage[]
  session_id: string
  stored_session_id?: string
}

export interface SessionInfo {
  archived?: boolean
  cwd?: null | string
  ended_at: null | number
  id: string
  /** Original root id of a compression chain, when this entry is a projected
   *  continuation tip. Stable across compressions — used as the durable id for
   *  pins so a pinned conversation survives auto-compression. */
  _lineage_root_id?: null | string
  input_tokens: number
  is_active: boolean
  last_active: number
  message_count: number
  model: null | string
  output_tokens: number
  preview: null | string
  source: null | string
  started_at: number
  title: null | string
  tool_call_count: number
  /** Origin platform when this session was handed off from a messaging
   *  platform (e.g. a Telegram thread continued in the desktop app). The live
   *  {@link source} becomes local (tui/desktop) after a handoff, so the origin
   *  is preserved here to surface the platform badge on the row. */
  handoff_platform?: null | string
  /** Handoff lifecycle: 'pending' | 'in_progress' | 'completed' | 'failed'. */
  handoff_state?: null | string
  handoff_error?: null | string
  /** Owning profile name, set by the cross-profile aggregator
   *  (`/api/profiles/sessions`). Absent on legacy single-profile responses,
   *  which the UI treats as the default profile. */
  profile?: string
  /** True when {@link profile} is the default profile. */
  is_default_profile?: boolean
}

export interface SessionMessage {
  codex_reasoning_items?: unknown
  content: unknown
  context?: unknown
  name?: string
  reasoning?: null | string
  reasoning_content?: null | string
  reasoning_details?: unknown
  role: 'assistant' | 'system' | 'tool' | 'user'
  text?: unknown
  timestamp?: number
  tool_call_id?: null | string
  tool_calls?: unknown
  tool_name?: string
}

export interface SessionMessagesResponse {
  messages: SessionMessage[]
  session_id: string
}

export interface SessionResumeResponse {
  info?: SessionRuntimeInfo
  message_count: number
  messages: SessionMessage[]
  resumed: string
  session_id: string
}

export interface SessionRuntimeInfo {
  branch?: string
  config_warning?: string
  credential_warning?: string
  cwd?: string
  desktop_contract?: number
  fast?: boolean
  model?: string
  personality?: string
  provider?: string
  reasoning_effort?: string
  running?: boolean
  service_tier?: string
  skills?: Record<string, string[]> | string[]
  tools?: Record<string, string[]>
  usage?: Partial<UsageStats>
  version?: string
  yolo?: boolean
}

export interface UsageStats {
  calls: number
  context_max?: number
  context_percent?: number
  context_used?: number
  cost_usd?: number
  input: number
  output: number
  total: number
}

export interface AnalyticsDailyEntry {
  actual_cost: number
  api_calls: number
  cache_read_tokens: number
  day: string
  estimated_cost: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  sessions: number
}

export interface AnalyticsModelEntry {
  api_calls: number
  estimated_cost: number
  input_tokens: number
  model: string
  output_tokens: number
  sessions: number
}

export interface AnalyticsResponse {
  by_model: AnalyticsModelEntry[]
  daily: AnalyticsDailyEntry[]
  period_days: number
  skills: {
    summary: AnalyticsSkillsSummary
    top_skills: AnalyticsSkillEntry[]
  }
  totals: AnalyticsTotals
}

export interface AnalyticsSkillEntry {
  last_used_at: null | number
  manage_count: number
  percentage: number
  skill: string
  total_count: number
  view_count: number
}

export interface AnalyticsSkillsSummary {
  distinct_skills_used: number
  total_skill_actions: number
  total_skill_edits: number
  total_skill_loads: number
}

export interface AnalyticsTotals {
  total_actual_cost: number
  total_api_calls: null | number
  total_cache_read: null | number
  total_estimated_cost: number
  total_input: null | number
  total_output: null | number
  total_reasoning: null | number
  total_sessions: number
}

export interface CronJob {
  deliver?: null | string
  enabled: boolean
  id: string
  last_error?: null | string
  last_run_at?: null | string
  name?: null | string
  next_run_at?: null | string
  prompt?: null | string
  schedule?: CronJobSchedule
  schedule_display?: null | string
  script?: null | string
  state?: null | string
}

export interface CronJobCreatePayload {
  deliver?: string
  name?: string
  prompt: string
  schedule: string
}

export interface CronJobSchedule {
  display?: string
  expr?: string
  kind?: string
}

export interface CronJobUpdates {
  deliver?: string
  enabled?: boolean
  name?: string
  prompt?: string
  schedule?: string
}

export interface ProfileCreatePayload {
  clone_all?: boolean
  clone_from?: string
  clone_from_default?: boolean
  name: string
  no_skills?: boolean
}

export interface ProfileInfo {
  has_env: boolean
  is_default: boolean
  model: null | string
  name: string
  path: string
  provider: null | string
  skill_count: number
}

export interface ProfileSetupCommand {
  command: string
}

export interface ProfileSoul {
  content: string
  exists: boolean
}

export interface ProfilesResponse {
  profiles: ProfileInfo[]
}

export interface SkillInfo {
  category: string
  description: string
  enabled: boolean
  name: string
}

export interface ToolsetInfo {
  configured: boolean
  description: string
  enabled: boolean
  label: string
  name: string
  tools: string[]
}

export interface ToolEnvVar {
  key: string
  prompt: string
  url: string | null
  default: string | null
  is_set: boolean
}

export interface ToolProvider {
  name: string
  badge: string
  tag: string
  env_vars: ToolEnvVar[]
  post_setup: string | null
  requires_nous_auth: boolean
  /** True when this is the provider currently written to config (mirrors the
   *  CLI `hermes tools` active-provider detection). */
  is_active: boolean
}

export interface ToolsetConfig {
  name: string
  has_category: boolean
  providers: ToolProvider[]
  /** Name of the currently active provider, or null if none is configured. */
  active_provider: string | null
}

export interface SessionSearchResult {
  /** Lineage root of the matched conversation. Stable across compression and
   *  used as the durable pin id; falls back to session_id when absent. */
  lineage_root?: string | null
  model: string | null
  role: string | null
  /** Live compression tip of the matched conversation — resume by this id. */
  session_id: string
  session_started: number | null
  snippet: string
  source: string | null
}

export interface SessionSearchResponse {
  results: SessionSearchResult[]
}

export interface LogsResponse {
  file: string
  lines: string[]
}

export interface PlatformStatus {
  error_code?: string
  error_message?: string
  state: string
  updated_at: string
}

export interface StatusResponse {
  active_sessions: number
  config_path: string
  config_version: number
  env_path: string
  gateway_exit_reason: string | null
  gateway_health_url: string | null
  gateway_pid: number | null
  gateway_platforms: Record<string, PlatformStatus>
  gateway_running: boolean
  gateway_state: string | null
  gateway_updated_at: string | null
  hermes_home: string
  latest_config_version: number
  release_date: string
  version: string
}

export interface ActionResponse {
  name: string
  ok: boolean
  pid: number
}

export interface ActionStatusResponse {
  exit_code: number | null
  lines: string[]
  name: string
  pid: number | null
  running: boolean
}

export interface BackendUpdateCommit {
  sha: string
  summary: string
  author: string
  at: number
}

/** Shape of `GET /api/hermes/update/check` — the backend's own update state.
 *  Used by the desktop's remote update overlay so the backend version (not the
 *  Electron client clone) drives "what's changed + Install" in remote mode. */
export interface BackendUpdateCheckResponse {
  install_method: string
  current_version: string
  behind: number | null
  update_available: boolean
  can_apply: boolean
  update_command: string | null
  message: string | null
  commits?: BackendUpdateCommit[]
}

export interface AuxiliaryTaskAssignment {
  base_url: string
  model: string
  provider: string
  task: string
}

export interface AuxiliaryModelsResponse {
  main: { model: string; provider: string }
  tasks: AuxiliaryTaskAssignment[]
}

export interface ModelAssignmentRequest {
  /** Optional API key for a custom/local endpoint. Persisted to model.api_key
   *  (where the runtime reads it) for self-hosted endpoints that require auth.
   *  Only honored for custom/local providers on the main slot. */
  api_key?: string
  /** OpenAI-compatible endpoint URL. Only honored for custom/local providers
   *  on the main slot — wires a self-hosted endpoint into runtime resolution. */
  base_url?: string
  model: string
  provider: string
  scope: 'main' | 'auxiliary'
  task?: string
}

/** An auxiliary task still pinned to a provider that differs from the
 *  newly-selected main provider after a main-model switch. */
export interface StaleAuxAssignment {
  task: string
  provider: string
  model: string
}

export interface ModelAssignmentResponse {
  /** Persisted endpoint URL for custom/local providers (echoed back). */
  base_url?: string
  /** Toolset keys auto-routed through the Nous Tool Gateway as a result of
   *  switching the main provider to Nous. Empty unless provider === 'nous'
   *  and the user is a paid subscriber with unconfigured tools. */
  gateway_tools?: string[]
  model?: string
  ok: boolean
  provider?: string
  reset?: boolean
  scope?: string
  /** Auxiliary slots still pinned to a different provider than the new main.
   *  Switching main never clears aux pins; this lets the UI warn the user
   *  their helper tasks aren't following the switch. Only set on scope:'main'. */
  stale_aux?: StaleAuxAssignment[]
  tasks?: string[]
}
