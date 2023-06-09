// Auto Generated, do not edit.
import { Read } from "../../stream";
export type PKTSkillStageNotify = {
  SourceId: bigint;
  SkillId: number;
  Stage: number;
};
export function read(buf: Buffer) {
  const reader = new Read(buf);
  const data = {} as PKTSkillStageNotify;
  reader.skip(9);
  data.SourceId = reader.u64();
  data.SkillId = reader.u32();
  reader.skip(32);
  data.Stage = reader.u8();
  return data;
}
export const name = "PKTSkillStageNotify";
export const opcode = 29272;
