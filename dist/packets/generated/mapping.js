"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name41 in all)
    __defProp(target, name41, { get: all[name41], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/packets/generated/mapping.ts
var mapping_exports = {};
__export(mapping_exports, {
  mapping: () => mapping
});
module.exports = __toCommonJS(mapping_exports);

// src/packets/stream.ts
var Read = class {
  b;
  o;
  constructor(buf) {
    this.b = buf;
    this.o = 0;
  }
  skip(length = 0) {
    this.o += length;
  }
  bool() {
    return this.u8() === 1;
  }
  u8() {
    return this.b.readUint8(this.o++);
  }
  i8() {
    return this.b.readInt8(this.o++);
  }
  u16() {
    const value = this.b.readUint16LE(this.o);
    this.o += 2;
    return value;
  }
  i16() {
    const value = this.b.readInt16LE(this.o);
    this.o += 2;
    return value;
  }
  u32() {
    const value = this.b.readUint32LE(this.o);
    this.o += 4;
    return value;
  }
  i32() {
    const value = this.b.readInt32LE(this.o);
    this.o += 4;
    return value;
  }
  f32() {
    const value = this.b.readFloatLE(this.o);
    this.o += 4;
    return value;
  }
  u64() {
    const value = this.b.readBigUint64LE(this.o);
    this.o += 8;
    return value;
  }
  i64() {
    const value = this.b.readBigInt64LE(this.o);
    this.o += 8;
    return value;
  }
  string(maxLength) {
    let length = this.u16();
    if (length <= maxLength) {
      length = length * 2;
      const value = this.b.toString("utf16le", this.o, this.o + length);
      this.o += length;
      return value;
    }
    return "";
  }
  bytes(length = 0, maxLength, multiplier) {
    if (maxLength && length > maxLength)
      return Buffer.alloc(0);
    if (multiplier)
      length = length * multiplier;
    const value = Buffer.from(this.b.subarray(this.o, this.o + length));
    this.o += length;
    return value;
  }
  array(length, callbackfn, maxLength) {
    if (maxLength && length > maxLength)
      return [];
    return new Array(length).fill(void 0).map(callbackfn);
  }
};

// src/packets/common/ReadNBytesInt64.ts
function bytesToInt64(value) {
  if (value.length === 0)
    return 0n;
  if (value.length > 8)
    throw new Error("Value is too large");
  const buf = Buffer.alloc(8);
  value.copy(buf);
  return buf.readBigInt64LE();
}
function read4(reader) {
  const flag = reader.u8();
  const bytes = reader.bytes(flag >> 1 & 7);
  const result = bytesToInt64(bytes) << 4n | BigInt(flag >> 4);
  return (flag & 1) === 0 ? result : -result;
}

// src/packets/common/Vector3F.ts
function i21(n) {
  if (n >> 20 === 1)
    return -((~n >>> 0) + 1 & 2097151);
  return n;
}
function read9(reader) {
  let b = reader.u64();
  return {
    x: i21(Number(b & 0x1fffffn)),
    y: i21(Number(b >> 21n & 0x1fffffn)),
    z: i21(Number(b >> 42n & 0x1fffffn))
  };
}

// src/packets/common/TripodLevel.ts
function read15(reader) {
  return {
    first: reader.u16(),
    second: reader.u16(),
    third: reader.u16()
  };
}

// src/packets/common/TripodIndex.ts
function read16(reader) {
  return {
    first: reader.u8(),
    second: reader.u8(),
    third: reader.u8()
  };
}

// src/packets/generated/structures/ProjectileInfo.ts
function read17(reader) {
  const data = {};
  reader.bool();
  if (reader.bool())
    reader.u32();
  data.ProjectileId = reader.u64();
  reader.u16();
  reader.u32();
  data.SkillId = reader.u32();
  reader.u64();
  reader.bool();
  data.OwnerId = reader.u64();
  data.tripodIndex = read16(reader);
  reader.u64();
  reader.u32();
  if (reader.bool()) {
    let num = reader.u16();
    for (var i = 0; i < num; i++)
      reader.bool();
  }
  data.tripodLevel = read15(reader);
  reader.u32();
  if (reader.bool())
    reader.u64();
  reader.u32();
  reader.u8();
  reader.u16();
  data.SkillLevel = reader.u8();
  data.SkillEffect = reader.u32();
  reader.u64();
  return data;
}

// src/packets/generated/definitions/PKTNewProjectile.ts
function read18(buf) {
  const reader = new Read(buf);
  const data = {};
  data.projectileInfo = read17(reader);
  return data;
}
var name = "PKTNewProjectile";
var opcode = 21242;

// src/packets/common/SkillMoveOptionData.ts
function read21(reader) {
  const data = {};
  const flag = reader.u8();
  if (flag & 1)
    data.MoveTime = reader.u32();
  if (flag & 2)
    data.StandUpTime = reader.u32();
  if (flag & 4)
    data.DownTime = reader.u32();
  if (flag & 8)
    data.FreezeTime = reader.u32();
  if (flag & 16)
    data.MoveHeight = reader.u32();
  if (flag & 32)
    data.FarmostDist = reader.u32();
  if (flag & 64)
    data.flag40 = reader.bytes(reader.u16(), 6);
  return data;
}

// src/packets/generated/structures/SkillDamageEvent.ts
function read22(reader) {
  const data = {};
  if (reader.bool())
    data.DamageAttr = reader.u8();
  data.TargetId = reader.u64();
  data.Unk3_m = reader.i16();
  data.Damage = read4(reader);
  data.DamageType = reader.u8();
  data.CurHp = read4(reader);
  data.Modifier = reader.u8();
  data.MaxHp = read4(reader);
  return data;
}

// src/packets/generated/structures/SkillDamageAbnormalMoveEvent.ts
function read23(reader) {
  const data = {};
  data.Unk2_m = reader.u64();
  data.SkillMoveOptionData = read21(reader);
  data.Unk8_m = reader.u16();
  data.skillDamageEvent = read22(reader);
  data.Unk2_m = reader.u64();
  data.Unk3_m = reader.u16();
  data.Destination = read9(reader);
  data.Unk1_m = reader.u8();
  data.Unk4_m = reader.u16();
  return data;
}

// src/packets/generated/definitions/PKTSkillDamageAbnormalMoveNotify.ts
function read24(buf) {
  const reader = new Read(buf);
  const data = {};
  data.SourceId = reader.u64();
  data.SkillEffectId = reader.u32();
  data.SkillId = reader.u32();
  data.Unk1_m = reader.u8();
  data.SkillDamageAbnormalMoveEvents = reader.array(reader.u16(), () => read23(reader), 50);
  data.Unk2_m = reader.u32();
  return data;
}
var name2 = "PKTSkillDamageAbnormalMoveNotify";
var opcode2 = 45692;

// src/packets/generated/definitions/PKTSkillDamageNotify.ts
function read25(buf) {
  const reader = new Read(buf);
  const data = {};
  data.SourceId = reader.u64();
  data.SkillId = reader.u32();
  data.SkillLevel = reader.u8();
  data.SkillEffectId = reader.u32();
  data.SkillDamageEvents = reader.array(reader.u16(), () => read22(reader), 50);
  return data;
}
var name3 = "PKTSkillDamageNotify";
var opcode3 = 30050;

// src/packets/generated/mapping.ts
var mapping = /* @__PURE__ */ new Map([
  [opcode, [name, read18]],
  [
    opcode2,
    [name2, read24]
  ],
  [opcode3, [name3, read25]]
]);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  mapping
});
