// Auto Generated, do not edit.
import type { Read } from "../../stream";
import * as TripodLevel from "../../common/TripodLevel";
import * as TripodIndex from "../../common/TripodIndex";
export type ProjectileInfo = {  
  OwnerId: bigint;
  ProjectileId: bigint;
  SkillEffect: number;
  SkillId: number;
  tripodIndex: TripodIndex.TripodIndex;
  tripodLevel: TripodLevel.TripodLevel; 
  SkillLevel: number;
};
export function read(reader: Read) {
  const data = {} as ProjectileInfo;
  reader.u64();
  reader.u16();
  reader.u16();
  data.ProjectileId = reader.u64();
  data.OwnerId = reader.u64();
  reader.u32();
  if(reader.bool()) {
    let num = reader.u16()
    for(var i = 0; i < num; i++) reader.bool();
  }
  data.SkillId = reader.u32();
  data.tripodLevel = TripodLevel.read(reader);
  data.tripodIndex = TripodIndex.read(reader);
  reader.u32();
  data.SkillLevel = reader.u8();
  reader.u64();
  reader.bool();
  if(reader.bool()) reader.u32();
  reader.u8();
  reader.u32();
  data.SkillEffect = reader.u32();
  reader.u64();
  reader.u32();
  if(reader.bool()) reader.u64();
  return data;
}
