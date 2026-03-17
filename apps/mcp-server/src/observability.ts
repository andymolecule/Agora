import { createAgoraLogger } from "@agora/common/server-observability";

export const mcpLogger = createAgoraLogger({ service: "mcp" });
