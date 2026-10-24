import {
  claimGuestWorkspaceMemory,
  MemoryDatasetRepository,
  MemoryJobRepository,
  MemorySelectionRepository,
  MemoryShareRepository,
  MemorySourceRepository,
  MemoryState,
} from "./memory";
import { runRepositoryContract } from "./repository-contract";

runRepositoryContract("memory", async () => {
  const s = new MemoryState();
  return {
    repos: {
      sources: new MemorySourceRepository(s),
      selections: new MemorySelectionRepository(s),
      datasets: new MemoryDatasetRepository(s),
      jobs: new MemoryJobRepository(s),
      shares: new MemoryShareRepository(s),
      claim: async (g, a) => claimGuestWorkspaceMemory(s, g, a),
    },
    cleanup: async () => undefined,
  };
});
