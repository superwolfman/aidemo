import { request } from '../api/client';

export type ApprovalAction = 'confirm' | 'revise' | 'reject';

export async function reviewApproval(approvalId: string, action: ApprovalAction, revision: string, note: string) {
    return request(`/api/copilot/approvals/${approvalId}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ revision, note: action })
    });
}