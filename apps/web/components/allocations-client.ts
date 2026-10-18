import type {
  AllocationGoal,
  AllocationContribution,
  ConfirmDesireAllocationRequest,
  CorrectAllocationRequest,
  DesireAllocationState,
} from '@havefolio/contracts';
import { request } from './desires-client';
export interface AllocationHistoryPage {
  items: AllocationContribution[];
  nextBefore: number | null;
}
export const allocationState = (id: string, signal?: AbortSignal): Promise<DesireAllocationState> =>
  request(`/api/v1/desires/${encodeURIComponent(id)}/allocation`, signal ? { signal } : {});
export const allocationGoals = (
  after?: string,
  signal?: AbortSignal,
): Promise<{ items: AllocationGoal[]; nextAfter: string | null }> =>
  request(
    `/api/v1/goals?limit=25${after ? `&after=${encodeURIComponent(after)}` : ''}`,
    signal ? { signal } : {},
  );
export const confirmAllocation = (
  id: string,
  body: ConfirmDesireAllocationRequest,
): Promise<DesireAllocationState> =>
  request(`/api/v1/desires/${encodeURIComponent(id)}/allocation`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const correctAllocation = (
  id: string,
  body: CorrectAllocationRequest,
): Promise<AllocationContribution> =>
  request(`/api/v1/goals/${encodeURIComponent(id)}/contributions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const allocationHistory = (id: string, before?: number): Promise<AllocationHistoryPage> =>
  request(
    `/api/v1/desires/${encodeURIComponent(id)}/allocation/history${before ? `?before=${before}` : ''}`,
  );
