import type { AgoraLogger } from "@agora/common/server-observability";

export interface ApiEnv {
  Variables: {
    sessionAddress: `0x${string}`;
    requestId: string;
    logger: AgoraLogger;
  };
}
