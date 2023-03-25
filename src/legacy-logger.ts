import { createHash } from "crypto";
import { TypedEmitter } from "tiny-typed-emitter";
import type { MeterData } from "./data";
import { hitflag, stattype, triggersignaltype } from "./packets/generated/enums";
import { PartyTracker } from "./partytracker";
import { PCIdMapper } from "./pcidmapper";
import type { PKTStream } from "./pkt-stream";
import { StatusEffect, StatusEffecType, StatusTracker } from "./statustracker";

export const enum LineId {
  InitEnv = 1,
  PhaseTransition = 2,
  NewPC = 3,
  NewNpc = 4,
  Death = 5,
  SkillStart = 6,
  SkillStage = 7,
  Damage = 8,
  Heal = 9,
  Buff = 10,
  BuffRemove = 11,
  CounterAttack = 12,
  Line15 = 15, // TODO: rename
  Debug = 251,
  PacketDump = 252,
  Version = 253,
  Error = 254,
}

interface LegacyLoggerEvents {
  line: (line: string) => void;
  [LineId.InitEnv]: (playerId: bigint) => void;
  [LineId.PhaseTransition]: (phaseCode: number) => void;
  [LineId.NewPC]: (
    id: bigint,
    name: string,
    classId: number,
    className: string,
    level: number,
    gearLevel: number,
    currentHp: number,
    maxHp: number,
    characterId: bigint
  ) => void;
  [LineId.NewNpc]: (id: bigint, npcId: number, name: string, currentHp: number, maxHp: number) => void;
  [LineId.Death]: (id: bigint, name: string, killerId: bigint, killerName: string) => void;
  [LineId.SkillStart]: (id: bigint, name: string, skillId: number, skillName: string) => void;
  [LineId.SkillStage]: (id: bigint, name: string, skillId: number, skillName: string, skillStage: number) => void;
  [LineId.Damage]: (
    id: bigint,
    name: string,
    skillId: number,
    skillName: string,
    skillEffectId: number,
    skillEffect: string,
    targetId: bigint,
    targetName: string,
    damage: number,
    modifier: string,
    currentHp: number,
    maxHp: number,
    effectsOnTarget: (number | bigint)[][],
    effectsOnSource: (number | bigint)[][]
  ) => void;
  [LineId.Heal]: (id: bigint, name: string, healAmount: number, currentHp: number) => void;
  [LineId.Buff]: (
    id: bigint,
    name: string,
    buffId: number,
    buffName: string,
    sourceId: bigint,
    sourceName: string,
    shieldAmount: number
  ) => void;
  [LineId.BuffRemove]: (statusId: bigint, statusName: string, targetId: bigint, targetName: string) => void;
  [LineId.CounterAttack]: (id: bigint, name: string, targetId: bigint, targetName: string) => void;
  [LineId.Line15]: () => void;
}

export type LegacyLoggerSettings = {
  emitText?: boolean;
  emitLines?: boolean;
  emitObjects?: boolean;
};

export class LegacyLogger extends TypedEmitter<LegacyLoggerEvents> {
  #data: MeterData;
  emitText: boolean;
  emitLines: boolean;
  emitObjects: boolean;

  #encounters: Set<Encounter>;
  #currentEncounter: Encounter;
  #wasWipe: boolean;
  #wasKill: boolean;

  #localPlayer: Player;

  constructor(stream: PKTStream, data: MeterData, settings: LegacyLoggerSettings = {}) {
    super();
    this.#data = data;

    this.emitText = settings.emitText || true;
    this.emitLines = settings.emitLines || true;
    this.emitObjects = settings.emitObjects || false;

    this.#encounters = new Set();
    this.#currentEncounter = new Encounter();
    this.#wasWipe = false;
    this.#wasKill = false;

    this.#localPlayer = {
      entityId: 0n,
      entityType: EntityType.Player,
      name: "You",
      class: 0,
      gearLevel: 0,
      characterId: 0n,
    };

