'use server';

import { revalidatePath } from 'next/cache';
import type { Opportunity, Pipeline, PipelineStage } from '@landcaller/shared';
import { apiSend } from '@/lib/api/server';
import { action, type ActionResult } from '@/lib/api/errors';

/** Server actions for the pipelines module. */

export interface StageInput {
  /** Present for an existing stage; omitted for a new one. Never regenerate these. */
  id?: string;
  name: string;
  order: number;
  color: string;
  probability: number;
}

// ── PIP-04 · Create ─────────────────────────────────────────────────────────

export async function createPipeline(
  accountId: string,
  input: { name: string; stages: StageInput[]; isDefault?: boolean },
): Promise<ActionResult<Pipeline>> {
  return action(async () => {
    const pipeline = await apiSend<Pipeline>('/pipelines', {
      method: 'POST',
      accountId,
      body: input,
    });
    revalidatePath(`/app/${accountId}/pipelines`);
    return pipeline;
  });
}

// ── PIP-05 · Rename and edit stages ─────────────────────────────────────────

export async function updatePipeline(
  accountId: string,
  pipelineId: string,
  input: { name?: string; stages?: StageInput[]; isDefault?: boolean },
): Promise<ActionResult<Pipeline>> {
  return action(async () => {
    const pipeline = await apiSend<Pipeline>(`/pipelines/${pipelineId}`, {
      method: 'PATCH',
      accountId,
      body: input,
    });
    revalidatePath(`/app/${accountId}/pipelines`);
    return pipeline;
  });
}

// ── PIP-06 · Delete ─────────────────────────────────────────────────────────

export async function deletePipeline(
  accountId: string,
  pipelineId: string,
): Promise<ActionResult<void>> {
  return action(async () => {
    await apiSend<void>(`/pipelines/${pipelineId}`, { method: 'DELETE', accountId });
    revalidatePath(`/app/${accountId}/pipelines`);
  });
}

// ── PIP-02 · Move a card ────────────────────────────────────────────────────

/**
 * Persist a drag.
 *
 * The board applies the move optimistically and reverts on failure, so this returns the
 * error rather than throwing — a rejected move must put the card back, not blank the page.
 */
export async function moveOpportunity(
  accountId: string,
  opportunityId: string,
  input: { stageId: string; order?: number },
): Promise<ActionResult<Opportunity>> {
  return action(async () => {
    const opportunity = await apiSend<Opportunity>(
      `/pipelines/opportunities/${opportunityId}/move`,
      { method: 'PATCH', accountId, body: input },
    );
    // No revalidate: the board already shows the new position, and re-rendering mid-drag
    // would fight the optimistic update.
    return opportunity;
  });
}

// ── PIP-07 · Create an opportunity ──────────────────────────────────────────

export async function createOpportunity(
  accountId: string,
  input: {
    pipelineId: string;
    stageId: string;
    contactId: string;
    name: string;
    value: number;
    expectedCloseDate?: string;
  },
): Promise<ActionResult<Opportunity>> {
  return action(async () => {
    const opportunity = await apiSend<Opportunity>('/pipelines/opportunities', {
      method: 'POST',
      accountId,
      body: input,
    });
    revalidatePath(`/app/${accountId}/pipelines`);
    return opportunity;
  });
}

// ── PIP-08 · Edit, win, lose ────────────────────────────────────────────────

export async function updateOpportunity(
  accountId: string,
  opportunityId: string,
  input: { name?: string; value?: number; status?: string; lostReason?: string },
): Promise<ActionResult<Opportunity>> {
  return action(async () => {
    const opportunity = await apiSend<Opportunity>(`/pipelines/opportunities/${opportunityId}`, {
      method: 'PATCH',
      accountId,
      body: input,
    });
    revalidatePath(`/app/${accountId}/pipelines`);
    return opportunity;
  });
}

export async function deleteOpportunity(
  accountId: string,
  opportunityId: string,
): Promise<ActionResult<void>> {
  return action(async () => {
    await apiSend<void>(`/pipelines/opportunities/${opportunityId}`, {
      method: 'DELETE',
      accountId,
    });
    revalidatePath(`/app/${accountId}/pipelines`);
  });
}

export type { Pipeline, PipelineStage };
