import {Registrar, SfuId, TrackInfo} from "./redis";
import {IScheduler, OrgId, ScheduleId} from "./scheduler";
import {MAX_SFU_LOAD} from "./selectSfu";
import {Logger} from "./logger";

export abstract class Strategy {
    abstract name: string;
    abstract getSfuId(excludeId?: SfuId): Promise<SfuId>;
}

export class RandomStrategy implements Strategy {
    public readonly name: "Random" = "Random";
    public constructor(private tracks: TrackInfo[], private registrar: Registrar) {
    }

    public async getSfuId(excludeId?: SfuId): Promise<SfuId> {
        const ids = this.tracks.filter(t => t.sfuId !== excludeId).reduce((ids, track) => ids.add(track.sfuId), new Set<SfuId>());
        let randomIndex = 1 + Math.floor(ids.size * Math.random());
        for (const id of ids) {
            if (randomIndex <= 0) { return id; }
            randomIndex--;
        }
        const sfuId = await this.registrar.getRandomSfuId(excludeId);
        if (!sfuId) {
            throw new Error("No SFU available");
        }
        return sfuId;
    }
}

export class FromScheduleStrategy implements Strategy {
    public readonly name: "FromSchedule" = "FromSchedule";
    public constructor(
        private tracks: TrackInfo[],
        private registrar: Registrar,
        private scheduler: IScheduler,
        private scheduleId: ScheduleId,
        private orgId: OrgId,
        private cookie: string) {
    }

    public async getSfuId(excludeId?: SfuId): Promise<SfuId> {
        const roster = await this.scheduler.getSchedule(this.scheduleId, this.orgId, this.cookie);
        const numStudents = roster.class_roster_students.length;
        const numTeachers = roster.class_roster_teachers.length;
        Logger.debug(`numStudents: ${numStudents}, numTeachers: ${numTeachers}`);
        const sfuIds = this.tracks.filter(t => t.sfuId !== excludeId).reduce((ids, track) => ids.add(track.sfuId), new Set<SfuId>());
        // It would be ideal to have the user id attached to the track in redis, but until that is implemented we'll assume
        // the remaining tracks is close to 3 * teachers + 3 * students - tracks.length
        const potentialNewTracks  = 3 * numTeachers + 3 * numStudents - this.tracks.length;
        const potentialNewConsumers = potentialNewTracks * (numStudents + numTeachers);
        let potentialNewLoad = potentialNewTracks + potentialNewConsumers;

        // Of the SFUs serving this room, see if one can handle the remaining load.
        let lowestLoadSfuId;
        let lowestLoad = Infinity;
        let sfuStatuses = await Promise.all(Array.from(sfuIds).map(async sfuId => {
            return {id: sfuId, status: await this.registrar.getSfuStatus(sfuId) };
        }));

        // If the potential new load is greater than what a single SFU can support, just consider the SFU with the lowest load.
        // This will result in filling up an SFU until the remaining work can be fit on another SFU.
        if (potentialNewLoad >= MAX_SFU_LOAD) {
            potentialNewLoad = 3;
        }

        sfuStatuses = sfuStatuses.filter(sfuStatus => MAX_SFU_LOAD - (sfuStatus.status.producers + sfuStatus.status.consumers) >= potentialNewLoad);

        // Select the SFU with the lowest load.
        for (const sfuStatus of sfuStatuses) {
            const { id, status} = sfuStatus;
            const { consumers, producers } = status;
            if (!lowestLoadSfuId) { lowestLoadSfuId = id; }
            const load = consumers + producers;
            if (load < lowestLoad && load + potentialNewLoad <= MAX_SFU_LOAD) {
                lowestLoad = load;
                lowestLoadSfuId = id;
            }
        }
        if (lowestLoadSfuId) {
            return lowestLoadSfuId;
        }
        // Otherwise, look for an SFU that can handle the remaining load.
        return await this.registrar.getAvailableSfu(potentialNewLoad);
    }
}