    stream
      .on("PKTAuthTokenResult", (pkt) => {})
      .on("PKTCounterAttackNotify", (pkt) => {
        if (this.#needEmit) {
          const parsed = pkt.parsed;
          if (!parsed) return;
          this.#buildLine(
            LineId.CounterAttack,
            parsed.SourceId,
            this.#getEntityName(parsed.SourceId),
            parsed.TargetId,
            this.#getEntityName(parsed.TargetId)
          );
        }
      })
      .on("PKTDeathNotify", (pkt) => {
        const parsed = pkt.parsed;
        if (!parsed) return;
        if (PartyTracker.getInstance().isEntityInParty(parsed.TargetId)) {
          let p = this.#currentEncounter.entities.get(parsed.TargetId);
          if (p?.name == this.#localPlayer.name) {
            StatusTracker.getInstance().RemoveLocalObject(parsed.TargetId);
          } else {
            let charId = PCIdMapper.getInstance().getCharacterId(parsed.TargetId);
            if (charId) StatusTracker.getInstance().RemovePartyObject(charId);
          }
        } else {
          StatusTracker.getInstance().RemoveLocalObject(parsed.TargetId);
        }
        if (this.#needEmit) {
          this.#buildLine(
            LineId.Death,
            parsed.TargetId,
            this.#getEntityName(parsed.TargetId),
            parsed.SourceId,
            this.#getEntityName(parsed.SourceId)
          );
        }
      })
      .on("PKTInitEnv", (pkt) => {
        const parsed = pkt.parsed;
        if (!parsed) return;
        this.#currentEncounter = new Encounter();
        const player: Player = {
          entityId: parsed.PlayerId,
          entityType: EntityType.Player,
          name: this.#localPlayer.name,
          class: this.#localPlayer.class,
          gearLevel: this.#localPlayer.gearLevel,
          characterId: this.#localPlayer.characterId,
        };
        this.#localPlayer = player;
        this.#currentEncounter.entities.set(player.entityId, player);
        PCIdMapper.getInstance().clear();
        StatusTracker.getInstance().Clear();
        if (player.characterId != 0n) PCIdMapper.getInstance().addMapping(player.characterId, player.entityId);
        if (this.#localPlayer && this.#localPlayer.characterId && this.#localPlayer.characterId > 0n)
          PartyTracker.getInstance().completeEntry(this.#localPlayer.characterId, parsed.PlayerId);
        // console.log("PKTInitEnv", this.#localPlayer);
        if (this.#needEmit) this.#buildLine(LineId.InitEnv, player.entityId);
      })
      .on("PKTInitPC", (pkt) => {
        const parsed = pkt.parsed;
        if (!parsed) return;
        this.#currentEncounter = new Encounter();
        const player: Player = {
          entityId: parsed.PlayerId,
          entityType: EntityType.Player,
          name: parsed.Name,
          class: parsed.ClassId,
          gearLevel: this.#u32tof32(parsed.GearLevel),
          characterId: parsed.CharacterId,
        };
        this.#localPlayer = player;
        // console.log("PKTInitPC", this.#localPlayer);
        this.#currentEncounter.entities.set(player.entityId, player);
        PCIdMapper.getInstance().addMapping(player.characterId, player.entityId);
        PartyTracker.getInstance().completeEntry(player.characterId, parsed.PlayerId);
        for (let se of parsed.statusEffectDatas) {
          const val: number = se.Value ? se.Value.readUInt32LE() : 0;
          StatusTracker.getInstance().RegisterStatusEffect({
            instanceId: se.EffectInstanceId,
            sourceId: se.SourceId,
            started: new Date(),
            statusEffectId: se.StatusEffectId,
            targetId: parsed.PlayerId,
            type: StatusEffecType.Local,
            value: val,
          });
        }

        if (this.#needEmit) {
          const statsMap = this.#getStatPairMap(pkt.parsed.statPair);
          this.#buildLine(
            LineId.NewPC,
            player.entityId,
            player.name,
            player.class,
            this.#data.getClassName(player.class),
            parsed.Level,
            player.gearLevel,
            Number(statsMap.get(stattype.hp)) || 0,
            Number(statsMap.get(stattype.max_hp)) || 0,
            player.characterId
          );
        }
      })
      .on("PKTNewNpc", (pkt) => {
        const parsed = pkt.parsed;
        if (!parsed) return;
        const npc: Npc = {
          entityId: parsed.NpcStruct.ObjectId,
          entityType: EntityType.Npc,
          name: this.#data.getNpcName(parsed.NpcStruct.TypeId),
          typeId: parsed.NpcStruct.TypeId,
        };
        this.#currentEncounter.entities.set(npc.entityId, npc);
        if (this.#needEmit) {
          const statsMap = this.#getStatPairMap(pkt.parsed.NpcStruct.statPair);
          this.#buildLine(
            LineId.NewNpc,
            npc.entityId,
            npc.typeId,
            npc.name,
            Number(statsMap.get(stattype.hp)) || 0,
            Number(statsMap.get(stattype.max_hp)) || 0
          );
        }
      })
      .on("PKTNewNpcSummon", (pkt) => {
        const parsed = pkt.parsed;
        if (!parsed) return;
        const summon: Summon = {
          entityId: parsed.NpcData.ObjectId,
          entityType: EntityType.Summon,
          name: parsed.NpcData.ObjectId.toString(16),
          ownerId: parsed.OwnerId,
        };
        this.#currentEncounter.entities.set(summon.entityId, summon);
      })
      .on("PKTNewPC", (pkt) => {
        const parsed = pkt.parsed;
        if (!parsed) return;
        const player: Player = {
          entityId: parsed.PCStruct.PlayerId,
          entityType: EntityType.Player,
          name: parsed.PCStruct.Name,
          class: parsed.PCStruct.ClassId,
          gearLevel: this.#u32tof32(parsed.PCStruct.GearLevel),
          characterId: parsed.PCStruct.CharacterId,
        };
        this.#currentEncounter.entities.set(player.entityId, player);
        PCIdMapper.getInstance().addMapping(player.characterId, player.entityId);
        PartyTracker.getInstance().completeEntry(player.characterId, player.entityId);
        for (let se of parsed.PCStruct.statusEffectDatas) {
          const val: number = se.Value ? se.Value.readUInt32LE() : 0;
          StatusTracker.getInstance().RegisterStatusEffect({
            instanceId: se.EffectInstanceId,
            sourceId: se.SourceId,
            started: new Date(),
            statusEffectId: se.StatusEffectId,
            targetId: parsed.PCStruct.PlayerId,
            type: StatusEffecType.Local,
            value: val,
          });
        }
        if (this.#needEmit) {
          const statsMap = this.#getStatPairMap(pkt.parsed.PCStruct.statPair);
          this.#buildLine(
            LineId.NewPC,
            player.entityId,
            player.name,
            player.class,
            this.#data.getClassName(player.class),
            parsed.PCStruct.Level,
            player.gearLevel,
            Number(statsMap.get(stattype.hp)) || 0,
            Number(statsMap.get(stattype.max_hp)) || 0,
            player.characterId
          );
        }
      })
      .on("PKTNewProjectile", (pkt) => {
        const parsed = pkt.parsed;
        if (!parsed) return;
        const projectile: Projectile = {
          entityId: parsed.projectileInfo.ProjectileId,
          entityType: EntityType.Projectile,
          name: parsed.projectileInfo.ProjectileId.toString(16),
          ownerId: parsed.projectileInfo.OwnerId,
          skillEffectId: parsed.projectileInfo.SkillEffect,
          skillId: parsed.projectileInfo.SkillId,
        };
        this.#currentEncounter.entities.set(projectile.entityId, projectile);
      })
      .on("PKTParalyzationStateNotify", (pkt) => {})
      .on("PKTPartyInfo", (pkt) => {
        const parsed = pkt.parsed;
        if (!parsed) return;
        // this means the party is collapsing because you are the only one left
        if (parsed.MemberDatas.length == 1 && parsed.MemberDatas[0]?.Name === this.#localPlayer.name) {
          PartyTracker.getInstance().remove(parsed.PartyInstanceId, parsed.MemberDatas[0].Name);
          return;
        }
        PartyTracker.getInstance().removePartyMappings(parsed.PartyInstanceId);
        for (const pm of parsed.MemberDatas) {
          PartyTracker.getInstance().add(pm.CharacterId, undefined, parsed.PartyInstanceId, parsed.RaidInstanceId);
        }
      })
      .on("PKTPartyLeaveResult", (pkt) => {
        const parsed = pkt.parsed;
        if (!parsed) return;
        PartyTracker.getInstance().remove(parsed.PartyInstanceId, parsed.Name);
      })
      .on("PKTPartyStatusEffectAddNotify", (pkt) => {
        const parsed = pkt.parsed;
        if (!parsed) return;
        for (const effect of parsed.statusEffectDatas) {
          const sourceId: bigint = parsed.PlayerIdOnRefresh != 0n ? parsed.PlayerIdOnRefresh : effect.SourceId;
          const sourceEnt = this.#getSourceEntity(sourceId);
          const val: number = effect.Value ? effect.Value.readUInt32LE() : 0;
          var se: StatusEffect = {
            instanceId: effect.EffectInstanceId,
            sourceId: sourceEnt.entityId,
            started: new Date(),
            statusEffectId: effect.StatusEffectId,
            targetId: parsed.CharacterId,
            type: StatusEffecType.Party,
            value: val,
          };
          StatusTracker.getInstance().RegisterStatusEffect(se);
        }
      })
      .on("PKTPartyStatusEffectRemoveNotify", (pkt) => {
        const parsed = pkt.parsed;
        if (!parsed) return;
        for (const effectId of parsed.statusEffectIds)
          StatusTracker.getInstance().RemoveStatusEffect(parsed.CharacterId, effectId, StatusEffecType.Party);
      })
      .on("PKTPartyStatusEffectResultNotify", (pkt) => {
        const parsed = pkt.parsed;
        if (!parsed) return;
        PartyTracker.getInstance().add(parsed.CharacterId, undefined, parsed.PartyInstanceId, parsed.RaidInstanceId);
      })
      .on("PKTRaidBossKillNotify", (pkt) => {
        if (this.#needEmit) this.#buildLine(LineId.PhaseTransition, 1);
      })
      .on("PKTRaidResult", (pkt) => {
        if (this.#needEmit) this.#buildLine(LineId.PhaseTransition, 0);
      })
      .on("PKTRemoveObject", (pkt) => {
        const parsed = pkt.parsed;
        if (!parsed) return;
        for (let upo of parsed.unpublishedObjects) StatusTracker.getInstance().RemoveLocalObject(upo.ObjectId);
      })
      .on("PKTSkillDamageAbnormalMoveNotify", (pkt) => {
        if (this.#needEmit) {
          const parsedDmg = pkt.parsed;
          if (!parsedDmg) return;
          let sourceEntity = this.#getSourceEntity(parsedDmg.SourceId);
          let skillName = this.#data.getSkillName(parsedDmg.SkillId);
          sourceEntity = this.#guessIsPlayer(sourceEntity, parsedDmg.SkillId);
          parsedDmg.SkillDamageAbnormalMoveEvents.forEach((event) => {
            if (
              (event.skillDamageEvent.Modifier & 0xf) === hitflag.damage_share &&
              parsedDmg.SkillId === 0 &&
              parsedDmg.SkillEffectId === 0
            )
              return;

            if (
              parsedDmg.SkillId === 0 &&
              parsedDmg.SkillEffectId === 0 &&
              event.skillDamageEvent.Modifier & (hitflag.dot | hitflag.dot_critical)
            )
              skillName = "Bleed";
            var statusEffectsOnTarget = [];
            var statusEffectsOnSource = [];
            if (sourceEntity.entityType === EntityType.Player) {
              const p = sourceEntity as Player;
              const isLocalPlayer = p.name == this.#localPlayer.name;
              var isInParty = PartyTracker.getInstance().isCharacterInParty(p.characterId);
              if (isInParty) {
                const partyId = PartyTracker.getInstance().getPartyIdFromCharacterId(p.characterId);
                if (partyId) {
                  const effect = StatusTracker.getInstance().GetStatusEffects(
                    isLocalPlayer ? p.entityId : p.characterId,
                    isLocalPlayer ? StatusEffecType.Local : StatusEffecType.Party
                  );
                  for (var ef of effect) statusEffectsOnSource.push([ef.statusEffectId, ef.sourceId]);
                  // This is technically bugged since we could be hitting a player in an other party or our own, but for bosses it works like this
                  const tEffects = StatusTracker.getInstance().GetStatusEffectsFromParty(
                    event.skillDamageEvent.TargetId,
                    StatusEffecType.Local,
                    partyId
                  );
                  for (var ef of tEffects) statusEffectsOnTarget.push([ef.statusEffectId, ef.sourceId]);
                }
              } else if (isLocalPlayer) {
                const effect = StatusTracker.getInstance().GetStatusEffects(p.entityId, StatusEffecType.Local);
                for (var ef of effect) statusEffectsOnSource.push([ef.statusEffectId, ef.sourceId]);
                const tEffects = StatusTracker.getInstance().GetStatusEffects(
                  event.skillDamageEvent.TargetId,
                  StatusEffecType.Local
                );
                for (var ef of tEffects) statusEffectsOnTarget.push([ef.statusEffectId, ef.sourceId]);
              }
            }
            // Override skillEffect for battleitems (this way we know the real item used: slendid or not)
            let skillEffectId = parsedDmg.SkillEffectId;
            let skillEffect: string | undefined;
            if (this.#data.isBattleItem(skillEffectId, "attack")) {
              const entity = this.#currentEncounter.entities.get(parsedDmg.SourceId);
              if (entity && entity.entityType === EntityType.Projectile) {
                const proj = entity as Projectile;
                skillEffectId = proj.skillEffectId;
                skillEffect = this.#data.getBattleItemName(skillEffectId);
              }
            }
            skillEffect = skillEffect ?? this.#data.getSkillEffectComment(skillEffectId);
            this.#buildLine(
              LineId.Damage,
              sourceEntity.entityId,
              sourceEntity.name,
              parsedDmg.SkillId,
              skillName,
              skillEffectId,
              skillEffect,
              event.skillDamageEvent.TargetId,
              this.#getEntityName(event.skillDamageEvent.TargetId),
              Number(event.skillDamageEvent.Damage),
              event.skillDamageEvent.Modifier.toString(16),
              Number(event.skillDamageEvent.CurHp),
              Number(event.skillDamageEvent.MaxHp),
              statusEffectsOnTarget,
              statusEffectsOnSource
            );
          });
        }
      })
      .on("PKTSkillDamageNotify", (pkt) => {
        if (this.#needEmit) {
          const parsedDmg = pkt.parsed;
          if (!parsedDmg) return;
          let sourceEntity: Entity = this.#getSourceEntity(parsedDmg.SourceId);
          let skillName = this.#data.getSkillName(parsedDmg.SkillId);
          const skillEffect = this.#data.getSkillEffectComment(parsedDmg.SkillEffectId);
          sourceEntity = this.#guessIsPlayer(sourceEntity, parsedDmg.SkillId);
          parsedDmg.SkillDamageEvents.forEach((event) => {
            if (
              (event.Modifier & 0xf) === hitflag.damage_share &&
              parsedDmg.SkillId === 0 &&
              parsedDmg.SkillEffectId === 0
            )
              return;

            if (
              parsedDmg.SkillId === 0 &&
              parsedDmg.SkillEffectId === 0 &&
              event.Modifier & (hitflag.dot | hitflag.dot_critical)
            )
              skillName = "Bleed";
            var statusEffectsOnTarget = [];
            var statusEffectsOnSource = [];
            if (sourceEntity.entityType === EntityType.Player) {
              const p = sourceEntity as Player;
              const isLocalPlayer = p.name == this.#localPlayer.name;
              var isInParty = PartyTracker.getInstance().isCharacterInParty(p.characterId);
              if (isInParty) {
                const partyId = PartyTracker.getInstance().getPartyIdFromCharacterId(p.characterId);
                if (partyId) {
                  const effect = StatusTracker.getInstance().GetStatusEffects(
                    isLocalPlayer ? p.entityId : p.characterId,
                    isLocalPlayer ? StatusEffecType.Local : StatusEffecType.Party
                  );
                  for (var ef of effect) statusEffectsOnSource.push([ef.statusEffectId, ef.sourceId]);
                  // This is technically bugged since we could be hitting a player in an other party or our own, but for bosses it works like this
                  const tEffects = StatusTracker.getInstance().GetStatusEffectsFromParty(
                    event.TargetId,
                    StatusEffecType.Local,
                    partyId
                  );
                  for (var ef of tEffects) statusEffectsOnTarget.push([ef.statusEffectId, ef.sourceId]);
                }
              } else if (isLocalPlayer) {
                const effect = StatusTracker.getInstance().GetStatusEffects(p.entityId, StatusEffecType.Local);
                for (var ef of effect) statusEffectsOnSource.push([ef.statusEffectId, ef.sourceId]);
                const tEffects = StatusTracker.getInstance().GetStatusEffects(event.TargetId, StatusEffecType.Local);
                for (var ef of tEffects) statusEffectsOnTarget.push([ef.statusEffectId, ef.sourceId]);
              }
            }
            // Override skillEffect for battleitems (this way we know the real item used: slendid or not)
            let skillEffectId = parsedDmg.SkillEffectId;
            let skillEffect: string | undefined;
            if (this.#data.isBattleItem(skillEffectId, "attack")) {
              const entity = this.#currentEncounter.entities.get(parsedDmg.SourceId);
              if (entity && entity.entityType === EntityType.Projectile) {
                const proj = entity as Projectile;
                skillEffectId = proj.skillEffectId;
                skillEffect = this.#data.getBattleItemName(skillEffectId);
              }
            }
            skillEffect = skillEffect ?? this.#data.getSkillEffectComment(skillEffectId);
            this.#buildLine(
              LineId.Damage,
              sourceEntity.entityId,
              sourceEntity.name,
              parsedDmg.SkillId,
              skillName,
              skillEffectId,
              skillEffect,
              event.TargetId,
              this.#getEntityName(event.TargetId),
              Number(event.Damage),
              event.Modifier.toString(16),
              Number(event.CurHp),
              Number(event.MaxHp),
              statusEffectsOnTarget,
              statusEffectsOnSource
            );
          });
        }
      })
      .on("PKTSkillStageNotify", (pkt) => {
        if (this.#needEmit) {
          const parsed = pkt.parsed;
          if (!parsed) return;
          let sourceEntity: Entity = this.#getSourceEntity(parsed.SourceId);
          sourceEntity = this.#guessIsPlayer(sourceEntity, parsed.SkillId);
          this.#buildLine(
            LineId.SkillStage,
            sourceEntity.entityId,
            sourceEntity.name,
            parsed.SkillId,
            this.#data.getSkillName(parsed.SkillId),
            parsed.Stage
          );
        }
      })
      .on("PKTSkillStartNotify", (pkt) => {
        if (this.#needEmit) {
          const parsed = pkt.parsed;
          if (!parsed) return;
          let sourceEntity: Entity = this.#getSourceEntity(parsed.SourceId);
          sourceEntity = this.#guessIsPlayer(sourceEntity, parsed.SkillId);
          this.#buildLine(
            LineId.SkillStart,
            sourceEntity.entityId,
            sourceEntity.name,
            parsed.SkillId,
            this.#data.getSkillName(parsed.SkillId)
          );
        }
      })
      .on("PKTStatChangeOriginNotify", (pkt) => {
        if (this.#needEmit) {
          //TODO: fix dump, this wasn't working anw
          /*
          const parsed = pkt.parsed;
          if (!parsed) return;
          // TODO: check healAmount, currentHp + fix def
          const currentStatsMap = this.#getStatPairMap(pkt.parsed.StatPairList);
          const changedStatsMap = this.#getStatPairMap(pkt.parsed.Unk1);
          this.#buildLine(
            LineId.Heal,
            parsed.ObjectId,
            this.#getEntityName(parsed.ObjectId),
            Number(changedStatsMap.get(stattype.hp)) || 0,
            Number(currentStatsMap.get(stattype.hp)) || 0
          );
          */
        }
      })
      .on("PKTStatusEffectAddNotify", (pkt) => {
        const parsed = pkt.parsed;
        if (!parsed) return;
        const val: number = parsed.statusEffectData.Value ? parsed.statusEffectData.Value.readUInt32LE() : 0;
        const sourceEnt = this.#getSourceEntity(parsed.statusEffectData.SourceId);
        var se: StatusEffect = {
          instanceId: parsed.statusEffectData.EffectInstanceId,
          sourceId: sourceEnt.entityId,
          started: new Date(),
          statusEffectId: parsed.statusEffectData.StatusEffectId,
          targetId: parsed.ObjectId,
          type: StatusEffecType.Local,
          value: val,
        };
        StatusTracker.getInstance().RegisterStatusEffect(se);
      })
      .on("PKTStatusEffectRemoveNotify", (pkt) => {
        const parsed = pkt.parsed;
        if (!parsed) return;
        for (const effectId of parsed.statusEffectIds)
          StatusTracker.getInstance().RemoveStatusEffect(parsed.ObjectId, effectId, StatusEffecType.Local);
      })
      .on("PKTTriggerBossBattleStatus", (pkt) => {
        if (this.#needEmit) this.#buildLine(LineId.PhaseTransition, 2);
      })
      .on("PKTTriggerFinishNotify", (pkt) => {})
      .on("PKTTriggerStartNotify", (pkt) => {
        const parsed = pkt.parsed;
        if (!parsed) return;
        switch (parsed.TriggerSignalType) {
          case triggersignaltype.dungeon_phase1_clear:
          case triggersignaltype.dungeon_phase2_clear:
          case triggersignaltype.dungeon_phase3_clear:
          case triggersignaltype.dungeon_phase4_clear:
          case triggersignaltype.dungeon_phase5_clear:
          case triggersignaltype.dungeon_phase6_clear:
            this.#wasKill = true;
            this.#wasWipe = false;
            break;
          case triggersignaltype.dungeon_phase1_fail:
          case triggersignaltype.dungeon_phase2_fail:
          case triggersignaltype.dungeon_phase3_fail:
          case triggersignaltype.dungeon_phase4_fail:
          case triggersignaltype.dungeon_phase5_fail:
          case triggersignaltype.dungeon_phase6_fail:
            this.#wasKill = false;
            this.#wasWipe = true;
            break;
        }
      });
  }

  #buildLine<U extends keyof LegacyLoggerEvents>(id: U, ...args: Parameters<LegacyLoggerEvents[U]>) {
    if (this.emitText) {
      let line = `${id}|${new Date().toISOString()}|${args
        .map((v) => (typeof v === "bigint" ? v.toString(16) : v))
        .join("|")}`;
      line = [line, createHash("md5").update(line).digest("hex")].join("|");
      this.emit("line", line);
    }
    if (this.emitLines) this.emit(id, ...args);
  }

  get #needEmit() {
    return this.emitText || this.emitLines;
  }

  #getSourceEntity(id: bigint): Entity {
    let entity = this.#currentEncounter.entities.get(id);
    if (entity?.entityType === EntityType.Projectile) {
      id = (entity as Projectile).ownerId;
    } else if (entity?.entityType === EntityType.Summon) {
      id = (entity as Summon).ownerId;
    }
    entity = this.#currentEncounter.entities.get(id);
    if (entity) return entity;
    const newEntity = {
      entityId: id,
      entityType: EntityType.Npc,
      name: id.toString(16),
    };
    this.#currentEncounter.entities.set(id, newEntity);
    return newEntity;
  }

  #guessIsPlayer(entity: Entity, skillid: number): Entity {
    const classId = this.#data.getSkillClassId(skillid);
    if (classId !== 0) {
      let newEntity: Player;
      if (entity.entityType === EntityType.Player) {
        const player = entity as Player;
        if (player.class == classId) return player;
        newEntity = {
          entityId: player.entityId,
          entityType: EntityType.Player,
          name: player.name,
          class: classId,
          gearLevel: player.gearLevel,
          characterId: player.characterId,
        };
      } else {
        newEntity = {
          entityId: entity.entityId,
          entityType: EntityType.Player,
          name: entity.name,
          class: classId,
          gearLevel: 0,
          characterId: 0n,
        };
      }
      this.#currentEncounter.entities.set(entity.entityId, newEntity);
      this.#buildLine(
        LineId.NewPC,
        newEntity.entityId,
        newEntity.name,
        newEntity.class,
        this.#data.getClassName(newEntity.class),
        1,
        newEntity.gearLevel,
        0,
        0,
        newEntity.characterId
      );
      return newEntity;
    }
    return entity;
  }

  #getEntityName(id: bigint) {
    return this.#currentEncounter.entities.get(id)?.name || id.toString(16);
  }

  #getStatPairMap(statpair: { StatType: number; Value: bigint }[]) {
    //TODO: use a "Common" packet for statpair parsing
    const map = new Map<stattype, bigint>();
    statpair.forEach((pair) => {
      map.set(pair.StatType, pair.Value);
    });
    return map;
  }

  #u32tof32(v: number) {
    //TODO: remove when we fixed float types in the dump
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(v);
    return Math.round(buf.readFloatLE() * 100) / 100;
  }
}

class Encounter {
  start: number;
  entities: Map<bigint, Entity>;

  constructor() {
    this.start = Date.now();
    this.entities = new Map();
  }
}

const enum EntityType {
  Player,
  Npc,
  Summon,
  Projectile,
}

type Entity = {
  entityId: bigint;
  entityType: EntityType;
  name: string;
};

type Player = Entity & {
  class: number;
  gearLevel: number;
  characterId: bigint;
};

type Npc = Entity & {
  typeId: number;
};

type Summon = Entity & {
  ownerId: bigint;
};

type Projectile = Entity & {
  ownerId: bigint;
  skillEffectId: number;
  skillId: number;
};
