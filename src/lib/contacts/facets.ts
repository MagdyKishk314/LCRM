import type { CustomFieldDef } from '@/shared';

/** What `GET /contacts/facets` returns: the choices every filter and picker is built from. */
export interface Facets {
  states: string[];
  counties: string[];
  tags: string[];
  sources: string[];
  owners: { id: string; name: string; email: string }[];
  fields: Pick<CustomFieldDef, 'key' | 'label' | 'type' | 'options' | 'required'>[];
}

export const EMPTY_FACETS: Facets = { states: [], counties: [], tags: [], sources: [], owners: [], fields: [] };
