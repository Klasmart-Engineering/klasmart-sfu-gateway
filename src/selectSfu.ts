import { getFromUrl } from "./auth";
import {Registrar, SfuId, TrackInfo} from "./redis";
import {IScheduler, OrgId, ScheduleId} from "./scheduler";
import { Url } from "url";
import { getEnvNumber } from "./service";
import {FromScheduleStrategy, RandomStrategy, Strategy} from "./strategy";
import {Logger} from "./logger";


export const MAX_SFU_LOAD = getEnvNumber(process.env.MAX_SFU_LOAD, 500);

export async function selectSfu(
    url: Url,
    registrar: Registrar,
    tracks: TrackInfo[],
    scheduler: IScheduler,
    scheduleId: ScheduleId,
    orgId: OrgId,
    cookie: string,
    excludeId?: SfuId
): Promise<SfuId> {
    const randomStrategy = new RandomStrategy(tracks, registrar);
    const fromScheduleStrategy = new FromScheduleStrategy(tracks, registrar, scheduler, scheduleId, orgId, cookie);

    const selectionStrategy = getFromUrl(url, "selectionStrategy");
    switch (selectionStrategy) {
    case "random":
        Logger.debug("Using random strategy");
        return await randomStrategy.getSfuId(excludeId);
    case "fromSchedule":
        Logger.debug("Using fromSchedule strategy");
        return await fromScheduleStrategy.getSfuId(excludeId);
    default: {
        Logger.warn(`Could not find selectionStrategy(${selectionStrategy}), using default`);        // Strategies to attempt in the order they are listed
        const strategies: Strategy[] = [
            fromScheduleStrategy,
            randomStrategy
        ];
        for (const strategy of strategies) {
            try {
                return await strategy.getSfuId(excludeId);
            } catch (e) {
                Logger.warn(`Could not find SFU with strategy ${strategy.name}`, e);
            }
        }
        throw new Error("Unable to find SFU to use");
    }
    }
}
