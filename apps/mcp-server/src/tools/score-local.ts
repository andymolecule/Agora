import { scoreLocal } from "./shared.js";

export async function agoraScoreLocal(input: {
  challengeId: string;
  filePath: string;
}) {
  return scoreLocal(input);
}
