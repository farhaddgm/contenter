/**
 * The content review workflow as pure functions (docs/21-review-workflow.md). The API uses them
 * to decide and to refuse; the web shows what the API says is allowed, so both agree.
 *
 * Roles: the author is anyone who may edit the topic; an editor (EDITOR or ADMIN) reviews first;
 * the final approver is an ADMIN. Admins may skip stages with `finalize`.
 */
import type { ContentStatus, ReviewDecision, ReviewStage, Role } from './enums';

export const ReviewAction = [
  'submit',
  'approve',
  'finalize',
  'request_changes',
  'reject',
  'withdraw',
  'reopen',
] as const;
export type ReviewAction = (typeof ReviewAction)[number];

/** Actions that must come with a reason the author can act on. */
export const REVIEW_ACTIONS_NEEDING_NOTE: readonly ReviewAction[] = ['request_changes', 'reject'];

export interface WorkflowSettings {
  /**
   * true: editor approval hands the content to the final approver (an admin).
   * false: editor approval finishes it, so a team without admins can still publish.
   */
  requireFinalApproval: boolean;
}

export const DEFAULT_WORKFLOW: WorkflowSettings = { requireFinalApproval: true };

export interface ReviewSubject {
  status: ContentStatus;
  reviewStage: ReviewStage | null;
  submittedById: string | null;
  /** A content without a draft has nothing to review. */
  hasVersion: boolean;
  /** A published content is frozen: unpublish it before it can be reviewed again. */
  published?: boolean;
}

export interface ReviewActor {
  id: string;
  role: Role;
}

export interface ReviewTransition {
  status: ContentStatus;
  reviewStage: ReviewStage | null;
  decision: ReviewDecision;
  /** The stage the decision was taken at (history only). */
  stage: ReviewStage | null;
}

export type ReviewRefusal = 'wrong_state' | 'not_allowed';

const isAdmin = (a: ReviewActor) => a.role === 'ADMIN';

/** May this actor take the decision of the stage the content waits at? */
function canDecide(subject: ReviewSubject, actor: ReviewActor): boolean {
  if (subject.status !== 'IN_REVIEW') return false;
  if (subject.reviewStage === 'FINAL') return isAdmin(actor);
  // EDITORIAL: an editor, but nobody reviews their own submission (an admin may)
  if (isAdmin(actor)) return true;
  return actor.role === 'EDITOR' && actor.id !== subject.submittedById;
}

/** What the actor may do now. The caller has already checked EDIT access to the topic. */
export function reviewActionsFor(
  subject: ReviewSubject,
  actor: ReviewActor,
  _settings: WorkflowSettings = DEFAULT_WORKFLOW,
): ReviewAction[] {
  if (!subject.hasVersion || subject.published) return [];
  const actions: ReviewAction[] = [];
  switch (subject.status) {
    case 'DRAFT':
      actions.push('submit');
      if (isAdmin(actor)) actions.push('finalize');
      break;
    case 'IN_REVIEW':
      if (canDecide(subject, actor)) actions.push('approve', 'request_changes', 'reject');
      if (isAdmin(actor) && subject.reviewStage !== 'FINAL') actions.push('finalize');
      if (isAdmin(actor) || actor.id === subject.submittedById) actions.push('withdraw');
      break;
    case 'APPROVED':
    case 'REJECTED':
      actions.push('reopen');
      break;
    default:
      break;
  }
  return actions;
}

/** The state after `action`, or why it is refused. */
export function applyReviewAction(
  subject: ReviewSubject,
  action: ReviewAction,
  actor: ReviewActor,
  settings: WorkflowSettings = DEFAULT_WORKFLOW,
): { ok: true; next: ReviewTransition } | { ok: false; reason: ReviewRefusal } {
  if (!reviewActionsFor(subject, actor, settings).includes(action)) {
    // an admin can do everything that is possible in a state, so if even an admin cannot, the
    // state is wrong; otherwise this actor just lacks the role
    const possible = reviewActionsFor(subject, { id: '', role: 'ADMIN' }, settings).includes(
      action,
    );
    return { ok: false, reason: possible ? 'not_allowed' : 'wrong_state' };
  }
  const stage = subject.reviewStage;
  const done = (
    status: ContentStatus,
    reviewStage: ReviewStage | null,
    decision: ReviewDecision,
    at: ReviewStage | null = stage,
  ) => ({ ok: true as const, next: { status, reviewStage, decision, stage: at } });

  switch (action) {
    case 'submit':
      return done('IN_REVIEW', 'EDITORIAL', 'SUBMITTED', null);
    case 'approve':
      return stage !== 'FINAL' && settings.requireFinalApproval
        ? done('IN_REVIEW', 'FINAL', 'APPROVED')
        : done('APPROVED', null, 'APPROVED');
    case 'finalize':
      return done('APPROVED', null, 'APPROVED', 'FINAL');
    case 'request_changes':
      return done('DRAFT', null, 'CHANGES_REQUESTED');
    case 'reject':
      return done('REJECTED', null, 'REJECTED');
    case 'withdraw':
      return done('DRAFT', null, 'WITHDRAWN');
    case 'reopen':
      return done('DRAFT', null, 'REOPENED', null);
  }
}

/**
 * Text that was reviewed or approved has changed: the content returns to DRAFT and must be
 * submitted again. Null when nothing needs to change.
 */
export function resetAfterEdit(
  subject: Pick<ReviewSubject, 'status' | 'reviewStage'>,
): ReviewTransition | null {
  if (subject.status !== 'IN_REVIEW' && subject.status !== 'APPROVED') return null;
  return { status: 'DRAFT', reviewStage: null, decision: 'RESET', stage: subject.reviewStage };
}
