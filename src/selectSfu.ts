import { getFromUrl } from "./auth";
import { RedisRegistrar, SfuId, TrackInfo } from "./redis";
import {IScheduler, OrgId, ScheduleId} from "./scheduler";
import { Url } from "url";
import { getEnvNumber } from "./service";


export const MAX_SFU_LOAD = getEnvNumber(process.env.MAX_SFU_LOAD, 500);

export async function selectSfu(
    url: Url,
    registrar: RedisRegistrar,
    tracks: TrackInfo[],
    scheduler: IScheduler,
    scheduleId: ScheduleId,
    orgId: OrgId,
    cookie: string,
) {
    try {
        const selectionStrategy = getFromUrl(url, "selectionStrategy") ?? "fromSchedule";
        switch (selectionStrategy) {
        case "random":
            return await selectRandomSfu(registrar, tracks);
        case "fromSchedule":
            return await selectLoadBalancedSfu(registrar, tracks, scheduler, scheduleId, orgId, cookie);
        default:
            console.warn(`Could not find selectionStrategy(${selectionStrategy}), using default`);
            return await selectLoadBalancedSfu(registrar, tracks, scheduler, scheduleId, orgId, cookie);
        }
    } catch(e) {
        console.error(e);
        return;
    }
}


async function selectLoadBalancedSfu(registrar: RedisRegistrar, tracks: TrackInfo[], scheduler: IScheduler, scheduleId: ScheduleId, orgId: OrgId, cookie: string) {
    const roster = await scheduler.getSchedule(scheduleId, orgId, cookie);
    const numStudents = roster.class_roster_students.length;
    const numTeachers = roster.class_roster_teachers.length;
    console.log(`numStudents: ${numStudents}, numTeachers: ${numTeachers}`);
    const sfuIds = tracks.reduce((ids, track) => ids.add(track.sfuId), new Set<SfuId>());
    // It would be ideal to have the user id attached to the track in redis, but until that is implemented we'll assume
    // the remaining tracks is close to 3 * teachers + 2 * students - tracks.length
    const potentialNewTracks  = 3 * numTeachers + 3 * numStudents - tracks.length;
    const potentialNewConsumers = potentialNewTracks * (numStudents + numTeachers);
    let potentialNewLoad = potentialNewTracks + potentialNewConsumers;

    // Of the SFUs serving this room, see if one can handle the remaining load.
    let lowestLoadSfuId;
    let lowestLoad = Infinity;
    let sfuStatuses = await Promise.all(Array.from(sfuIds).map(async sfuId => {
        return {id: sfuId, status: await registrar.getSfuStatus(sfuId) };
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
    return await registrar.getAvailableSfu(potentialNewLoad);
}

async function selectRandomSfu(registrar: RedisRegistrar, tracks: TrackInfo[]) {
    const ids = tracks.reduce((ids, track) => ids.add(track.sfuId), new Set<SfuId>());
    let randomIndex = 1 + Math.floor(ids.size * Math.random());
    for (const id of ids) {
        if (randomIndex <= 0) { return id; }
        randomIndex--;
    }
    return await registrar.getRandomSfuId();
}
