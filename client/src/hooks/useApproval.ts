import { useCallback, useState } from 'react';
import * as approvalService from '../services/approvalService';

export function useApproval() {
    const [approval, setApproval] = useState<any>(null);
    const [approvalHistory, setApprovalHistory] = useState<any[]>([]);
    const [draftRevision, setDraftRevision] = useState('');

    const review = useCallback(async (action: 'confirm' | 'revise' | 'reject', revision: string, note: string) => {
        if (!approval) return;
        const result = await approvalService.reviewApproval(approval._id, action, revision, note);
        setApproval(result.approval);
        setApprovalHistory((items) => [result.approval, ...items.filter((item: any) => item._id !== result.approval._id)].slice(0, 5));
        return result.approval;
    }, [approval]);

    const receive = useCallback((payload: any) => {
        setApproval(payload.approval);
        setDraftRevision(payload.approval.documentDraft || '');
    }, []);

    return { approval, setApproval, approvalHistory, setApprovalHistory, draftRevision, setDraftRevision, review, receive };
}