'use server';

import { revalidatePath } from 'next/cache';
import type { Appointment, Task } from '@/shared';
import { apiSend } from '@/lib/api/server';
import { action, type ActionResult } from '@/lib/api/errors';

/** Server actions for tasks and appointments (CNT-35, CNT-36). */

function touch(accountId: string, contactId?: string) {
  revalidatePath(`/app/${accountId}/contacts/tasks`);
  revalidatePath(`/app/${accountId}/contacts/appointments`);
  if (contactId) revalidatePath(`/app/${accountId}/contacts/${contactId}`);
}

// ── Tasks ───────────────────────────────────────────────────────────────────

export interface TaskInput {
  title: string;
  description?: string;
  contactId?: string;
  assigneeId?: string;
  dueAt?: string;
  priority?: 'low' | 'normal' | 'high';
}

export async function createTask(accountId: string, input: TaskInput): Promise<ActionResult<Task>> {
  return action(async () => {
    const task = await apiSend<Task>('/contacts/tasks', { method: 'POST', accountId, body: input });
    touch(accountId, input.contactId);
    return task;
  });
}

export async function updateTask(
  accountId: string,
  taskId: string,
  input: Partial<TaskInput> & { status?: 'open' | 'done' },
  contactId?: string,
): Promise<ActionResult<Task>> {
  return action(async () => {
    const task = await apiSend<Task>(`/contacts/tasks/${taskId}`, { method: 'PATCH', accountId, body: input });
    touch(accountId, contactId ?? task.contactId);
    return task;
  });
}

export async function deleteTask(accountId: string, taskId: string, contactId?: string): Promise<ActionResult<void>> {
  return action(async () => {
    await apiSend<void>(`/contacts/tasks/${taskId}`, { method: 'DELETE', accountId });
    touch(accountId, contactId);
  });
}

// ── Appointments ────────────────────────────────────────────────────────────

export interface AppointmentInput {
  contactId: string;
  userId?: string;
  title: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  notes?: string;
}

export async function createAppointment(accountId: string, input: AppointmentInput): Promise<ActionResult<Appointment>> {
  return action(async () => {
    const appointment = await apiSend<Appointment>('/contacts/appointments', { method: 'POST', accountId, body: input });
    touch(accountId, input.contactId);
    return appointment;
  });
}

export async function updateAppointment(
  accountId: string,
  appointmentId: string,
  input: Partial<Omit<AppointmentInput, 'contactId'>> & { outcome?: Appointment['outcome'] },
  contactId?: string,
): Promise<ActionResult<Appointment>> {
  return action(async () => {
    const appointment = await apiSend<Appointment>(`/contacts/appointments/${appointmentId}`, {
      method: 'PATCH',
      accountId,
      body: input,
    });
    touch(accountId, contactId ?? appointment.contactId);
    return appointment;
  });
}

export async function deleteAppointment(accountId: string, appointmentId: string, contactId?: string): Promise<ActionResult<void>> {
  return action(async () => {
    await apiSend<void>(`/contacts/appointments/${appointmentId}`, { method: 'DELETE', accountId });
    touch(accountId, contactId);
  });
}
