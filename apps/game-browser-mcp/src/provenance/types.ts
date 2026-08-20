import type { RepositoryRef } from '../contracts.js';

export interface VerifiedDeployment {
  deploymentId: string;
  deploymentUrl: string;
  projectId: string;
  repository: RepositoryRef;
  commitSha: string;
}

export interface DeploymentVerifier {
  verify(input: {
    deploymentId: string;
    expectedCommitSha: string;
    repository: RepositoryRef;
    projectId: string;
  }): Promise<VerifiedDeployment>;
}
