import { describe, expect, it } from 'vitest';
import {
  applyReviewAction,
  DEFAULT_WORKFLOW,
  resetAfterEdit,
  reviewActionsFor,
  type ReviewActor,
  type ReviewSubject,
} from './workflow';

const admin: ReviewActor = { id: 'admin', role: 'ADMIN' };
const editor: ReviewActor = { id: 'ed', role: 'EDITOR' };
const author: ReviewActor = { id: 'au', role: 'VIEWER' };

const subject = (over: Partial<ReviewSubject> = {}): ReviewSubject => ({
  status: 'DRAFT',
  reviewStage: null,
  submittedById: null,
  hasVersion: true,
  ...over,
});
const inReview = (stage: 'EDITORIAL' | 'FINAL', submittedById = 'au') =>
  subject({ status: 'IN_REVIEW', reviewStage: stage, submittedById });

describe('reviewActionsFor', () => {
  it('lets any author submit a draft, and only an admin finalize it', () => {
    expect(reviewActionsFor(subject(), author)).toEqual(['submit']);
    expect(reviewActionsFor(subject(), admin)).toEqual(['submit', 'finalize']);
  });

  it('offers nothing without a draft or while generating', () => {
    expect(reviewActionsFor(subject({ hasVersion: false }), admin)).toEqual([]);
    expect(reviewActionsFor(subject({ status: 'GENERATING' }), admin)).toEqual([]);
    expect(reviewActionsFor(subject({ status: 'FAILED' }), admin)).toEqual([]);
  });

  it('lets an editor review a submission of someone else, not their own', () => {
    expect(reviewActionsFor(inReview('EDITORIAL', 'au'), editor)).toEqual([
      'approve',
      'request_changes',
      'reject',
    ]);
    // their own submission: only withdraw
    expect(reviewActionsFor(inReview('EDITORIAL', 'ed'), editor)).toEqual(['withdraw']);
  });

  it('keeps the final stage for admins', () => {
    expect(reviewActionsFor(inReview('FINAL'), editor)).toEqual([]);
    expect(reviewActionsFor(inReview('FINAL'), admin)).toEqual([
      'approve',
      'request_changes',
      'reject',
      'withdraw',
    ]);
  });

  it('lets the submitter withdraw but not review', () => {
    expect(reviewActionsFor(inReview('EDITORIAL', 'au'), author)).toEqual(['withdraw']);
    expect(reviewActionsFor(inReview('EDITORIAL', 'someone'), author)).toEqual([]);
  });

  it('lets an admin review their own submission and skip the editorial stage', () => {
    expect(reviewActionsFor(inReview('EDITORIAL', 'admin'), admin)).toEqual([
      'approve',
      'request_changes',
      'reject',
      'finalize',
      'withdraw',
    ]);
  });

  it('lets anyone reopen a decided content', () => {
    expect(reviewActionsFor(subject({ status: 'APPROVED' }), author)).toEqual(['reopen']);
    expect(reviewActionsFor(subject({ status: 'REJECTED' }), author)).toEqual(['reopen']);
  });
});

