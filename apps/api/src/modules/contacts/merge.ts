import mongoose from 'mongoose';
import { badRequest, notFound } from '../../core/errors';
import { Activity, Appointment, Contact, EmailMessage, Opportunity, Task } from '../../models';
import { parcelFields } from './derive';
import { reconcileDnc } from './dnc';
import { recordActivity } from './history';

/**
 * Fold one contact into another.
 *
 * Two records for the same owner is the commonest flaw in a list that has been imported
 * from three vendors. Merging keeps the survivor, takes whichever single-valued fields the
 * caller chose from the duplicate, unions everything that is a set (tags, alternate phones,
 * parcels, list membership), moves every record that pointed at the duplicate — history,
 * opportunities, tasks, appointments, email — and removes the duplicate. All or nothing.
 *
 * Do-not-contact is the one field that is not a choice: if either record says so, the
 * survivor does.
 */
export const MERGEABLE_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'company',
  'source',
  'ownerId',
  'address',
  'customFields',
] as const;

export type MergeableField = (typeof MERGEABLE_FIELDS)[number];

export interface MergeInput {
  survivorId: string;
  duplicateId: string;
  /** Fields whose value should come from the duplicate; everything else stays as the survivor has it. */
  take: MergeableField[];
  userId: string;
}

export async function mergeContacts(input: MergeInput) {
  if (input.survivorId === input.duplicateId) throw badRequest('A contact cannot be merged into itself');

  const [survivor, duplicate] = await Promise.all([
    Contact.findById(input.survivorId),
    Contact.findById(input.duplicateId),
  ]);
  if (!survivor) throw notFound('Contact');
  if (!duplicate) throw notFound('Duplicate contact');

  const unknown = input.take.filter((f) => !(MERGEABLE_FIELDS as readonly string[]).includes(f));
  if (unknown.length > 0) throw badRequest(`Cannot merge field: ${unknown.join(', ')}`);

  for (const field of input.take) {
    if (field === 'customFields') {
      survivor.set('customFields', { ...(survivor.customFields ?? {}), ...(duplicate.customFields ?? {}) });
    } else if (field === 'address') {
      survivor.set('address', duplicate.address);
    } else {
      survivor.set(field, duplicate.get(field));
    }
  }

  // Sets are unioned whatever was chosen: nothing known about the person is thrown away.
  const union = (a: (string | null | undefined)[] = [], b: (string | null | undefined)[] = []) =>
    [...new Set([...a, ...b].filter((v): v is string => Boolean(v)))];

  survivor.set('tags', union(survivor.tags, duplicate.tags));
  survivor.set('listIds', union(survivor.listIds, duplicate.listIds));

  // The duplicate's phone, when not taken as the primary, is still a number for this person.
  const phonesToKeep = union(survivor.altPhones, duplicate.altPhones);
  if (duplicate.phone && duplicate.phone !== survivor.phone && !phonesToKeep.includes(duplicate.phone)) {
    phonesToKeep.push(duplicate.phone);
  }
  survivor.set('altPhones', phonesToKeep.filter((p) => p !== survivor.phone));

  // Parcels: add any the survivor does not already hold, judged by APN (or by all fields
  // when there is no APN). The survivor's primary stays primary.
  const known = new Set(survivor.properties.map((p) => parcelKey(p)));
  for (const parcel of duplicate.properties) {
    const key = parcelKey(parcel);
    if (known.has(key)) continue;
    survivor.properties.push({ ...parcelFields(parcel), isPrimary: false } as never);
    known.add(key);
  }

  // Custom field values the survivor lacks are filled from the duplicate even when the
  // field was not "taken" — absence is not a choice.
  const merged = { ...(duplicate.customFields ?? {}), ...(survivor.customFields ?? {}) };
  survivor.set('customFields', merged);

  if (survivor.dnc || duplicate.dnc || survivor.status === 'do_not_call' || duplicate.status === 'do_not_call') {
    survivor.set(reconcileDnc({ dnc: true }, { dnc: true }));
  }

  const latest = [survivor.lastActivityAt, duplicate.lastActivityAt]
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (latest) survivor.lastActivityAt = latest;

  const duplicateName = `${duplicate.firstName} ${duplicate.lastName}`.trim();
  const survivorId = String(survivor._id);
  const duplicateId = String(duplicate._id);

  await mongoose.connection.transaction(async (session) => {
    const move = { $set: { contactId: survivorId } };
    await Activity.updateMany({ contactId: duplicateId }, move, { session });
    await Opportunity.updateMany({ contactId: duplicateId }, move, { session });
    await Task.updateMany({ contactId: duplicateId }, move, { session });
    await Appointment.updateMany({ contactId: duplicateId }, move, { session });
    await EmailMessage.updateMany({ contactId: duplicateId }, move, { session });

    await survivor.save({ session });
    await Contact.deleteOne({ _id: duplicate._id }, { session });

    await recordActivity(
      {
        type: 'merge',
        contactId: survivorId,
        userId: input.userId,
        title: `Merged in ${duplicateName}`,
        body:
          input.take.length > 0
            ? `Took ${input.take.join(', ')} from the duplicate; everything else kept.`
            : 'Kept every value; the duplicate only added what was missing.',
        metadata: { mergedId: duplicateId, mergedName: duplicateName, fieldsTaken: input.take },
      },
      session,
    );
  });

  return survivor;
}

function parcelKey(parcel: { apn?: string | null; county?: string | null; state?: string | null; acres?: number | null }): string {
  const apn = parcel.apn?.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (apn) return `apn:${apn}`;
  return `loc:${parcel.county ?? ''}|${parcel.state ?? ''}|${parcel.acres ?? ''}`.toLowerCase();
}
