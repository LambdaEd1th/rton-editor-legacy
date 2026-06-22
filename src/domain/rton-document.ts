import type { Stats } from './rton-value-analysis';
import type { RtonValuePath } from './rton-value-editing';
import type { RtonValue } from './rton-value';

export const RTON_LARGE_DOCUMENT_THRESHOLD_BYTES = 2 * 1024 * 1024;
export const RTON_REMOTE_CHILD_PAGE_SIZE = 160;

export type RemoteRtonValueNode = {
  label: string;
  kind: RtonValue['kind'];
  preview: string;
  childCount: number;
  path: RtonValuePath;
};

export type RtonDocumentRef = {
  id: number;
  root: RemoteRtonValueNode;
  stats: Stats;
  byteLength: number;
};
