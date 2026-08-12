import { ROLES } from './roles.js';

export function capabilitiesForRole (role) {
    const restrictedDemo = String(role) === ROLES.DEMO_VIEWER;
    const canManageRuntimeModels = [ROLES.ADMIN, ROLES.OWNER].includes(String(role));
    return {
        mode: restrictedDemo ? 'restricted-demo' : 'standard',
        canCreateRun: true,
        canEditArtifacts: !restrictedDemo,
        canReviewArtifacts: !restrictedDemo,
        canExportArtifacts: !restrictedDemo,
        canScoreEval: !restrictedDemo,
        canSwitchTenant: !restrictedDemo,
        canControlRuns: !restrictedDemo,
        canReplayRuns: !restrictedDemo,
        canReviewRuns: !restrictedDemo,
        canManageRuntimeModels
    };
}