describe('applyReviewAction', () => {
  it('walks submit → editor → final approver → approved', () => {
    const submitted = applyReviewAction(subject(), 'submit', author);
    expect(submitted).toMatchObject({
      ok: true,
      next: { status: 'IN_REVIEW', reviewStage: 'EDITORIAL', decision: 'SUBMITTED' },
    });

    const afterEditor = applyReviewAction(inReview('EDITORIAL'), 'approve', editor);
    expect(afterEditor).toMatchObject({
      ok: true,
      next: { status: 'IN_REVIEW', reviewStage: 'FINAL', decision: 'APPROVED', stage: 'EDITORIAL' },
    });

    const approved = applyReviewAction(inReview('FINAL'), 'approve', admin);
    expect(approved).toMatchObject({
      ok: true,
      next: { status: 'APPROVED', reviewStage: null, decision: 'APPROVED', stage: 'FINAL' },
    });
  });

  it('finishes at the editor when no final approval is required', () => {
    const r = applyReviewAction(inReview('EDITORIAL'), 'approve', editor, {
      requireFinalApproval: false,
    });
    expect(r).toMatchObject({ ok: true, next: { status: 'APPROVED', reviewStage: null } });
  });

  it('sends changes back to the author and keeps the stage in the history', () => {
    expect(applyReviewAction(inReview('FINAL'), 'request_changes', admin)).toMatchObject({
      ok: true,
      next: { status: 'DRAFT', reviewStage: null, decision: 'CHANGES_REQUESTED', stage: 'FINAL' },
    });
  });

  it('rejects, withdraws and reopens', () => {
    expect(applyReviewAction(inReview('EDITORIAL'), 'reject', editor)).toMatchObject({
      ok: true,
      next: { status: 'REJECTED', decision: 'REJECTED' },
    });
    expect(applyReviewAction(inReview('EDITORIAL'), 'withdraw', author)).toMatchObject({
      ok: true,
      next: { status: 'DRAFT', decision: 'WITHDRAWN' },
    });
    expect(applyReviewAction(subject({ status: 'APPROVED' }), 'reopen', author)).toMatchObject({
      ok: true,
      next: { status: 'DRAFT', decision: 'REOPENED' },
    });
  });

  it('lets an admin finalize from a draft or the editorial stage', () => {
    for (const s of [subject(), inReview('EDITORIAL')]) {
      expect(applyReviewAction(s, 'finalize', admin)).toMatchObject({
        ok: true,
        next: { status: 'APPROVED', reviewStage: null, stage: 'FINAL' },
      });
    }
  });

  it('distinguishes a wrong state from a missing role', () => {
    // an editor cannot do the final approval, but an admin could → role
    expect(applyReviewAction(inReview('FINAL'), 'approve', editor)).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
    // nobody can approve a draft → state
    expect(applyReviewAction(subject(), 'approve', admin)).toEqual({
      ok: false,
      reason: 'wrong_state',
    });
    // nobody reopens a draft
    expect(applyReviewAction(subject(), 'reopen', admin)).toEqual({
      ok: false,
      reason: 'wrong_state',
    });
  });

  it('refuses everything for a content without a draft', () => {
    expect(applyReviewAction(subject({ hasVersion: false }), 'submit', admin).ok).toBe(false);
  });

  it('defaults to a two-stage flow', () => {
    expect(DEFAULT_WORKFLOW.requireFinalApproval).toBe(true);
  });
});

describe('content that was IN_REVIEW before stages existed', () => {
  const legacy = subject({ status: 'IN_REVIEW', reviewStage: null, submittedById: null });

  it('is treated as waiting at the editorial stage', () => {
    expect(reviewActionsFor(legacy, editor)).toEqual(['approve', 'request_changes', 'reject']);
    expect(reviewActionsFor(legacy, admin)).toContain('finalize');
    expect(applyReviewAction(legacy, 'approve', editor)).toMatchObject({
      ok: true,
      next: { status: 'IN_REVIEW', reviewStage: 'FINAL' },
    });
  });
});

describe('resetAfterEdit', () => {
  it('returns reviewed and approved text to DRAFT', () => {
    expect(resetAfterEdit({ status: 'IN_REVIEW', reviewStage: 'FINAL' })).toMatchObject({
      status: 'DRAFT',
      reviewStage: null,
      decision: 'RESET',
      stage: 'FINAL',
    });
    expect(resetAfterEdit({ status: 'APPROVED', reviewStage: null })).toMatchObject({
      status: 'DRAFT',
      decision: 'RESET',
    });
  });

  it('leaves drafts and rejected contents alone', () => {
    expect(resetAfterEdit({ status: 'DRAFT', reviewStage: null })).toBeNull();
    expect(resetAfterEdit({ status: 'REJECTED', reviewStage: null })).toBeNull();
  });
});
